import type {
  LintRule,
  LintIssue,
  ConfigInventory,
  ResolvedConfig,
  FileInfo,
} from '../../types/index.js';
import { parseAgentMd } from '../../parsers/agents-md.js';

// Source: https://code.claude.com/docs/en/skills + settings-cards/skills.md v1.0.0
const KNOWN_FIELDS = new Set([
  'name',
  'description',
  'allowed-tools',
  'disable-model-invocation',
  'user-invocable',
  'context',
  'agent',
  'model',
  'argument-hint',
  'hooks',
  'license',
  'metadata',
]);

const KNOWN_FIELDS_LIST = [...KNOWN_FIELDS].join(', ');

export const skillFrontmatterValidRule: LintRule = {
  id: 'skills/frontmatter-valid',
  description: 'Validate YAML frontmatter fields in skill definition files',
  severity: 'warning',
  category: 'skills',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];
    const allSkills = [...inventory.projectSkills, ...inventory.userSkills];

    for (const skill of allSkills) {
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
      const isThirdParty = skill.isSymlink === true;
      for (const key of Object.keys(parsed.frontmatter)) {
        if (!KNOWN_FIELDS.has(key)) {
          if (isThirdParty) {
            const skillDir = extractSkillDirName(skill);
            issues.push({
              ruleId: 'skills/frontmatter-valid',
              severity: 'info',
              category: 'skills',
              message: `Third-party skill "${skillDir}" has unknown frontmatter field "${key}".`,
              file: skill.path,
              suggestion: `This skill was installed via a package manager. The field "${key}" may be used by other agents. If you maintain this skill, known fields are: ${KNOWN_FIELDS_LIST}.`,
              autoFixable: false,
            });
          } else {
            issues.push({
              ruleId: 'skills/frontmatter-valid',
              severity: 'warning',
              category: 'skills',
              message: `Skill file ${skill.relativePath} has unknown frontmatter field "${key}".`,
              file: skill.path,
              suggestion: `Known fields are: ${KNOWN_FIELDS_LIST}. Remove or correct the unknown field.`,
              autoFixable: false,
            });
          }
        }
      }
    }

    return issues;
  },
};

function extractSkillDirName(skill: FileInfo): string {
  // Extract the skill directory name from the path (e.g., "dignified-python" from ".claude/skills/dignified-python/SKILL.md")
  const parts = skill.relativePath.split('/');
  // SKILL.md is the last part, the directory name is the one before it
  return parts.length >= 2 ? parts[parts.length - 2] : skill.relativePath;
}
