import type { ConfigInventory, ResolvedConfig, LintRule, LintIssue, LintResult, LintConfig, Severity } from '../types/index.js';

export class Linter {
  private rules: LintRule[] = [];

  registerRule(rule: LintRule): void {
    this.rules.push(rule);
  }

  registerRules(rules: LintRule[]): void {
    for (const rule of rules) {
      this.registerRule(rule);
    }
  }

  run(
    inventory: ConfigInventory,
    resolved: ResolvedConfig,
    config?: LintConfig,
  ): LintResult {
    const start = Date.now();
    const issues: LintIssue[] = [];
    let rulesRun = 0;

    for (const rule of this.rules) {
      // Check if rule is disabled in config
      let ruleOptions: Record<string, unknown> | undefined;
      if (config?.rules) {
        const ruleConfig = config.rules[rule.id];
        if (ruleConfig === false) continue;
        if (typeof ruleConfig === 'object' && ruleConfig !== null) {
          ruleOptions = ruleConfig;
        }
      }

      rulesRun++;
      try {
        const ruleIssues = rule.check(inventory, resolved, ruleOptions);

        // Apply severity override from config if specified
        const severityOverride = ruleOptions?.severity as Severity | undefined;
        if (severityOverride) {
          for (const issue of ruleIssues) {
            issue.severity = severityOverride;
          }
        }

        issues.push(...ruleIssues);
      } catch (err) {
        issues.push({
          ruleId: rule.id,
          severity: 'error',
          category: rule.category,
          message: `Rule "${rule.id}" threw an error: ${err instanceof Error ? err.message : String(err)}`,
          suggestion: 'This is a bug in ccinspect. Please report it.',
          autoFixable: false,
        });
      }
    }

    const duration = Date.now() - start;

    // Count files that were checked (existing files in inventory)
    const allFiles = [
      inventory.userSettings,
      inventory.projectSettings,
      inventory.localSettings,
      inventory.managedSettings,
      inventory.preferences,
      inventory.globalClaudeMd,
      inventory.projectClaudeMd,
      inventory.localClaudeMd,
      inventory.autoMemory,
      inventory.projectMcp,
      inventory.managedMcp,
      ...inventory.subdirClaudeMds,
      ...inventory.autoMemoryTopics,
      ...inventory.rules,
      ...inventory.projectAgents,
      ...inventory.userAgents,
      ...inventory.projectCommands,
      ...inventory.userCommands,
      ...inventory.projectSkills,
    ];
    const filesChecked = allFiles.filter((f) => f !== null && f.exists).length;

    return {
      issues,
      stats: {
        errors: issues.filter((i) => i.severity === 'error').length,
        warnings: issues.filter((i) => i.severity === 'warning').length,
        infos: issues.filter((i) => i.severity === 'info').length,
        rulesRun,
        filesChecked,
        duration,
      },
    };
  }
}
