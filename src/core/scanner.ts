import { readFileSync, statSync, readdirSync } from 'fs';
import { join, relative, resolve, basename } from 'path';
import fg from 'fast-glob';

import type { FileInfo, RuleFileInfo, ConfigInventory, FileScope } from '../types/index.js';
import type { Excluder } from '../utils/excluder.js';
import { findGitRoot, isGitTracked, getProjectIdentifier } from '../utils/git.js';
import { estimateTokens } from '../utils/tokens.js';
import {
  getUserSettingsPath,
  getUserClaudeMdPath,
  getPreferencesPath,
  getManagedSettingsPath,
  getManagedMcpPath,
  getUserAgentsDir,
  getUserCommandsDir,
  getAutoMemoryDir,
  pathExists,
} from '../utils/os-paths.js';

function buildFileInfo(
  absolutePath: string,
  scope: FileScope,
  projectRoot: string,
): FileInfo | null {
  const exists = pathExists(absolutePath);

  if (!exists) {
    return {
      path: absolutePath,
      relativePath: relative(projectRoot, absolutePath) || absolutePath,
      exists: false,
      scope,
      sizeBytes: 0,
      lineCount: 0,
      estimatedTokens: 0,
      gitTracked: false,
      lastModified: new Date(0),
    };
  }

  try {
    const stat = statSync(absolutePath);
    const content = readFileSync(absolutePath, 'utf-8');
    const lines = content.split('\n').length;
    const tokens = estimateTokens(content);
    let tracked = false;
    try {
      tracked = isGitTracked(absolutePath);
    } catch {
      // Not in a git repo
    }

    return {
      path: absolutePath,
      relativePath: relative(projectRoot, absolutePath) || absolutePath,
      exists: true,
      scope,
      sizeBytes: stat.size,
      lineCount: lines,
      estimatedTokens: tokens,
      gitTracked: tracked,
      lastModified: stat.mtime,
    };
  } catch {
    return null;
  }
}

function buildRuleFileInfo(
  absolutePath: string,
  projectRoot: string,
): RuleFileInfo | null {
  const base = buildFileInfo(absolutePath, 'project-shared', projectRoot);
  if (!base) return null;

  // Basic frontmatter extraction (will be enhanced by parsers)
  return {
    ...base,
    frontmatter: {},
    matchedFiles: [],
    isDead: false,
  };
}

function discoverMdFiles(dirPath: string): string[] {
  if (!pathExists(dirPath)) return [];
  try {
    return readdirSync(dirPath)
      .filter((f) => f.endsWith('.md'))
      .map((f) => join(dirPath, f));
  } catch {
    return [];
  }
}

function discoverSkillFiles(skillsDir: string): string[] {
  if (!pathExists(skillsDir)) return [];
  try {
    return readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((dir) => join(skillsDir, dir.name, 'SKILL.md'))
      .filter((skillPath) => pathExists(skillPath));
  } catch {
    return [];
  }
}

function discoverSubdirClaudeMds(projectRoot: string): string[] {
  try {
    return fg.sync('**/CLAUDE.md', {
      cwd: projectRoot,
      ignore: ['node_modules/**', '.git/**', 'dist/**', 'coverage/**'],
      absolute: true,
    }).filter((p) => resolve(p) !== resolve(join(projectRoot, 'CLAUDE.md')));
  } catch {
    return [];
  }
}

interface ScanOptions {
  projectDir?: string;
  includeNonExistent?: boolean;
  excluder?: Excluder;
}

