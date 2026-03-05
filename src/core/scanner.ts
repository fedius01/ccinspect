import { existsSync, readFileSync, statSync, readdirSync } from 'fs';
import { join, relative, resolve, basename, dirname } from 'path';
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
  getUserRulesDir,
  getUserSkillsDir,
  getEnterpriseClaudeMdPath,
  getAutoMemoryDir,
  pathExists,
} from '../utils/os-paths.js';

/**
 * Find a file by name, falling back to case-insensitive match.
 * Returns the actual path found (which may differ in casing), or null.
 */
function findFileCaseInsensitive(dir: string, exactName: string): string | null {
  const exactPath = join(dir, exactName);
  if (existsSync(exactPath)) {
    // On case-insensitive filesystems (macOS HFS+), existsSync may match
    // despite casing difference. Use readdirSync to get the true on-disk name.
    try {
      const entries = readdirSync(dir);
      const trueEntry = entries.find(e => e.toLowerCase() === exactName.toLowerCase());
      return trueEntry ? join(dir, trueEntry) : exactPath;
    } catch {
      return exactPath;
    }
  }

  // Case-insensitive fallback: read directory entries
  try {
    const entries = readdirSync(dir);
    const match = entries.find(e => e.toLowerCase() === exactName.toLowerCase());
    return match ? join(dir, match) : null;
  } catch {
    return null;
  }
}

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
  return buildFileInfo(absolutePath, 'project-shared', projectRoot);
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
    // Case-insensitive: discover all .md files and filter by basename
    const allMdFiles = fg.sync('**/*.md', { cwd: skillsDir, absolute: true });
    return allMdFiles.filter(f => basename(f).toLowerCase() === 'skill.md');
  } catch {
    return [];
  }
}

function discoverSubdirClaudeMds(projectRoot: string): string[] {
  try {
    // Case-insensitive: discover all .md files and filter by basename
    const allMdFiles = fg.sync('**/*.md', {
      cwd: projectRoot,
      ignore: ['node_modules/**', '.git/**', 'dist/**', 'coverage/**'],
      absolute: true,
    });
    return allMdFiles
      .filter(p => basename(p).toLowerCase() === 'claude.md')
      // Exclude the root-level CLAUDE.md (any casing) — it's handled separately
      .filter((p) => resolve(dirname(p)) !== resolve(projectRoot));
  } catch {
    return [];
  }
}

interface ScanOptions {
  projectDir?: string;
  includeNonExistent?: boolean;
  excluder?: Excluder;
  skipGlobalDirs?: boolean;
}

