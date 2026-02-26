import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { readFileSync } from 'fs';

function existingFiles(files: (FileInfo | null)[]): FileInfo[] {
  return files.filter((f): f is FileInfo => f !== null && f.exists);
}

const PLACEHOLDER_PATTERNS = [
  '<your',
  'todo',
  'fixme',
  'xxx',
  'your-token',
  'replace-me',
  'insert',
  'changeme',
];

/** Check if a value looks like an env var reference */
function isEnvReference(value: string): boolean {
  return /^\$\w+$/.test(value) || /^\$\{.+\}$/.test(value);
}

/** Check if a value is empty, whitespace-only, or an obvious placeholder */
function isBadEnvValue(value: string): 'empty' | 'placeholder' | null {
  if (value.trim() === '') {
    return 'empty';
  }

  const lower = value.toLowerCase();
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (lower.includes(pattern)) {
      return 'placeholder';
    }
  }

  return null;
}

interface McpServerEntry {
  name: string;
  env: Record<string, string>;
}

function extractMcpServers(content: string): McpServerEntry[] {
  try {
    const raw = JSON.parse(content) as Record<string, unknown>;
    const mcpServers = raw.mcpServers as Record<string, unknown> | undefined;
    if (!mcpServers || typeof mcpServers !== 'object') {
      return [];
    }

    const servers: McpServerEntry[] = [];
    for (const [name, config] of Object.entries(mcpServers)) {
      const serverConfig = config as Record<string, unknown>;
      const env = serverConfig.env as Record<string, string> | undefined;
      if (env && typeof env === 'object') {
        servers.push({ name, env });
      }
    }
    return servers;
  } catch {
    return [];
  }
}

export const missingEnvVarsRule: LintRule = {
  id: 'mcp/missing-env-vars',
  description: 'Check MCP server configs for empty or placeholder environment variables',
  severity: 'warning',
  category: 'mcp',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    // Check .mcp.json files
    const mcpFiles = existingFiles([inventory.projectMcp, inventory.managedMcp]);

    for (const file of mcpFiles) {
      try {
        const content = readFileSync(file.path, 'utf-8');
        const servers = extractMcpServers(content);

        for (const server of servers) {
          for (const [varName, value] of Object.entries(server.env)) {
            // Skip env var references
            if (isEnvReference(value)) continue;

            const badType = isBadEnvValue(value);
            if (badType === 'empty') {
              issues.push({
                ruleId: 'mcp/missing-env-vars',
                severity: 'warning',
                category: 'mcp',
                message: `MCP server "${server.name}" has empty env var "${varName}" in ${file.relativePath}. The server will likely fail to authenticate.`,
                file: file.path,
                suggestion: 'Set the environment variable value, or use a .env file with dotenv.',
                autoFixable: false,
              });
            } else if (badType === 'placeholder') {
              issues.push({
                ruleId: 'mcp/missing-env-vars',
                severity: 'warning',
                category: 'mcp',
                message: `MCP server "${server.name}" has placeholder env var "${varName}" in ${file.relativePath}. Value "${value}" looks like a placeholder.`,
                file: file.path,
                suggestion: 'Replace the placeholder with the actual value, or use a .env file with dotenv.',
                autoFixable: false,
              });
            }
          }
        }
      } catch {
        // skip unreadable files
      }
    }

    // Also check mcpServers in settings files
    const settingsFiles = existingFiles([
      inventory.managedSettings,
      inventory.localSettings,
      inventory.projectSettings,
      inventory.userSettings,
    ]);

    for (const file of settingsFiles) {
      try {
        const content = readFileSync(file.path, 'utf-8');
        const raw = JSON.parse(content) as Record<string, unknown>;
        const mcpServers = raw.mcpServers as Record<string, unknown> | undefined;
        if (!mcpServers || typeof mcpServers !== 'object') continue;

        const servers: McpServerEntry[] = [];
        for (const [name, config] of Object.entries(mcpServers)) {
          const serverConfig = config as Record<string, unknown>;
          const env = serverConfig.env as Record<string, string> | undefined;
          if (env && typeof env === 'object') {
            servers.push({ name, env });
          }
        }

        for (const server of servers) {
          for (const [varName, value] of Object.entries(server.env)) {
            if (isEnvReference(value)) continue;

            const badType = isBadEnvValue(value);
            if (badType === 'empty') {
              issues.push({
                ruleId: 'mcp/missing-env-vars',
                severity: 'warning',
                category: 'mcp',
                message: `MCP server "${server.name}" has empty env var "${varName}" in ${file.relativePath}. The server will likely fail to authenticate.`,
                file: file.path,
                suggestion: 'Set the environment variable value, or use a .env file with dotenv.',
                autoFixable: false,
              });
            } else if (badType === 'placeholder') {
              issues.push({
                ruleId: 'mcp/missing-env-vars',
                severity: 'warning',
                category: 'mcp',
                message: `MCP server "${server.name}" has placeholder env var "${varName}" in ${file.relativePath}. Value "${value}" looks like a placeholder.`,
                file: file.path,
                suggestion: 'Replace the placeholder with the actual value, or use a .env file with dotenv.',
                autoFixable: false,
              });
            }
          }
        }
      } catch {
        // skip
      }
    }

    return issues;
  },
};
