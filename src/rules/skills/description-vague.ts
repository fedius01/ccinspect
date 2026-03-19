import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';
import { parseAgentMd } from '../../parsers/agents-md.js';
import { basename, dirname } from 'path';

const VAGUE_PATTERNS = [
  /\bhelps with\b/i,
  /\buse when needed\b/i,
  /\bfor tasks\b/i,
  /\ba skill that\b/i,
  /\bgeneral purpose\b/i,
];

const MIN_DESCRIPTION_LENGTH = 20;

export const skillDescriptionVagueRule: LintRule = {
  id: 'skills/description-vague',
  description:
    'Detect skills with missing, very short, or vague descriptions that hurt auto-invocation reliability',
  severity: 'info',
  category: 'skills',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];
    const allSkills = [...inventory.projectSkills, ...inventory.userSkills];

    for (const skill of allSkills) {
      if (!skill.exists) continue;

      const parsed = parseAgentMd(skill.path);
      if (!parsed || !parsed.hasFrontmatter) continue;

      const skillName =
        typeof parsed.frontmatter.name === 'string'
          ? parsed.frontmatter.name
          : basename(dirname(skill.path));

      const suggestion =
        'Write a description that explains when to use this skill and what it does. Example: "Generates database migration files when schema changes are needed. Use for adding columns, creating tables, or modifying indexes."';

      // Check: description missing
      if (parsed.frontmatter.description === undefined) {
        issues.push({
          ruleId: 'skills/description-vague',
          severity: 'info',
          category: 'skills',
          message: `Skill "${skillName}" has no description. Claude cannot auto-invoke skills without a description.`,
          file: skill.path,
          suggestion,
          autoFixable: false,
        });
        continue;
      }

      if (typeof parsed.frontmatter.description !== 'string') continue;

      const description = parsed.frontmatter.description;

      // Check: description too short
      if (description.length < MIN_DESCRIPTION_LENGTH) {
        issues.push({
          ruleId: 'skills/description-vague',
          severity: 'info',
          category: 'skills',
          message: `Skill "${skillName}" description is only ${description.length} chars. Descriptions under ${MIN_DESCRIPTION_LENGTH} characters are unlikely to trigger reliable auto-invocation.`,
          file: skill.path,
          suggestion,
          autoFixable: false,
          evidence: [{ file: skill.path, content: `description: "${description}"` }],
        });
        continue;
      }

      // Check: vague language
      for (const pattern of VAGUE_PATTERNS) {
        const match = description.match(pattern);
        if (match) {
          issues.push({
            ruleId: 'skills/description-vague',
            severity: 'info',
            category: 'skills',
            message: `Skill "${skillName}" description uses vague language ("${match[0]}"). Specific descriptions improve auto-invocation reliability.`,
            file: skill.path,
            suggestion,
            autoFixable: false,
            evidence: [{ file: skill.path, content: `description: "${description}"` }],
          });
          break; // Only report first vague match per skill
        }
      }
    }

    return issues;
  },
};
