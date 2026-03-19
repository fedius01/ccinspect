import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';
import { parseRuleMd } from '../../parsers/rules-md.js';

const OVERLY_BROAD_PATTERNS = new Set([
  '**',
  '**/*',
  '**/**',
  '*',
  './**',
  './**/*',
]);

export const overlyBroadGlobRule: LintRule = {
  id: 'rules-dir/overly-broad-glob',
  description: 'Detect path-scoped rules with globs that match all files',
  severity: 'warning',
  category: 'rules',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    const allRules = [...inventory.rules, ...inventory.userRules];

    for (const rule of allRules) {
      if (!rule.exists) continue;

      const parsed = parseRuleMd(rule.path, inventory.projectRoot);
      if (!parsed || !parsed.hasFrontmatter) continue;

      const paths = (parsed.frontmatter.paths ?? parsed.frontmatter.globs) as string[] | undefined;
      if (!paths || !Array.isArray(paths) || paths.length === 0) continue;

      const broadPatterns = paths.filter(p => OVERLY_BROAD_PATTERNS.has(p.trim()));
      if (broadPatterns.length > 0) {
        issues.push({
          ruleId: 'rules-dir/overly-broad-glob',
          severity: 'warning',
          category: 'rules',
          message: `Rule "${rule.relativePath}" has paths: ["${broadPatterns.join('", "')}"] which matches all files. This is functionally unconditional but uses path-scoped loading.`,
          file: rule.path,
          suggestion:
            'Remove the paths: frontmatter to make this rule truly unconditional (always loaded at session start). Path-scoped loading only triggers when Claude reads a file, risking write-blindness.',
          autoFixable: true,
          evidence: broadPatterns.map(p => ({
            file: rule.path,
            content: `paths: ["${p}"] — matches all files`,
          })),
        });
      }
    }

    return issues;
  },
};
