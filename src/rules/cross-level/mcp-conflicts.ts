import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';

export const mcpConflictsRule: LintRule = {
  id: 'cross-level/mcp-conflicts',
  description: 'Detect MCP server conflicts across settings levels',
  severity: 'warning',
  category: 'cross-level',

  check(_inventory: ConfigInventory, resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    for (const server of resolved.mcpServers.conflicts) {
      const conflictDetails = (server.conflicts ?? [])
        .map((c) => `${c.enabled ? 'enabled' : 'disabled'} at ${c.origin}`)
        .join(', ');

      issues.push({
        ruleId: 'cross-level/mcp-conflicts',
        severity: 'warning',
        category: 'cross-level',
        message: `MCP server '${server.name}' is ${server.enabled ? 'enabled' : 'disabled'} at ${server.origin} but conflicts with: ${conflictDetails}.`,
        suggestion:
          'Review MCP server configuration across settings levels and ensure consistent enabled/disabled state.',
        autoFixable: false,
      });
    }

    return issues;
  },
};
