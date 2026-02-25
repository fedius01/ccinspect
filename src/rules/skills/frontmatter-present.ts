import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';
import { parseAgentMd } from '../../parsers/agents-md.js';

export const skillFrontmatterPresentRule: LintRule = {
  id: 'skills/frontmatter-present',
  description: 'Check that skill definition files have YAML frontmatter',
  severity: 'warning',
  category: 'skills',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    for (const skill of inventory.projectSkills) {
      if (!skill.exists) {
        continue;
      }

      const parsed = parseAgentMd(skill.path);
      if (!parsed) {
        continue;
      }

      if (!parsed.hasFrontmatter) {
        issues.push({
          ruleId: 'skills/frontmatter-present',
          severity: 'warning',
          category: 'skills',
          message: `Skill file ${skill.relativePath} has no YAML frontmatter.`,
          file: skill.path,
          suggestion:
            'Add YAML frontmatter with required fields "name" and "description" to define the skill.',
          autoFixable: false,
        });
      }
    }

    return issues;
  },
};
