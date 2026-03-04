import { basename } from 'path';
import type { LintRule, LintIssue, LintEvidence, ConfigInventory, ResolvedConfig } from '../../types/index.js';
import { parseRuleMd } from '../../parsers/rules-md.js';
import { extractRuleScope, globArraysOverlap, type RuleScope } from '../../utils/glob-overlap.js';

interface ClassifiedRule {
  filePath: string;
  relativePath: string;
  scope: RuleScope;
}

export const overlappingRulesRule: LintRule = {
  id: 'rules-dir/overlapping-rules',
  description: 'Detect rules with significantly overlapping file scopes',
  severity: 'info',
  category: 'rules',

  check(
    inventory: ConfigInventory,
    _resolved: ResolvedConfig,
    // options?.threshold preserved for configuration compatibility —
    // scope-based comparison is binary, threshold no longer affects comparison
    _options?: Record<string, unknown>,
  ): LintIssue[] {
    const issues: LintIssue[] = [];

    // Parse and classify all existing rules by scope
    const globalRules: ClassifiedRule[] = [];
    const scopedRules: ClassifiedRule[] = [];

    for (const rule of inventory.rules) {
      if (!rule.exists) continue;
      const parsed = parseRuleMd(rule.path, inventory.projectRoot);
      if (!parsed) continue;

      const scope = extractRuleScope(parsed);
      const classified: ClassifiedRule = {
        filePath: rule.path,
        relativePath: rule.relativePath,
        scope,
      };

      if (scope.type === 'global') {
        globalRules.push(classified);
      } else if (scope.type === 'scoped') {
        scopedRules.push(classified);
      }
      // dead rules excluded — dead-globs handles them
    }

    // --- Global-rule cluster ---
    if (globalRules.length >= 2) {
      issues.push(buildGlobalClusterIssue(globalRules));
    }

    // --- Global-vs-scoped pairs ---
    issues.push(...buildGlobalVsScopedIssues(globalRules, scopedRules));

    // --- Scoped-vs-scoped pairs ---
    for (let i = 0; i < scopedRules.length; i++) {
      for (let j = i + 1; j < scopedRules.length; j++) {
        const a = scopedRules[i];
        const b = scopedRules[j];
        const scopeA = a.scope as Extract<RuleScope, { type: 'scoped' }>;
        const scopeB = b.scope as Extract<RuleScope, { type: 'scoped' }>;

        if (globArraysOverlap(scopeA.globs, scopeB.globs)) {
          issues.push({
            ruleId: 'rules-dir/overlapping-rules',
            severity: 'info',
            category: 'rules',
            message: `Rules "${a.relativePath}" and "${b.relativePath}" have overlapping scope.`,
            file: a.filePath,
            suggestion:
              'These rules target overlapping file patterns. Consider merging them or narrowing their globs to avoid redundancy.',
            autoFixable: false,
            evidence: [
              { file: a.filePath, content: `globs: ${JSON.stringify(scopeA.globs)}` },
              { file: b.filePath, content: `globs: ${JSON.stringify(scopeB.globs)}` },
            ],
          });
        }
      }
    }

    return issues;
  },
};

function buildGlobalClusterIssue(globalRules: ClassifiedRule[]): LintIssue {
  const maxDisplay = 5;
  const names = globalRules.map((r) => basename(r.filePath));
  const displayNames =
    names.length > maxDisplay
      ? `${names.slice(0, maxDisplay).join(', ')}...and ${names.length - maxDisplay} more`
      : names.join(', ');

  const evidence: LintEvidence[] = globalRules.slice(0, maxDisplay).map((r) => ({
    file: r.filePath,
    content: `global scope (${(r.scope as Extract<RuleScope, { type: 'global' }>).reason})`,
  }));

  if (globalRules.length > maxDisplay) {
    evidence.push({
      file: globalRules[0].filePath,
      content: `...and ${globalRules.length - maxDisplay} more global rules`,
    });
  }

  return {
    ruleId: 'rules-dir/overlapping-rules',
    severity: 'info',
    category: 'rules',
    message: `${globalRules.length} rule files have no scope — all apply globally and overlap each other: ${displayNames}. Add YAML frontmatter with "globs" to scope each rule to specific file types.`,
    file: globalRules[0].filePath,
    suggestion:
      'Add YAML frontmatter with a "globs" field to each rule file to restrict its scope.',
    autoFixable: false,
    evidence,
  };
}

function buildGlobalVsScopedIssues(
  globalRules: ClassifiedRule[],
  scopedRules: ClassifiedRule[],
): LintIssue[] {
  if (globalRules.length === 0 || scopedRules.length === 0) return [];

  const pairCount = globalRules.length * scopedRules.length;

  if (pairCount > 10) {
    // Grouped issue for large cartesian products
    const maxDisplay = 5;
    const globalNames = globalRules.map((r) => basename(r.filePath));
    const displayNames =
      globalNames.length > maxDisplay
        ? `${globalNames.slice(0, maxDisplay).join(', ')}...and ${globalNames.length - maxDisplay} more`
        : globalNames.join(', ');

    const evidence: LintEvidence[] = globalRules.slice(0, maxDisplay).map((r) => ({
      file: r.filePath,
      content: `global scope (${(r.scope as Extract<RuleScope, { type: 'global' }>).reason})`,
    }));

    if (globalRules.length > maxDisplay) {
      evidence.push({
        file: globalRules[0].filePath,
        content: `...and ${globalRules.length - maxDisplay} more global rules`,
      });
    }

    return [
      {
        ruleId: 'rules-dir/overlapping-rules',
        severity: 'info',
        category: 'rules',
        message: `${globalRules.length} global rules overlap with all ${scopedRules.length} scoped rules. Global: ${displayNames}. Consider adding globs to narrow their scope.`,
        file: globalRules[0].filePath,
        suggestion:
          'Add YAML frontmatter with a "globs" field to the global rules to restrict their scope.',
        autoFixable: false,
        evidence,
      },
    ];
  }

  // Individual issues for small cartesian products
  const issues: LintIssue[] = [];
  for (const globalRule of globalRules) {
    const globalScope = globalRule.scope as Extract<RuleScope, { type: 'global' }>;
    for (const scopedRule of scopedRules) {
      const scopeB = scopedRule.scope as Extract<RuleScope, { type: 'scoped' }>;
      issues.push({
        ruleId: 'rules-dir/overlapping-rules',
        severity: 'info',
        category: 'rules',
        message: `Rule "${globalRule.relativePath}" (global, no globs) overlaps with "${scopedRule.relativePath}" (${scopeB.globs.join(', ')}). ${globalRule.relativePath} applies to all files, including those matched by ${scopedRule.relativePath}.`,
        file: globalRule.filePath,
        suggestion:
          'Add YAML frontmatter with a "globs" field to the global rule to restrict its scope.',
        autoFixable: false,
        evidence: [
          { file: globalRule.filePath, content: `global scope (${globalScope.reason})` },
          { file: scopedRule.filePath, content: `globs: ${JSON.stringify(scopeB.globs)}` },
        ],
      });
    }
  }
  return issues;
}
