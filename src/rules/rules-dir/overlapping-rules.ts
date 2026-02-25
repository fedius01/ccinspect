import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';
import { parseRuleMd, type ParsedRule } from '../../parsers/rules-md.js';

const DEFAULT_THRESHOLD = 0.8;

export const overlappingRulesRule: LintRule = {
  id: 'rules-dir/overlapping-rules',
  description: 'Detect rules with significantly overlapping file scopes',
  severity: 'info',
  category: 'rules',

  check(
    inventory: ConfigInventory,
    _resolved: ResolvedConfig,
    options?: Record<string, unknown>,
  ): LintIssue[] {
    const issues: LintIssue[] = [];
    const threshold = (options?.threshold as number) ?? DEFAULT_THRESHOLD;

    // Parse all existing rules
    const parsedRules: ParsedRule[] = [];
    for (const rule of inventory.rules) {
      if (!rule.exists) {
        continue;
      }
      const parsed = parseRuleMd(rule.path, inventory.projectRoot);
      if (parsed && parsed.matchedFiles.length > 0) {
        parsedRules.push(parsed);
      }
    }

    // Compare each pair of rules
    for (let i = 0; i < parsedRules.length; i++) {
      for (let j = i + 1; j < parsedRules.length; j++) {
        const a = parsedRules[i];
        const b = parsedRules[j];

        const setA = new Set(a.matchedFiles);
        const setB = new Set(b.matchedFiles);
        const intersection = a.matchedFiles.filter((f) => setB.has(f));

        if (intersection.length === 0) {
          continue;
        }

        const minSize = Math.min(setA.size, setB.size);
        const overlapRatio = intersection.length / minSize;

        if (overlapRatio > threshold) {
          issues.push({
            ruleId: 'rules-dir/overlapping-rules',
            severity: 'info',
            category: 'rules',
            message: `Rules ${a.filePath} and ${b.filePath} have ${(overlapRatio * 100).toFixed(0)}% file scope overlap (${intersection.length} shared files).`,
            file: a.filePath,
            suggestion:
              'These rules target largely the same files. Consider merging them or narrowing their path globs to avoid redundancy.',
            autoFixable: false,
          });
        }
      }
    }

    return issues;
  },
};
