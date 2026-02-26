import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';

const DEFAULT_INFO_THRESHOLD = 3000;
const DEFAULT_WARNING_THRESHOLD = 5000;

export const largeRuleFileRule: LintRule = {
  id: 'rules-dir/large-rule-file',
  description: 'Flag rule files in .claude/rules/ that exceed a token threshold',
  severity: 'info',
  category: 'rules',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig, options?: Record<string, unknown>): LintIssue[] {
    const issues: LintIssue[] = [];
    const infoThreshold = (options?.infoThreshold as number) ?? DEFAULT_INFO_THRESHOLD;
    const warningThreshold = (options?.warningThreshold as number) ?? DEFAULT_WARNING_THRESHOLD;

    for (const rule of inventory.rules) {
      if (!rule.exists) {
        continue;
      }

      const tokens = rule.estimatedTokens;

      if (tokens > warningThreshold) {
        issues.push({
          ruleId: 'rules-dir/large-rule-file',
          severity: 'warning',
          category: 'rules',
          message: `Rule file ${rule.relativePath} is ${tokens.toLocaleString()} tokens. Large rule files consume significant context on every matching prompt.`,
          file: rule.path,
          suggestion: 'Consider splitting into smaller, more focused rule files with narrower path scopes. Or extract reference material to docs/ and keep only concise instructions in the rule.',
          autoFixable: false,
        });
      } else if (tokens > infoThreshold) {
        issues.push({
          ruleId: 'rules-dir/large-rule-file',
          severity: 'info',
          category: 'rules',
          message: `Rule file ${rule.relativePath} is ${tokens.toLocaleString()} tokens. Large rule files consume significant context on every matching prompt.`,
          file: rule.path,
          suggestion: 'Consider splitting into smaller, more focused rule files with narrower path scopes. Or extract reference material to docs/ and keep only concise instructions in the rule.',
          autoFixable: false,
        });
      }
    }

    return issues;
  },
};
