import type { LintRule, LintIssue, LintEvidence, ConfigInventory, ResolvedConfig } from '../../types/index.js';
import { parseRuleMd } from '../../parsers/rules-md.js';

/**
 * Tool/technology categories for auto-generating contradiction pairs.
 * Each category maps to a list of tools where using one typically excludes the others.
 *
 * Note: `biome` intentionally appears in both `formatter` and `linter` categories.
 * This is safe because pairs are generated intra-category — it produces
 * `['use biome', 'use prettier', 'formatter']` and `['use biome', 'use eslint', 'linter']`,
 * which are distinct pairs with different category labels.
 */
export const TOOL_CATEGORIES: Record<string, string[]> = {
  'test-runner': ['jest', 'vitest', 'mocha', 'ava'],
  'package-manager': ['npm', 'yarn', 'pnpm', 'bun'],
  'formatter': ['prettier', 'biome', 'dprint'],
  'linter': ['eslint', 'biome', 'oxlint'],
  'bundler': ['webpack', 'vite', 'esbuild', 'turbopack', 'rollup'],
  'css-approach': ['css modules', 'tailwind', 'styled-components', 'emotion'],
  'state-management': ['redux', 'zustand', 'mobx', 'jotai', 'recoil'],
  'component-style': ['class components', 'functional components'],
  'rendering-model': ['server components', 'client components'],
  'async-pattern': ['async/await', 'callbacks', 'promises'],
  'import-style': ['relative imports', 'absolute imports', 'path aliases'],
  'export-style': ['default export', 'named export'],
  'quote-style': ['single quotes', 'double quotes'],
  'indent-style': ['tabs', 'spaces'],
};

/**
 * Generate contradiction pairs from TOOL_CATEGORIES.
 * Single-word tools get "use " prefix; multi-word phrases are used as-is.
 */
export function generateCategoryPairs(): Array<[string, string, string]> {
  const pairs: Array<[string, string, string]> = [];
  for (const [category, tools] of Object.entries(TOOL_CATEGORIES)) {
    for (let i = 0; i < tools.length; i++) {
      for (let j = i + 1; j < tools.length; j++) {
        const a = tools[i].includes(' ') ? tools[i] : `use ${tools[i]}`;
        const b = tools[j].includes(' ') ? tools[j] : `use ${tools[j]}`;
        pairs.push([a, b, category]);
      }
    }
  }
  return pairs;
}

/**
 * Explicit contradiction pairs that don't fit the category model.
 * These involve negation patterns (always/never, use/no).
 */
const EXPLICIT_PAIRS: Array<[string, string, string]> = [
  ['always use', 'never use', 'always use vs never use'],
  ['always require', 'never require', 'always require vs never require'],
  ['always include', 'never include', 'always include vs never include'],
  ['use semicolons', 'no semicolons', 'semicolons'],
];

const CONTRADICTION_PAIRS: Array<[string, string, string]> = [
  ...EXPLICIT_PAIRS,
  ...generateCategoryPairs(),
];

function hasPhrase(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

/**
 * Check if two rules have overlapping globs using segment-based comparison.
 * If either rule has no globs, it applies everywhere — overlaps with everything.
 */
export function globsOverlap(globsA: string[], globsB: string[]): boolean {
  if (globsA.length === 0 || globsB.length === 0) return true;

  for (const a of globsA) {
    for (const b of globsB) {
      if (a === b) return true;

      // Compare directory segments (not character prefixes)
      const aSegments = a.replace(/\*.*$/, '').split('/').filter(Boolean);
      const bSegments = b.replace(/\*.*$/, '').split('/').filter(Boolean);

      // If either has no segments after stripping (e.g., "**"), it's global scope
      if (aSegments.length === 0 || bSegments.length === 0) return true;

      // Check if one path is a prefix of the other by segments
      const minLen = Math.min(aSegments.length, bSegments.length);
      let segmentsMatch = true;
      for (let k = 0; k < minLen; k++) {
        if (aSegments[k] !== bSegments[k]) {
          segmentsMatch = false;
          break;
        }
      }
      if (segmentsMatch) return true;
    }
  }
  return false;
}

function findMatchLine(lines: string[], phrase: string): { line: number; content: string } | null {
  for (let i = 0; i < lines.length; i++) {
    if (hasPhrase(lines[i], phrase)) {
      return { line: i + 1, content: lines[i].trim() };
    }
  }
  return null;
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
      lines: string[];
      globs: string[];
    }> = [];

    for (const rule of inventory.rules) {
      if (!rule.exists) continue;
      const parsed = parseRuleMd(rule.path, inventory.projectRoot);
      if (!parsed) continue;

      const fullText = (parsed.content || '').toLowerCase();
      if (fullText.trim().length === 0) continue;

      const lines = fullText.split('\n');
      const globs = parsed.frontmatter.globs ?? parsed.frontmatter.paths;
      const globList = Array.isArray(globs) ? globs.filter((g): g is string => typeof g === 'string') : [];

      parsedRules.push({
        filePath: rule.path,
        relativePath: rule.relativePath,
        text: fullText,
        lines,
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

          if ((aHasFirst && bHasSecond) || (aHasSecond && bHasFirst)) {
            const pairKey = [ruleA.filePath, ruleB.filePath, category].sort().join('|');
            if (reported.has(pairKey)) continue;
            reported.add(pairKey);

            // Determine which phrase was found in which file for evidence
            const matchedPhraseInA = aHasFirst ? phraseA : phraseB;
            const matchedPhraseInB = aHasFirst ? phraseB : phraseA;
            const evidenceA = findMatchLine(ruleA.lines, matchedPhraseInA);
            const evidenceB = findMatchLine(ruleB.lines, matchedPhraseInB);

            const evidence: LintEvidence[] = [];
            if (evidenceA) evidence.push({ file: ruleA.filePath, line: evidenceA.line, content: evidenceA.content });
            if (evidenceB) evidence.push({ file: ruleB.filePath, line: evidenceB.line, content: evidenceB.content });

            issues.push({
              ruleId: 'rules-dir/contradiction-keywords',
              severity: 'warning',
              category: 'rules',
              message: `Potential contradiction between "${ruleA.relativePath}" and "${ruleB.relativePath}": ${category}.`,
              file: ruleA.filePath,
              suggestion: `Review both rule files for conflicting instructions about ${category}. One says "${phraseA}" while the other says "${phraseB}".`,
              autoFixable: false,
              evidence: evidence.length > 0 ? evidence : undefined,
            });
          }
        }
      }
    }

    return issues;
  },
};
