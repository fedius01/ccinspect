import { platform } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import type { OsType } from '../types/index.js';

export function detectOs(): OsType {
  const p = platform();
  if (p === 'darwin') return 'macos';
  if (p === 'win32') return 'windows';
  // Check for WSL
  if (p === 'linux') {
    try {
      const release = require('os').release().toLowerCase();
      if (release.includes('microsoft') || release.includes('wsl')) {
        return 'windows-wsl';
      }
    } catch {
      // ignore
    }
    return 'linux';
  }
  return 'linux';
}

export function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || '~';
}

export function getManagedSettingsPath(): string {
  const os = detectOs();
  switch (os) {
    case 'macos':
      return '/Library/Application Support/ClaudeCode/managed-settings.json';
    case 'linux':
    case 'windows-wsl':
      return '/etc/claude-code/managed-settings.json';
    case 'windows':
      return join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'ClaudeCode', 'managed-settings.json');
  }
}

export function getManagedMcpPath(): string {
  const os = detectOs();
  switch (os) {
    case 'macos':
      return '/Library/Application Support/ClaudeCode/managed-mcp.json';
    case 'linux':
    case 'windows-wsl':
      return '/etc/claude-code/managed-mcp.json';
    case 'windows':
      return join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'ClaudeCode', 'managed-mcp.json');
  }
}

export function getUserSettingsPath(): string {
  return join(getHomeDir(), '.claude', 'settings.json');
}

export function getUserClaudeMdPath(): string {
  return join(getHomeDir(), '.claude', 'CLAUDE.md');
}

export function getPreferencesPath(): string {
  return join(getHomeDir(), '.claude.json');
}

export function getUserAgentsDir(): string {
  return join(getHomeDir(), '.claude', 'agents');
}

export function getUserCommandsDir(): string {
  return join(getHomeDir(), '.claude', 'commands');
}

export function getAutoMemoryDir(projectIdentifier: string): string {
  return join(getHomeDir(), '.claude', 'projects', projectIdentifier, 'memory');
}

export function pathExists(p: string): boolean {
  return existsSync(p);
}
