import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';
import { parseRuleMd } from '../../parsers/rules-md.js';

const KNOWN_FIELDS = new Set(['paths', 'globs', 'description']);

export const frontmatterValidRule: LintRule = {
  id: 'rules-dir/frontmatter-valid',
  description: 'Validate YAML frontmatter in rule files',
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

      if (!parsed.hasFrontmatter) {
        issues.push({
          ruleId: 'rules-dir/frontmatter-valid',
          severity: 'warning',
          category: 'rules',
          message: `Rule file ${rule.relativePath} has no YAML frontmatter. Without a "globs" field, the rule applies globally.`,
          file: rule.path,
          suggestion:
            'Add YAML frontmatter with a "globs" array to scope this rule to specific files.',
          autoFixable: false,
        });
        continue;
      }

      // Validate globs/paths field if present (Claude Code supports both field names)
      const globsOrPaths = parsed.frontmatter.globs ?? parsed.frontmatter.paths;
      const fieldName = parsed.frontmatter.globs !== undefined ? 'globs' : 'paths';
      if (globsOrPaths !== undefined) {
        if (!Array.isArray(globsOrPaths)) {
          issues.push({
            ruleId: 'rules-dir/frontmatter-valid',
            severity: 'error',
            category: 'rules',
            message: `Rule file ${rule.relativePath} has an invalid "${fieldName}" field — it must be an array of strings.`,
            file: rule.path,
            suggestion: `Change "${fieldName}" to a YAML array of glob strings, e.g. ${fieldName}: ["src/**/*.ts"].`,
            autoFixable: false,
          });
        } else {
          const nonStringItems = globsOrPaths.filter((p) => typeof p !== 'string');
          if (nonStringItems.length > 0) {
            issues.push({
              ruleId: 'rules-dir/frontmatter-valid',
              severity: 'error',
              category: 'rules',
              message: `Rule file ${rule.relativePath} has non-string items in the "${fieldName}" array.`,
              file: rule.path,
              suggestion: `Ensure all items in the "${fieldName}" array are strings.`,
              autoFixable: false,
            });
          }
        }
      }

      // Warn on unknown fields
      for (const key of Object.keys(parsed.frontmatter)) {
        if (!KNOWN_FIELDS.has(key)) {
          issues.push({
            ruleId: 'rules-dir/frontmatter-valid',
            severity: 'warning',
            category: 'rules',
            message: `Rule file ${rule.relativePath} has unknown frontmatter field "${key}".`,
            file: rule.path,
            suggestion: `Known fields are: ${[...KNOWN_FIELDS].join(', ')}. Remove or correct the unknown field.`,
            autoFixable: false,
          });
        }
      }
    }

    return issues;
  },
};
