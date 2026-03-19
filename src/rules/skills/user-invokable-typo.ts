import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';
import { parseAgentMd } from '../../parsers/agents-md.js';
import { basename, dirname } from 'path';

export const userInvokableTypoRule: LintRule = {
  id: 'skills/user-invokable-typo',
  description:
    'Detect "user-invokable" (with k) typo in skill frontmatter — silently ignored by Claude Code CLI',
  severity: 'error',
  category: 'skills',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];
    const allSkills = [...inventory.projectSkills, ...inventory.userSkills];

    for (const skill of allSkills) {
      if (!skill.exists) continue;

      const parsed = parseAgentMd(skill.path);
      if (!parsed || !parsed.hasFrontmatter) continue;

      if ('user-invokable' in parsed.frontmatter) {
        const skillName =
          typeof parsed.frontmatter.name === 'string'
            ? parsed.frontmatter.name
            : basename(dirname(skill.path));

        issues.push({
          ruleId: 'skills/user-invokable-typo',
          severity: 'error',
          category: 'skills',
          message: `Skill "${skillName}" uses "user-invokable" (with k) — this field is silently ignored by Claude Code.`,
          file: skill.path,
          suggestion:
            'Rename to "user-invocable" (with c). The VS Code extension schema uses the wrong spelling.',
          autoFixable: true,
          evidence: [
            {
              file: skill.path,
              content: `user-invokable: ${parsed.frontmatter['user-invokable']}`,
            },
          ],
        });
      }
    }

    return issues;
  },
};