export function scan(options: ScanOptions = {}): ConfigInventory {
  const projectRoot = resolve(options.projectDir || process.cwd());
  const gitRoot = findGitRoot(projectRoot);

  const includeNonExistent = options.includeNonExistent ?? true;
  const excluder = options.excluder;
  const skipGlobal = options.skipGlobalDirs ?? false;

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
  const userSettings = skipGlobal ? null : getFileInfo(getUserSettingsPath(), 'user');

  const projectSettingsActual = findFileCaseInsensitive(join(projectRoot, '.claude'), 'settings.json');
  const projectSettings = projectSettingsActual
    ? getFileInfo(projectSettingsActual, 'project-shared')
    : getFileInfo(join(projectRoot, '.claude', 'settings.json'), 'project-shared');

  const localSettingsActual = findFileCaseInsensitive(join(projectRoot, '.claude'), 'settings.local.json');
  const localSettings = localSettingsActual
    ? getFileInfo(localSettingsActual, 'project-local')
    : getFileInfo(join(projectRoot, '.claude', 'settings.local.json'), 'project-local');

  const managedSettings = skipGlobal ? null : getFileInfo(getManagedSettingsPath(), 'enterprise');
  const preferences = skipGlobal ? null : getFileInfo(getPreferencesPath(), 'user');

  // Memory layer
  const enterpriseClaudeMd = skipGlobal ? null : getFileInfo(getEnterpriseClaudeMdPath(), 'enterprise');
  const globalClaudeMd = skipGlobal ? null : getFileInfo(getUserClaudeMdPath(), 'user');

  const projectClaudeMdActual = findFileCaseInsensitive(projectRoot, 'CLAUDE.md');
  const projectClaudeMd = projectClaudeMdActual
    ? getFileInfo(projectClaudeMdActual, 'project-shared')
    : getFileInfo(join(projectRoot, 'CLAUDE.md'), 'project-shared');

  const localClaudeMdActual = findFileCaseInsensitive(projectRoot, 'CLAUDE.local.md');
  const localClaudeMd = localClaudeMdActual
    ? getFileInfo(localClaudeMdActual, 'project-local')
    : getFileInfo(join(projectRoot, 'CLAUDE.local.md'), 'project-local');

  const subdirPaths = discoverSubdirClaudeMds(projectRoot).filter(notExcluded);
  const subdirClaudeMds = subdirPaths
    .map((p) => buildFileInfo(p, 'project-shared', projectRoot))
    .filter((f): f is FileInfo => f !== null);

  // Auto memory
  let autoMemory: FileInfo | null = null;
  let autoMemoryTopics: FileInfo[] = [];
  if (gitRoot && !skipGlobal) {
    const projectId = getProjectIdentifier(gitRoot);
    const memoryDir = getAutoMemoryDir(projectId);
    const memoryMdActual = findFileCaseInsensitive(memoryDir, 'MEMORY.md');
    autoMemory = memoryMdActual
      ? getFileInfo(memoryMdActual, 'user')
      : getFileInfo(join(memoryDir, 'MEMORY.md'), 'user');

    if (pathExists(memoryDir)) {
      const topicFiles = discoverMdFiles(memoryDir).filter((p) => basename(p).toLowerCase() !== 'memory.md');
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

  // User rules
  const userRules: RuleFileInfo[] = skipGlobal ? [] : (() => {
    const userRulesDir = getUserRulesDir();
    const userRuleFiles = discoverMdFiles(userRulesDir);
    return userRuleFiles
      .map((p) => buildFileInfo(p, 'user', projectRoot))
      .filter((f): f is RuleFileInfo => f !== null);
  })();

  // Agents
  const projectAgentsDir = join(projectRoot, '.claude', 'agents');
  const projectAgentFiles = discoverMdFiles(projectAgentsDir).filter(notExcluded);
  const projectAgents = projectAgentFiles
    .map((p) => buildFileInfo(p, 'project-shared', projectRoot))
    .filter((f): f is FileInfo => f !== null);

  const userAgents: FileInfo[] = skipGlobal ? [] : (() => {
    const userAgentFiles = discoverMdFiles(getUserAgentsDir());
    return userAgentFiles
      .map((p) => buildFileInfo(p, 'user', projectRoot))
      .filter((f): f is FileInfo => f !== null);
  })();

  // Commands
  const projectCommandsDir = join(projectRoot, '.claude', 'commands');
  const projectCommandFiles = discoverMdFiles(projectCommandsDir).filter(notExcluded);
  const projectCommands = projectCommandFiles
    .map((p) => buildFileInfo(p, 'project-shared', projectRoot))
    .filter((f): f is FileInfo => f !== null);

  const userCommands: FileInfo[] = skipGlobal ? [] : (() => {
    const userCommandFiles = discoverMdFiles(getUserCommandsDir());
    return userCommandFiles
      .map((p) => buildFileInfo(p, 'user', projectRoot))
      .filter((f): f is FileInfo => f !== null);
  })();

  // Skills
  const projectSkillsDir = join(projectRoot, '.claude', 'skills');
  const projectSkillFiles = discoverSkillFiles(projectSkillsDir).filter(notExcluded);
  const projectSkills = projectSkillFiles
    .map((p) => buildFileInfo(p, 'project-shared', projectRoot))
    .filter((f): f is FileInfo => f !== null);

  // User skills
  const userSkills: FileInfo[] = skipGlobal ? [] : (() => {
    const userSkillFiles = discoverSkillFiles(getUserSkillsDir());
    return userSkillFiles
      .map((p) => buildFileInfo(p, 'user', projectRoot))
      .filter((f): f is FileInfo => f !== null);
  })();

  // MCP
  const projectMcpActual = findFileCaseInsensitive(projectRoot, '.mcp.json');
  const projectMcp = projectMcpActual
    ? getFileInfo(projectMcpActual, 'project-shared')
    : getFileInfo(join(projectRoot, '.mcp.json'), 'project-shared');
  // managed-mcp.json: enterprise-managed, no case-insensitive fallback
  const managedMcp = skipGlobal ? null : getFileInfo(getManagedMcpPath(), 'enterprise');

  // Count totals
  const allFiles: (FileInfo | null)[] = [
    userSettings,
    projectSettings,
    localSettings,
    managedSettings,
    preferences,
    enterpriseClaudeMd,
    globalClaudeMd,
    projectClaudeMd,
    localClaudeMd,
    autoMemory,
    projectMcp,
    managedMcp,
    ...subdirClaudeMds,
    ...autoMemoryTopics,
    ...rules,
    ...userRules,
    ...projectAgents,
    ...userAgents,
    ...projectCommands,
    ...userCommands,
    ...projectSkills,
    ...userSkills,
  ];

  const existingFiles = allFiles.filter((f): f is FileInfo => f !== null && f.exists);
  const totalFiles = existingFiles.length;

  // Startup tokens: CLAUDE.md chain + MEMORY.md (first 200 lines)
  const startupFiles = [enterpriseClaudeMd, globalClaudeMd, projectClaudeMd, localClaudeMd].filter(
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
  const onDemandFiles = [...subdirClaudeMds, ...rules, ...userRules, ...autoMemoryTopics];
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
    enterpriseClaudeMd,
    globalClaudeMd,
    projectClaudeMd,
    localClaudeMd,
    subdirClaudeMds,
    autoMemory,
    autoMemoryTopics,
    rules,
    userRules,
    projectAgents,
    userAgents,
    projectCommands,
    userCommands,
    projectSkills,
    userSkills,
    projectMcp,
    managedMcp,
    plugins: [],
    hooks: [],
    totalFiles,
    totalStartupTokens,
    totalOnDemandTokens,
  };
}
