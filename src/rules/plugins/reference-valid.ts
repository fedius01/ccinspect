import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';

const PLUGIN_ID_PATTERN = /^[\w-]+@[\w-]+$/;

export const pluginReferenceValidRule: LintRule = {
  id: 'plugins/reference-valid',
  description: 'Validate plugin references in enabledPlugins',
  severity: 'warning',
  category: 'plugins',

  check(inventory: ConfigInventory, resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    const plugins = resolved.plugins.effective;
    if (plugins.length === 0 && inventory.plugins.length === 0) return issues;

    // Check resolved plugins for valid format
    for (const plugin of plugins) {
      if (!PLUGIN_ID_PATTERN.test(plugin.id)) {
        issues.push({
          ruleId: 'plugins/reference-valid',
          severity: 'warning',
          category: 'plugins',
          message: `Plugin "${plugin.id}" has invalid ID format. Expected "plugin-name@marketplace-name".`,
          file: plugin.source,
          suggestion: 'Plugin IDs should follow the format "plugin-name@marketplace-name", e.g. "my-plugin@anthropic".',
          autoFixable: false,
        });
      }
    }

    // Also check inventory plugins
    for (const plugin of inventory.plugins) {
      if (!PLUGIN_ID_PATTERN.test(plugin.id)) {
        // Avoid duplicate if already reported from resolved
        const alreadyReported = plugins.some((p) => p.id === plugin.id);
        if (alreadyReported) continue;

        issues.push({
          ruleId: 'plugins/reference-valid',
          severity: 'warning',
          category: 'plugins',
          message: `Plugin "${plugin.id}" has invalid ID format. Expected "plugin-name@marketplace-name".`,
          file: plugin.source,
          suggestion: 'Plugin IDs should follow the format "plugin-name@marketplace-name", e.g. "my-plugin@anthropic".',
          autoFixable: false,
        });
      }
    }

    return issues;
  },
};
