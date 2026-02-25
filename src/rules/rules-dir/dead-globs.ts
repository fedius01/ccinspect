import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';
import { parseRuleMd } from '../../parsers/rules-md.js';

export const deadGlobsRule: LintRule = {
  id: 'rules-dir/dead-globs',
  description: 'Detect rule files with path globs that match no files in the project',
  severity: 'warning',
  category: 'rules',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    for (const rule of inventory.rules) {
      if (!rule.exists) {
        continue;
      }

      const parsed = parseRuleMd(rule.path, inventory.projectRoot);
      if (!parsed) {
        continue;
      }

      if (parsed.isDead) {
        issues.push({
          ruleId: 'rules-dir/dead-globs',
          severity: 'warning',
          category: 'rules',
          message: `Rule file ${rule.relativePath} has path globs that match no files in the project.`,
          file: rule.path,
          suggestion:
            'Rule file has path globs that match no files in the project. Consider removing or updating the paths.',
          autoFixable: false,
        });
      }
    }

    return issues;
  },
};
