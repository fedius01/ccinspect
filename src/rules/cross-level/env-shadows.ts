import { basename } from 'path';
import type { LintRule, LintIssue, LintEvidence, ConfigInventory, ResolvedConfig } from '../../types/index.js';

export const envShadowsRule: LintRule = {
  id: 'cross-level/env-shadows',
  description: 'Detect environment variables set at multiple levels',
  severity: 'info',
  category: 'cross-level',

  check(_inventory: ConfigInventory, resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    for (const shadow of resolved.environment.shadows) {
      const shadowedValues = shadow.shadowedValues ?? [];
      const shadowedFiles = shadowedValues.map((sv) => basename(sv.origin));

      const evidence: LintEvidence[] = [
        { file: shadow.origin, content: `${shadow.name}=${shadow.value}` },
        ...shadowedValues.map((sv) => ({
          file: sv.origin,
          content: `${shadow.name}=${sv.value} (shadowed)`,
        })),
      ];

      issues.push({
        ruleId: 'cross-level/env-shadows',
        severity: 'info',
        category: 'cross-level',
        message: `${shadow.name} is set at multiple levels \u2014 effective value from ${basename(shadow.origin)} shadows ${shadowedFiles.join(', ')}`,
        suggestion:
          'Review if the override is intentional. Remove from lower-precedence files if redundant.',
        autoFixable: false,
        evidence,
      });
    }

    return issues;
  },
};
