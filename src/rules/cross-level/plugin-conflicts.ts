import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';

export const pluginConflictsRule: LintRule = {
  id: 'cross-level/plugin-conflicts',
  description: 'Detect plugin enable/disable conflicts across settings levels',
  severity: 'warning',
  category: 'cross-level',

  check(_inventory: ConfigInventory, resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    for (const plugin of resolved.plugins.conflicts) {
      const conflictSources = (plugin.conflicts ?? []).join(', ');

      issues.push({
        ruleId: 'cross-level/plugin-conflicts',
        severity: 'warning',
        category: 'cross-level',
        message: `Plugin '${plugin.id}' is ${plugin.enabled ? 'enabled' : 'disabled'} at ${plugin.source} but has conflicting settings at ${conflictSources}.`,
        suggestion:
          'Review plugin configuration across settings levels and ensure consistent enabled/disabled state.',
        autoFixable: false,
      });
    }

    return issues;
  },
};
