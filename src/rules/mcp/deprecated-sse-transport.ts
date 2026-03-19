import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { readFileSync } from 'fs';

function existingFiles(files: (FileInfo | null)[]): FileInfo[] {
  return files.filter((f): f is FileInfo => f !== null && f.exists);
}

interface McpServerConfig {
  name: string;
  type?: string;
}

function extractMcpServerTypes(content: string): McpServerConfig[] {
  try {
    const raw = JSON.parse(content) as Record<string, unknown>;
    const mcpServers = raw.mcpServers as Record<string, unknown> | undefined;
    if (!mcpServers || typeof mcpServers !== 'object') {
      return [];
    }

    const servers: McpServerConfig[] = [];
    for (const [name, config] of Object.entries(mcpServers)) {
      const serverConfig = config as Record<string, unknown>;
      servers.push({ name, type: serverConfig.type as string | undefined });
    }
    return servers;
  } catch {
    return [];
  }
}

export const deprecatedSseTransportRule: LintRule = {
  id: 'mcp/deprecated-sse-transport',
  description: 'Detect MCP servers using deprecated SSE transport',
  severity: 'info',
  category: 'mcp',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    const mcpFiles = existingFiles([inventory.projectMcp, inventory.managedMcp]);

    for (const file of mcpFiles) {
      try {
        const content = readFileSync(file.path, 'utf-8');
        const servers = extractMcpServerTypes(content);

        for (const server of servers) {
          if (server.type === 'sse') {
            issues.push({
              ruleId: 'mcp/deprecated-sse-transport',
              severity: 'info',
              category: 'mcp',
              message: `MCP server "${server.name}" uses deprecated SSE transport.`,
              file: file.path,
              suggestion:
                'Migrate to "type": "http" (Streamable HTTP). Verify the server supports Streamable HTTP first — most modern MCP servers do.',
              autoFixable: false,
              evidence: [{
                file: file.path,
                content: `"${server.name}": { "type": "sse" }`,
              }],
            });
          }
        }
      } catch {
        // skip unreadable files
      }
    }

    return issues;
  },
};
