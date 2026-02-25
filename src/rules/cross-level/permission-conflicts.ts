import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';

export const permissionConflictsRule: LintRule = {
  id: 'cross-level/permission-conflicts',
  description: 'Detect contradictory permission rules across settings levels',
  severity: 'warning',
  category: 'cross-level',

  check(_inventory: ConfigInventory, resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    for (const conflict of resolved.permissions.conflicts) {
      const origins = conflict.rules.map((r) => `${r.action} at ${r.origin}`).join(', ');

      issues.push({
        ruleId: 'cross-level/permission-conflicts',
        severity: 'warning',
        category: 'cross-level',
        message: `Permission conflict for pattern '${conflict.pattern}': ${origins}. Resolved to '${conflict.resolution}'.`,
        suggestion:
          'Review permission rules across settings levels and ensure consistent allow/deny for this pattern.',
        autoFixable: false,
      });
    }

    return issues;
  },
};
