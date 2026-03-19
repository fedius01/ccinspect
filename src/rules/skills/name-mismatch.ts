import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';
import { parseAgentMd } from '../../parsers/agents-md.js';
import { basename, dirname } from 'path';

export const skillNameMismatchRule: LintRule = {
  id: 'skills/name-mismatch',
  description:
    'Detect when skill frontmatter name differs from the directory name',
  severity: 'warning',
  category: 'skills',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];
    const allSkills = [...inventory.projectSkills, ...inventory.userSkills];

    for (const skill of allSkills) {
      if (!skill.exists) continue;

      const parsed = parseAgentMd(skill.path);
      if (!parsed || !parsed.hasFrontmatter) continue;

      const nameField = parsed.frontmatter.name;
      if (typeof nameField !== 'string') continue;

      // Use the symlink directory name (not resolved target) since that's what the user sees
      const dirName = basename(dirname(skill.path));

      if (dirName !== nameField) {
        issues.push({
          ruleId: 'skills/name-mismatch',
          severity: 'warning',
          category: 'skills',
          message: `Skill directory "${dirName}" doesn't match frontmatter name "${nameField}". The slash command will be /${nameField}.`,
          file: skill.path,
          suggestion:
            'Rename the directory to match the name field, or update the name field to match the directory. The slash command derives from the name field.',
          autoFixable: false,
          evidence: [
            { file: skill.path, content: `directory: ${dirName}, name: ${nameField}` },
          ],
        });
      }
    }

    return issues;
  },
};
