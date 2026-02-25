import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { parseAgentMd } from '../../parsers/agents-md.js';

const KNOWN_FIELDS = new Set(['tools', 'model', 'allowedTools', 'description']);

export const agentFrontmatterValidRule: LintRule = {
  id: 'agents/frontmatter-valid',
  description: 'Validate YAML frontmatter fields in agent definition files',
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
      if (!parsed || !parsed.hasFrontmatter) {
        continue;
      }

      // Validate tools field if present
      if (parsed.frontmatter.tools !== undefined && !Array.isArray(parsed.frontmatter.tools)) {
        issues.push({
          ruleId: 'agents/frontmatter-valid',
          severity: 'warning',
          category: 'agents',
          message: `Agent file ${agent.relativePath} has a "tools" field that is not an array.`,
          file: agent.path,
          suggestion: 'The "tools" field should be an array of tool names, e.g. tools: ["Bash", "Read"].',
          autoFixable: false,
        });
      }

      // Validate model field if present
      if (parsed.frontmatter.model !== undefined && typeof parsed.frontmatter.model !== 'string') {
        issues.push({
          ruleId: 'agents/frontmatter-valid',
          severity: 'warning',
          category: 'agents',
          message: `Agent file ${agent.relativePath} has a "model" field that is not a string.`,
          file: agent.path,
          suggestion: 'The "model" field should be a string, e.g. model: "claude-sonnet-4-20250514".',
          autoFixable: false,
        });
      }

      // Warn on unknown fields
      for (const key of Object.keys(parsed.frontmatter)) {
        if (!KNOWN_FIELDS.has(key)) {
          issues.push({
            ruleId: 'agents/frontmatter-valid',
            severity: 'warning',
            category: 'agents',
            message: `Agent file ${agent.relativePath} has unknown frontmatter field "${key}".`,
            file: agent.path,
            suggestion: `Known fields are: ${[...KNOWN_FIELDS].join(', ')}. Remove or correct the unknown field.`,
            autoFixable: false,
          });
        }
      }
    }

    return issues;
  },
};
