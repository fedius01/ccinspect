import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { parseAgentMd } from '../../parsers/agents-md.js';

// Source: https://code.claude.com/docs/en/sub-agents + changelog (retrieved 2026-03-06)
// See docs/settings-cards/agents.md v1.1.0 for full field reference
const KNOWN_FIELDS = new Set([
  'name',
  'description',
  'tools',
  'disallowedTools',
  'model',
  'permissionMode',
  'skills',
  'mcpServers',
  'hooks',
  'maxTurns',
  'memory',
  'color',
  'background',
  'isolation',
]);

// Fields that are explicitly invalid with specific fix suggestions
const INVALID_FIELDS: Record<string, string> = {
  allowedTools:
    'allowedTools is not valid agent frontmatter — it is silently ignored. Use tools (allowlist) or disallowedTools (denylist) instead. Note: Skills use allowed-tools (hyphenated), which is also invalid here.',
};

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

      // Check for missing required name field (error severity — can void entire agent directory)
      if (parsed.frontmatter.name === undefined) {
        issues.push({
          ruleId: 'agents/frontmatter-valid',
          severity: 'error',
          category: 'agents',
          message: `Agent file ${agent.relativePath} missing required name field. A missing or malformed name can silently prevent all agents in the directory from loading (GitHub #6377, #17154).`,
          file: agent.path,
          suggestion: 'Add a name field to the frontmatter, e.g. name: "my-agent".',
          autoFixable: false,
        });
      }

      // Validate tools field if present
      if (
        parsed.frontmatter.tools !== undefined &&
        typeof parsed.frontmatter.tools !== 'string' &&
        !Array.isArray(parsed.frontmatter.tools)
      ) {
        issues.push({
          ruleId: 'agents/frontmatter-valid',
          severity: 'warning',
          category: 'agents',
          message: `Agent file ${agent.relativePath} has a "tools" field that is not a string or array.`,
          file: agent.path,
          suggestion:
            'The "tools" field should be a comma-separated string or array, e.g. tools: "Bash, Read" or tools: ["Bash", "Read"].',
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

      // Check for explicitly invalid fields, then unknown fields
      for (const key of Object.keys(parsed.frontmatter)) {
        if (key in INVALID_FIELDS) {
          issues.push({
            ruleId: 'agents/frontmatter-valid',
            severity: 'warning',
            category: 'agents',
            message: `Agent file ${agent.relativePath}: ${INVALID_FIELDS[key]}`,
            file: agent.path,
            suggestion: 'Remove allowedTools and use tools or disallowedTools instead.',
            autoFixable: false,
          });
        } else if (!KNOWN_FIELDS.has(key)) {
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
