import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';
import { parseRuleMd } from '../../parsers/rules-md.js';

const KNOWN_FIELDS = new Set(['paths', 'description']);

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
          message: `Rule file ${rule.relativePath} has no YAML frontmatter. Without a "paths" field, the rule applies globally.`,
          file: rule.path,
          suggestion:
            'Add YAML frontmatter with a "paths" array to scope this rule to specific files.',
          autoFixable: false,
        });
        continue;
      }

      // Validate paths field if present
      const paths = parsed.frontmatter.paths;
      if (paths !== undefined) {
        if (!Array.isArray(paths)) {
          issues.push({
            ruleId: 'rules-dir/frontmatter-valid',
            severity: 'error',
            category: 'rules',
            message: `Rule file ${rule.relativePath} has an invalid "paths" field — it must be an array of strings.`,
            file: rule.path,
            suggestion: 'Change "paths" to a YAML array of glob strings, e.g. paths: ["src/**/*.ts"].',
            autoFixable: false,
          });
        } else {
          const nonStringItems = paths.filter((p) => typeof p !== 'string');
          if (nonStringItems.length > 0) {
            issues.push({
              ruleId: 'rules-dir/frontmatter-valid',
              severity: 'error',
              category: 'rules',
              message: `Rule file ${rule.relativePath} has non-string items in the "paths" array.`,
              file: rule.path,
              suggestion: 'Ensure all items in the "paths" array are strings.',
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
