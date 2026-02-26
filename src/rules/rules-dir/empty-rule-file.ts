import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';
import { readFileSync } from 'fs';
import matter from 'gray-matter';

export const emptyRuleFileRule: LintRule = {
  id: 'rules-dir/empty-rule-file',
  description: 'Flag rule files in .claude/rules/ that have no meaningful content',
  severity: 'warning',
  category: 'rules',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    for (const rule of inventory.rules) {
      if (!rule.exists) {
        continue;
      }

      try {
        const raw = readFileSync(rule.path, 'utf-8');

        // Check if file is completely empty or whitespace-only
        if (raw.trim().length === 0) {
          issues.push({
            ruleId: 'rules-dir/empty-rule-file',
            severity: 'warning',
            category: 'rules',
            message: `Rule file ${rule.relativePath} has no content. Empty rules waste a file slot without providing instructions.`,
            file: rule.path,
            suggestion: 'Add instruction content or remove the file.',
            autoFixable: false,
          });
          continue;
        }

        // Parse frontmatter to check if only frontmatter exists with no body
        const parsed = matter(raw);
        const bodyContent = parsed.content.trim();

        if (bodyContent.length === 0) {
          issues.push({
            ruleId: 'rules-dir/empty-rule-file',
            severity: 'warning',
            category: 'rules',
            message: `Rule file ${rule.relativePath} has only YAML frontmatter with no instruction content. Empty rules waste a file slot without providing instructions.`,
            file: rule.path,
            suggestion: 'Add instruction content or remove the file.',
            autoFixable: false,
          });
        }
      } catch {
        // skip unreadable files
      }
    }

    return issues;
  },
};
