import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';
import { basename, dirname } from 'path';

const DEFAULT_WARN_THRESHOLD = 500;
const DEFAULT_ERROR_THRESHOLD = 1000;

export const skillTooLargeRule: LintRule = {
  id: 'skills/too-large',
  description: 'Flag skill files that exceed the recommended line limit',
  severity: 'warning',
  category: 'skills',

  check(
    inventory: ConfigInventory,
    _resolved: ResolvedConfig,
    options?: Record<string, unknown>,
  ): LintIssue[] {
    const issues: LintIssue[] = [];
    const warnThreshold = (options?.warn as number) ?? DEFAULT_WARN_THRESHOLD;
    const errorThreshold = (options?.error as number) ?? DEFAULT_ERROR_THRESHOLD;
    const allSkills = [...inventory.projectSkills, ...inventory.userSkills];

    for (const skill of allSkills) {
      if (!skill.exists) continue;

      const lines = skill.lineCount;
      if (lines <= warnThreshold) continue;

      const skillName = basename(dirname(skill.path));

      if (lines > errorThreshold) {
        issues.push({
          ruleId: 'skills/too-large',
          severity: 'error',
          category: 'skills',
          message: `Skill "${skillName}" is ${lines.toLocaleString()} lines (recommended: ${warnThreshold}).`,
          file: skill.path,
          suggestion:
            'Move reference material to supporting files in the skill directory for progressive loading.',
          autoFixable: false,
          evidence: [{ file: skill.path, content: `${lines} lines` }],
        });
      } else {
        issues.push({
          ruleId: 'skills/too-large',
          severity: 'warning',
          category: 'skills',
          message: `Skill "${skillName}" is ${lines.toLocaleString()} lines (recommended: ${warnThreshold}).`,
          file: skill.path,
          suggestion:
            'Move reference material to supporting files in the skill directory for progressive loading.',
          autoFixable: false,
          evidence: [{ file: skill.path, content: `${lines} lines` }],
        });
      }
    }

    return issues;
  },
};
