import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { parseAgentMd } from '../../parsers/agents-md.js';

export const agentFrontmatterPresentRule: LintRule = {
  id: 'agents/frontmatter-present',
  description: 'Check that agent definition files have YAML frontmatter',
  severity: 'warning',
  category: 'agents',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    const allAgents: FileInfo[] = [...inventory.projectAgents, ...inventory.userAgents];

    for (const agent of allAgents) {
      if (!agent.exists) {
        continue;
      }

      const parsed = parseAgentMd(agent.path);
      if (!parsed) {
        continue;
      }

      if (!parsed.hasFrontmatter) {
        issues.push({
          ruleId: 'agents/frontmatter-present',
          severity: 'warning',
          category: 'agents',
          message: `Agent file ${agent.relativePath} has no YAML frontmatter.`,
          file: agent.path,
          suggestion:
            'Add YAML frontmatter with fields like "tools", "model", and "allowedTools" to configure the agent.',
          autoFixable: false,
        });
      }
    }

    return issues;
  },
};
