import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';
import { parseAgentMd } from '../../parsers/agents-md.js';

const KNOWN_FIELDS = new Set(['name', 'description']);

export const skillFrontmatterValidRule: LintRule = {
  id: 'skills/frontmatter-valid',
  description: 'Validate YAML frontmatter fields in skill definition files',
  severity: 'warning',
  category: 'skills',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    for (const skill of inventory.projectSkills) {
      if (!skill.exists) {
        continue;
      }

      const parsed = parseAgentMd(skill.path);
      if (!parsed || !parsed.hasFrontmatter) {
        continue;
      }

      // Check required field: name
      if (parsed.frontmatter.name === undefined) {
        issues.push({
          ruleId: 'skills/frontmatter-valid',
          severity: 'warning',
          category: 'skills',
          message: `Skill file ${skill.relativePath} is missing the required "name" field in frontmatter.`,
          file: skill.path,
          suggestion: 'Add a "name" field to the YAML frontmatter, e.g. name: "my-skill".',
          autoFixable: false,
        });
      } else if (typeof parsed.frontmatter.name !== 'string') {
        issues.push({
          ruleId: 'skills/frontmatter-valid',
          severity: 'warning',
          category: 'skills',
          message: `Skill file ${skill.relativePath} has a "name" field that is not a string.`,
          file: skill.path,
          suggestion: 'The "name" field should be a string.',
          autoFixable: false,
        });
      }

      // Check required field: description
      if (parsed.frontmatter.description === undefined) {
        issues.push({
          ruleId: 'skills/frontmatter-valid',
          severity: 'warning',
          category: 'skills',
          message: `Skill file ${skill.relativePath} is missing the required "description" field in frontmatter.`,
          file: skill.path,
          suggestion:
            'Add a "description" field to the YAML frontmatter, e.g. description: "A skill that does X".',
          autoFixable: false,
        });
      } else if (typeof parsed.frontmatter.description !== 'string') {
        issues.push({
          ruleId: 'skills/frontmatter-valid',
          severity: 'warning',
          category: 'skills',
          message: `Skill file ${skill.relativePath} has a "description" field that is not a string.`,
          file: skill.path,
          suggestion: 'The "description" field should be a string.',
          autoFixable: false,
        });
      }

      // Warn on unknown fields
      for (const key of Object.keys(parsed.frontmatter)) {
        if (!KNOWN_FIELDS.has(key)) {
          issues.push({
            ruleId: 'skills/frontmatter-valid',
            severity: 'warning',
            category: 'skills',
            message: `Skill file ${skill.relativePath} has unknown frontmatter field "${key}".`,
            file: skill.path,
            suggestion: `Known fields are: ${[...KNOWN_FIELDS].join(', ')}. Remove or correct the unknown field.`,
            autoFixable: false,
          });
        }
      }
    }

    return issues;
  },
};
