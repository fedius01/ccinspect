import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';

export const envShadowsRule: LintRule = {
  id: 'cross-level/env-shadows',
  description: 'Detect environment variables set at multiple levels',
  severity: 'info',
  category: 'cross-level',

  check(_inventory: ConfigInventory, resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    for (const shadow of resolved.environment.shadows) {
      const otherOrigins = (shadow.shadowedValues ?? []).map((sv) => sv.origin).join(', ');

      issues.push({
        ruleId: 'cross-level/env-shadows',
        severity: 'info',
        category: 'cross-level',
        message: `Environment variable '${shadow.name}' is set at multiple levels. Effective value from ${shadow.origin} shadows values from ${otherOrigins}.`,
        suggestion:
          'Review if the env var override is intentional. Remove from lower-precedence files if redundant.',
        autoFixable: false,
      });
    }

    return issues;
  },
};
