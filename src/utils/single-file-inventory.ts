import { readFileSync, statSync } from 'fs';
import { basename, dirname, resolve } from 'path';
import { relative } from 'path';

import type {
  ConfigFileType,
  FileInfo,
  ConfigInventory,
  SingleFileContext,
} from '../types/index.js';
import { createEmptyResolvedConfig } from '../core/resolver.js';
import { classifyConfigFile, inferScope } from './file-classifier.js';
import { findGitRoot, isGitTracked } from './git.js';
import { pathExists } from './os-paths.js';
import { estimateTokens } from './tokens.js';

const SUPPORTED_TYPES: ConfigFileType[] = [
  'claude-md',
  'settings-json',
  'mcp-json',
  'rule-md',
  'agent-md',
  'skill-md',
  'command-md',
];

function buildFileInfoForPath(
  absolutePath: string,
  scope: FileInfo['scope'],
  projectRoot: string,
): FileInfo {
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
}



function createEmptyInventory(projectRoot: string, gitRoot: string | null): ConfigInventory {
  return {
    projectRoot,
    gitRoot,
    userSettings: null,
    projectSettings: null,
    localSettings: null,
    managedSettings: null,
    preferences: null,
    enterpriseClaudeMd: null,
    globalClaudeMd: null,
    projectClaudeMd: null,
    localClaudeMd: null,
    subdirClaudeMds: [],
    autoMemory: null,
    autoMemoryTopics: [],
    rules: [],
    userRules: [],
    projectAgents: [],
    userAgents: [],
    projectCommands: [],
    userCommands: [],
    projectSkills: [],
    userSkills: [],
    projectMcp: null,
    managedMcp: null,
    plugins: [],
    hooks: [],
    totalFiles: 0,
    totalStartupTokens: 0,
    totalOnDemandTokens: 0,
  };
}

/**
 * Determine which ConfigInventory slot a file belongs to based on its type, scope, and name.
 */
function placeFileInInventory(
  inventory: ConfigInventory,
  fileInfo: FileInfo,
  fileType: ConfigFileType,
  scope: FileInfo['scope'],
): void {
  const nameLower = basename(fileInfo.path).toLowerCase();

  switch (fileType) {
    case 'claude-md':
      if (scope === 'enterprise') {
        inventory.enterpriseClaudeMd = fileInfo;
      } else if (scope === 'user') {
        inventory.globalClaudeMd = fileInfo;
      } else if (nameLower === 'claude.local.md') {
        inventory.localClaudeMd = fileInfo;
      } else {
        inventory.projectClaudeMd = fileInfo;
      }
      break;

    case 'settings-json':
      if (scope === 'enterprise') {
        inventory.managedSettings = fileInfo;
      } else if (scope === 'user') {
        inventory.userSettings = fileInfo;
      } else if (nameLower === 'settings.local.json') {
        inventory.localSettings = fileInfo;
      } else {
        inventory.projectSettings = fileInfo;
      }
      break;

    case 'mcp-json':
      if (scope === 'enterprise') {
        inventory.managedMcp = fileInfo;
      } else {
        inventory.projectMcp = fileInfo;
      }
      break;

    case 'rule-md':
      if (scope === 'user') {
        inventory.userRules.push(fileInfo);
      } else {
        inventory.rules.push(fileInfo);
      }
      break;

    case 'agent-md':
      if (scope === 'user') {
        inventory.userAgents.push(fileInfo);
      } else {
        inventory.projectAgents.push(fileInfo);
      }
      break;

    case 'skill-md':
      if (scope === 'user') {
        inventory.userSkills.push(fileInfo);
      } else {
        inventory.projectSkills.push(fileInfo);
      }
      break;

    case 'command-md':
      if (scope === 'user') {
        inventory.userCommands.push(fileInfo);
      } else {
        inventory.projectCommands.push(fileInfo);
      }
      break;
  }
}

/**
 * Build a SingleFileContext for a single config file.
 * Creates a sparse ConfigInventory containing only the given file,
 * plus an empty ResolvedConfig.
 */
export async function buildSingleFileInventory(filePath: string): Promise<SingleFileContext> {
  const absolutePath = resolve(filePath);

  if (!pathExists(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  const fileType = classifyConfigFile(absolutePath);
  if (!fileType) {
    throw new Error(
      `Unrecognized config file type: ${basename(absolutePath)}. ` +
        `Supported types: ${SUPPORTED_TYPES.join(', ')}`,
    );
  }

  const scope = inferScope(absolutePath, fileType);
  const projectRoot = findGitRoot(dirname(absolutePath)) ?? dirname(absolutePath);
  const gitRoot = findGitRoot(dirname(absolutePath));

  const inventory = createEmptyInventory(projectRoot, gitRoot);

  const fileInfo = buildFileInfoForPath(absolutePath, scope, projectRoot);

  placeFileInInventory(inventory, fileInfo, fileType, scope);

  inventory.totalFiles = 1;
  inventory.totalStartupTokens = fileInfo.estimatedTokens;

  return {
    fileType,
    filePath: absolutePath,
    scope,
    inventory,
    resolved: createEmptyResolvedConfig(),
  };
}
