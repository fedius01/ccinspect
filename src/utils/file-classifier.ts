import { basename, dirname, sep } from 'path';

import type { ConfigFileType, FileScope, IssueCategory } from '../types/index.js';
import { getHomeDir } from './os-paths.js';

/**
 * Maps each ConfigFileType to the lint rule categories that should run in single-file mode.
 * Categories not listed here (cross-level, budget, git, hooks, plugins, coherence) are
 * project-wide and never run in single-file mode.
 * 'naming' is included for all types since filename casing applies universally.
 */
export const SINGLE_FILE_CATEGORIES: Record<ConfigFileType, IssueCategory[]> = {
  'claude-md': ['memory', 'naming'],
  'settings-json': ['settings', 'naming'],
  'mcp-json': ['mcp', 'naming'],
  'rule-md': ['rules', 'naming'],
  'agent-md': ['agents', 'naming'],
  'skill-md': ['skills', 'naming'],
  'command-md': ['commands', 'naming'],
};

/**
 * Classify a config file path into its ConfigFileType.
 * Pure function — no filesystem access. Returns null for unrecognized files.
 * Case-insensitive for basename matching — e.g. "Claude.md" classifies as 'claude-md'.
 */
export function classifyConfigFile(filePath: string): ConfigFileType | null {
  const name = basename(filePath);
  const nameLower = name.toLowerCase();
  const normalizedPath = filePath.split(sep).join('/');

  // CLAUDE.md or CLAUDE.local.md (case-insensitive basename match)
  if (nameLower === 'claude.md' || nameLower === 'claude.local.md') {
    return 'claude-md';
  }

  // settings.json or settings.local.json
  if (nameLower === 'settings.json' || nameLower === 'settings.local.json') {
    return 'settings-json';
  }

  // managed-settings.json
  if (nameLower === 'managed-settings.json') {
    return 'settings-json';
  }

  // .mcp.json or managed-mcp.json
  if (nameLower === '.mcp.json' || nameLower === 'mcp.json' || nameLower === 'managed-mcp.json') {
    return 'mcp-json';
  }

  // SKILL.md (case-insensitive basename)
  if (nameLower === 'skill.md') {
    return 'skill-md';
  }

  // .claude/rules/*.md
  if (name.endsWith('.md') && normalizedPath.includes('.claude/rules/')) {
    return 'rule-md';
  }

  // agents — .claude/agents/*.md or ~/agents/
  if (name.endsWith('.md') && (normalizedPath.includes('.claude/agents/') || normalizedPath.includes('/agents/'))) {
    const dir = dirname(normalizedPath);
    if (dir.endsWith('/agents') || dir.endsWith('.claude/agents')) {
      return 'agent-md';
    }
  }

  // commands — .claude/commands/*.md or ~/commands/
  if (name.endsWith('.md') && (normalizedPath.includes('.claude/commands/') || normalizedPath.includes('/commands/'))) {
    const dir = dirname(normalizedPath);
    if (dir.endsWith('/commands') || dir.endsWith('.claude/commands')) {
      return 'command-md';
    }
  }

  // .md inside .claude/ tree that didn't match above — heuristic
  if (name.endsWith('.md') && normalizedPath.includes('.claude/')) {
    return null;
  }

  return null;
}

/**
 * Best-effort scope inference from file path and type.
 */
export function inferScope(filePath: string, _fileType: ConfigFileType): FileScope {
  const normalizedPath = filePath.split(sep).join('/');
  const name = basename(filePath);
  const home = getHomeDir().split(sep).join('/');

  // managed-settings.json or managed-mcp.json → enterprise (case-insensitive)
  const nameLower = name.toLowerCase();
  if (nameLower === 'managed-settings.json' || nameLower === 'managed-mcp.json') {
    return 'enterprise';
  }

  // .local. in basename → project-local
  if (name.includes('.local.')) {
    return 'project-local';
  }

  // Under home ~/.claude/ → user
  if (normalizedPath.startsWith(home + '/.claude/')) {
    return 'user';
  }

  return 'project-shared';
}

/**
 * Returns the canonical filenames Claude Code expects for a given config file type.
 * Empty array means any .md name is valid (no canonical name to check against).
 */
export function getExpectedFilenames(fileType: ConfigFileType): string[] {
  switch (fileType) {
    case 'claude-md':
      return ['CLAUDE.md', 'CLAUDE.local.md'];
    case 'settings-json':
      return ['settings.json', 'settings.local.json', 'managed-settings.json'];
    case 'mcp-json':
      return ['.mcp.json', 'managed-mcp.json'];
    case 'skill-md':
      return ['SKILL.md'];
    case 'rule-md':
    case 'agent-md':
    case 'command-md':
      return [];
  }
}
