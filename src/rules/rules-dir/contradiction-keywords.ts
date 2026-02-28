import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';
import { parseRuleMd } from '../../parsers/rules-md.js';

/**
 * Pairs of contradictory keywords/phrases.
 * If rule A contains phrase from column 1 and rule B contains phrase from column 2
 * (and their globs overlap), flag a potential contradiction.
 */
const CONTRADICTION_PAIRS: Array<[string, string, string]> = [
  // [phraseA, phraseB, category label]
  ['always use', 'never use', 'always use vs never use'],
  ['always require', 'never require', 'always require vs never require'],
  ['always include', 'never include', 'always include vs never include'],
  ['must not', 'must', 'must vs must not'],
  ['must never', 'must', 'must vs must never'],
  ['use tabs', 'use spaces', 'tabs vs spaces'],
  ['use jest', 'use vitest', 'jest vs vitest'],
  ['use mocha', 'use jest', 'mocha vs jest'],
  ['use npm', 'use yarn', 'npm vs yarn'],
  ['use npm', 'use pnpm', 'npm vs pnpm'],
  ['use yarn', 'use pnpm', 'yarn vs pnpm'],
  ['use semicolons', 'no semicolons', 'semicolons'],
  ['single quotes', 'double quotes', 'quote style'],
];

function hasPhrase(text: string, phrase: string): boolean {
  return text.includes(phrase);
}

/**
 * Check if two rules have overlapping globs.
 * If either rule has no globs, it applies everywhere — overlaps with everything.
 */
function globsOverlap(globsA: string[], globsB: string[]): boolean {
  if (globsA.length === 0 || globsB.length === 0) return true;

  // Simple overlap detection: check if any glob prefix matches
  for (const a of globsA) {
    for (const b of globsB) {
      if (a === b) return true;
      // If they share a common prefix pattern (e.g., "src/**" and "src/**/*.ts")
      const aBase = a.replace(/\*.*$/, '');
      const bBase = b.replace(/\*.*$/, '');
      if (aBase.startsWith(bBase) || bBase.startsWith(aBase)) return true;
    }
  }
  return false;
}

export const contradictionKeywordsRule: LintRule = {
  id: 'rules-dir/contradiction-keywords',
  description: 'Detect rule files with contradictory instructions via keyword heuristic',
  severity: 'warning',
  category: 'rules',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    if (inventory.rules.length < 2) return issues;

    // Parse all rules and cache
    const parsedRules: Array<{
      filePath: string;
      relativePath: string;
      text: string;
      globs: string[];
    }> = [];

    for (const rule of inventory.rules) {
      if (!rule.exists) continue;
      const parsed = parseRuleMd(rule.path, inventory.projectRoot);
      if (!parsed) continue;

      const fullText = (parsed.content || '').toLowerCase();
      if (fullText.trim().length === 0) continue;

      const globs = parsed.frontmatter.globs ?? parsed.frontmatter.paths;
      const globList = Array.isArray(globs) ? globs.filter((g): g is string => typeof g === 'string') : [];

      parsedRules.push({
        filePath: rule.path,
        relativePath: rule.relativePath,
        text: fullText,
        globs: globList,
      });
    }

    // Compare all pairs of rules
    const reported = new Set<string>();
    for (let i = 0; i < parsedRules.length; i++) {
      for (let j = i + 1; j < parsedRules.length; j++) {
        const ruleA = parsedRules[i];
        const ruleB = parsedRules[j];

        // Only compare rules with overlapping globs
        if (!globsOverlap(ruleA.globs, ruleB.globs)) continue;

        for (const [phraseA, phraseB, category] of CONTRADICTION_PAIRS) {
          // Check both directions
          const aHasFirst = hasPhrase(ruleA.text, phraseA);
          const bHasSecond = hasPhrase(ruleB.text, phraseB);
          const aHasSecond = hasPhrase(ruleA.text, phraseB);
          const bHasFirst = hasPhrase(ruleB.text, phraseA);

          // Skip if "must" is actually part of "must not" / "must never"
          if (phraseB === 'must') {
            const bHasMustNot = hasPhrase(ruleB.text, 'must not') || hasPhrase(ruleB.text, 'must never');
            const aHasMustNot = hasPhrase(ruleA.text, 'must not') || hasPhrase(ruleA.text, 'must never');

            if (aHasFirst && bHasSecond && bHasMustNot) continue;
            if (aHasSecond && bHasFirst && aHasMustNot) continue;
          }

          if ((aHasFirst && bHasSecond) || (aHasSecond && bHasFirst)) {
            const pairKey = [ruleA.filePath, ruleB.filePath, category].sort().join('|');
            if (reported.has(pairKey)) continue;
            reported.add(pairKey);

            issues.push({
              ruleId: 'rules-dir/contradiction-keywords',
              severity: 'warning',
              category: 'rules',
              message: `Potential contradiction between "${ruleA.relativePath}" and "${ruleB.relativePath}": ${category}.`,
              file: ruleA.filePath,
              suggestion: `Review both rule files for conflicting instructions about ${category}. One says "${phraseA}" while the other says "${phraseB}".`,
              autoFixable: false,
            });
          }
        }
      }
    }

    return issues;
  },
};