export function scan(options: ScanOptions = {}): ConfigInventory {
  const projectRoot = resolve(options.projectDir || process.cwd());
  const gitRoot = findGitRoot(projectRoot);

  const includeNonExistent = options.includeNonExistent ?? true;
  const excluder = options.excluder;

  // Helper to filter out excluded paths
  const notExcluded = (p: string): boolean => !excluder || !excluder.isExcluded(p);

  // Helper that returns FileInfo only if it exists or includeNonExistent is true
  function getFileInfo(path: string, scope: FileScope): FileInfo | null {
    const info = buildFileInfo(path, scope, projectRoot);
    if (!info) return null;
    if (!info.exists && !includeNonExistent) return null;
    return info;
  }

  // Settings layer
  const userSettings = getFileInfo(getUserSettingsPath(), 'user');
  const projectSettings = getFileInfo(join(projectRoot, '.claude', 'settings.json'), 'project-shared');
  const localSettings = getFileInfo(join(projectRoot, '.claude', 'settings.local.json'), 'project-local');
  const managedSettings = getFileInfo(getManagedSettingsPath(), 'enterprise');
  const preferences = getFileInfo(getPreferencesPath(), 'user');

  // Memory layer
  const globalClaudeMd = getFileInfo(getUserClaudeMdPath(), 'user');
  const projectClaudeMd = getFileInfo(join(projectRoot, 'CLAUDE.md'), 'project-shared');
  const localClaudeMd = getFileInfo(join(projectRoot, 'CLAUDE.local.md'), 'project-local');

  const subdirPaths = discoverSubdirClaudeMds(projectRoot).filter(notExcluded);
  const subdirClaudeMds = subdirPaths
    .map((p) => buildFileInfo(p, 'project-shared', projectRoot))
    .filter((f): f is FileInfo => f !== null);

  // Auto memory
  let autoMemory: FileInfo | null = null;
  let autoMemoryTopics: FileInfo[] = [];
  if (gitRoot) {
    const projectId = getProjectIdentifier(gitRoot);
    const memoryDir = getAutoMemoryDir(projectId);
    const memoryMdPath = join(memoryDir, 'MEMORY.md');
    autoMemory = getFileInfo(memoryMdPath, 'user');

    if (pathExists(memoryDir)) {
      const topicFiles = discoverMdFiles(memoryDir).filter(
        (p) => basename(p) !== 'MEMORY.md',
      );
      autoMemoryTopics = topicFiles
        .map((p) => buildFileInfo(p, 'user', projectRoot))
        .filter((f): f is FileInfo => f !== null);
    }
  }

  // Rules
  const rulesDir = join(projectRoot, '.claude', 'rules');
  const ruleFiles = discoverMdFiles(rulesDir).filter(notExcluded);
  const rules = ruleFiles
    .map((p) => buildRuleFileInfo(p, projectRoot))
    .filter((f): f is RuleFileInfo => f !== null);

  // Agents
  const projectAgentsDir = join(projectRoot, '.claude', 'agents');
  const projectAgentFiles = discoverMdFiles(projectAgentsDir).filter(notExcluded);
  const projectAgents = projectAgentFiles
    .map((p) => buildFileInfo(p, 'project-shared', projectRoot))
    .filter((f): f is FileInfo => f !== null);

  const userAgentsDir = getUserAgentsDir();
  const userAgentFiles = discoverMdFiles(userAgentsDir);
  const userAgents = userAgentFiles
    .map((p) => buildFileInfo(p, 'user', projectRoot))
    .filter((f): f is FileInfo => f !== null);

  // Commands
  const projectCommandsDir = join(projectRoot, '.claude', 'commands');
  const projectCommandFiles = discoverMdFiles(projectCommandsDir).filter(notExcluded);
  const projectCommands = projectCommandFiles
    .map((p) => buildFileInfo(p, 'project-shared', projectRoot))
    .filter((f): f is FileInfo => f !== null);

  const userCommandsDir = getUserCommandsDir();
  const userCommandFiles = discoverMdFiles(userCommandsDir);
  const userCommands = userCommandFiles
    .map((p) => buildFileInfo(p, 'user', projectRoot))
    .filter((f): f is FileInfo => f !== null);

  // Skills
  const projectSkillsDir = join(projectRoot, '.claude', 'skills');
  const projectSkillFiles = discoverSkillFiles(projectSkillsDir).filter(notExcluded);
  const projectSkills = projectSkillFiles
    .map((p) => buildFileInfo(p, 'project-shared', projectRoot))
    .filter((f): f is FileInfo => f !== null);

  // MCP
  const projectMcp = getFileInfo(join(projectRoot, '.mcp.json'), 'project-shared');
  const managedMcp = getFileInfo(getManagedMcpPath(), 'enterprise');

  // Count totals
  const allFiles: (FileInfo | null)[] = [
    userSettings,
    projectSettings,
    localSettings,
    managedSettings,
    preferences,
    globalClaudeMd,
    projectClaudeMd,
    localClaudeMd,
    autoMemory,
    projectMcp,
    managedMcp,
    ...subdirClaudeMds,
    ...autoMemoryTopics,
    ...rules,
    ...projectAgents,
    ...userAgents,
    ...projectCommands,
    ...userCommands,
    ...projectSkills,
  ];

  const existingFiles = allFiles.filter((f): f is FileInfo => f !== null && f.exists);
  const totalFiles = existingFiles.length;

  // Startup tokens: CLAUDE.md chain + MEMORY.md (first 200 lines)
  const startupFiles = [globalClaudeMd, projectClaudeMd, localClaudeMd].filter(
    (f): f is FileInfo => f !== null && f.exists,
  );
  let totalStartupTokens = startupFiles.reduce((sum, f) => sum + f.estimatedTokens, 0);

  // Auto memory: only first 200 lines count as startup
  if (autoMemory?.exists) {
    try {
      const content = readFileSync(autoMemory.path, 'utf-8');
      const first200 = content.split('\n').slice(0, 200).join('\n');
      totalStartupTokens += estimateTokens(first200);
    } catch {
      // ignore
    }
  }

  // On-demand tokens: subdir CLAUDE.md + rules + memory topics
  const onDemandFiles = [...subdirClaudeMds, ...rules, ...autoMemoryTopics];
  const totalOnDemandTokens = onDemandFiles
    .filter((f) => f.exists)
    .reduce((sum, f) => sum + f.estimatedTokens, 0);

  return {
    projectRoot,
    gitRoot,
    userSettings,
    projectSettings,
    localSettings,
    managedSettings,
    preferences,
    globalClaudeMd,
    projectClaudeMd,
    localClaudeMd,
    subdirClaudeMds,
    autoMemory,
    autoMemoryTopics,
    rules,
    projectAgents,
    userAgents,
    projectCommands,
    userCommands,
    projectSkills,
    projectMcp,
    managedMcp,
    plugins: [],
    hooks: [],
    totalFiles,
    totalStartupTokens,
    totalOnDemandTokens,
  };
}
