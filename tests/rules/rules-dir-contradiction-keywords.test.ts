import { describe, it, expect } from 'vitest';
import { join } from 'path';
import {
  contradictionKeywordsRule,
  generateCategoryPairs,
  extractTopicWords,
} from '../../src/rules/rules-dir/contradiction-keywords.js';
import { globArraysOverlap } from '../../src/utils/glob-overlap.js';
import { resolve } from '../../src/core/resolver.js';
import type { ConfigInventory, RuleFileInfo } from '../../src/types/index.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

function makeInventory(overrides: Partial<ConfigInventory> = {}): ConfigInventory {
  return {
    projectRoot: join(FIXTURES, 'cross-reference'),
    gitRoot: null,
    userSettings: null,
    projectSettings: null,
    localSettings: null,
    managedSettings: null,
    preferences: null,
    globalClaudeMd: null,
    projectClaudeMd: null,
    localClaudeMd: null,
    subdirClaudeMds: [],
    autoMemory: null,
    autoMemoryTopics: [],
    rules: [],
    projectAgents: [],
    userAgents: [],
    projectCommands: [],
    userCommands: [],
    projectSkills: [],
    projectMcp: null,
    managedMcp: null,
    plugins: [],
    hooks: [],
    totalFiles: 0,
    totalStartupTokens: 0,
    totalOnDemandTokens: 0,
    ...overrides,
  };
}

function makeRuleFileInfo(overrides: Partial<RuleFileInfo> = {}): RuleFileInfo {
  return {
    path: '/test/rule.md',
    relativePath: '.claude/rules/rule.md',
    exists: true,
    scope: 'project-shared',
    sizeBytes: 100,
    lineCount: 10,
    estimatedTokens: 50,
    gitTracked: true,
    lastModified: new Date(),

    ...overrides,
  };
}

describe('rules-dir/contradiction-keywords rule', () => {
  const resolved = resolve(makeInventory());

  it('detects contradictory tabs vs spaces rules', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      rules: [
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'always-tabs.md'),
          relativePath: '.claude/rules/always-tabs.md',
        }),
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'always-spaces.md'),
          relativePath: '.claude/rules/always-spaces.md',
        }),
      ],
    });
    const issues = contradictionKeywordsRule.check(inventory, resolved);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].ruleId).toBe('rules-dir/contradiction-keywords');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].message).toContain('contradiction');
  });

  it('passes for non-contradictory rules', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      rules: [
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'always-tabs.md'),
          relativePath: '.claude/rules/always-tabs.md',
        }),
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'no-contradiction.md'),
          relativePath: '.claude/rules/no-contradiction.md',
        }),
      ],
    });
    const issues = contradictionKeywordsRule.check(inventory, resolved);
    // tabs rule and test rule don't overlap (different globs)
    expect(issues).toHaveLength(0);
  });

  it('passes when fewer than 2 rules exist', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      rules: [
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'always-tabs.md'),
          relativePath: '.claude/rules/always-tabs.md',
        }),
      ],
    });
    const issues = contradictionKeywordsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('passes when no rules exist', () => {
    const inventory = makeInventory({ rules: [] });
    const issues = contradictionKeywordsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('skips non-existent rule files', () => {
    const inventory = makeInventory({
      rules: [
        makeRuleFileInfo({
          path: '/nonexistent/rule1.md',
          relativePath: '.claude/rules/rule1.md',
          exists: false,
        }),
        makeRuleFileInfo({
          path: '/nonexistent/rule2.md',
          relativePath: '.claude/rules/rule2.md',
          exists: false,
        }),
      ],
    });
    const issues = contradictionKeywordsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('only compares rules with overlapping globs', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    // tabs and no-contradiction have different globs (src/** vs tests/**)
    const inventory = makeInventory({
      rules: [
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'always-tabs.md'),
          relativePath: '.claude/rules/always-tabs.md',
        }),
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'no-contradiction.md'),
          relativePath: '.claude/rules/no-contradiction.md',
        }),
      ],
    });
    const issues = contradictionKeywordsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('detects always-use vs never-use contradictions', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      rules: [
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'always-tabs.md'),
          relativePath: '.claude/rules/always-tabs.md',
        }),
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'always-spaces.md'),
          relativePath: '.claude/rules/always-spaces.md',
        }),
      ],
    });
    const issues = contradictionKeywordsRule.check(inventory, resolved);
    const alwaysNeverIssues = issues.filter((i) => i.message.includes('always use vs never use'));
    expect(alwaysNeverIssues.length).toBeGreaterThan(0);
  });

  it('does not false-positive on substring phrase matches (word boundary)', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    // "refuse-tabs.md" contains "refuse tabs" (not "use tabs" as a standalone phrase)
    // "always-spaces.md" contains "use spaces"
    // With substring matching, "refuse tabs" would match "use tabs" and trigger a
    // tabs-vs-spaces contradiction. Word-boundary matching prevents this.
    const inventory = makeInventory({
      rules: [
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'refuse-tabs.md'),
          relativePath: '.claude/rules/refuse-tabs.md',
        }),
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'always-spaces.md'),
          relativePath: '.claude/rules/always-spaces.md',
        }),
      ],
    });
    const issues = contradictionKeywordsRule.check(inventory, resolved);
    const tabsVsSpaces = issues.filter((i) => i.message.includes('indent-style'));
    expect(tabsVsSpaces).toHaveLength(0);
  });

  it('does not report duplicate contradictions', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      rules: [
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'always-tabs.md'),
          relativePath: '.claude/rules/always-tabs.md',
        }),
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'always-spaces.md'),
          relativePath: '.claude/rules/always-spaces.md',
        }),
      ],
    });
    const issues = contradictionKeywordsRule.check(inventory, resolved);
    // Each contradiction pair should only be reported once per rule pair
    const pairKeys = issues.map((i) => `${i.file}|${i.message}`);
    const uniqueKeys = new Set(pairKeys);
    expect(pairKeys.length).toBe(uniqueKeys.size);
  });

  it('detects category-generated jest vs vitest contradiction', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      rules: [
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'use-jest.md'),
          relativePath: '.claude/rules/use-jest.md',
        }),
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'use-vitest.md'),
          relativePath: '.claude/rules/use-vitest.md',
        }),
      ],
    });
    const issues = contradictionKeywordsRule.check(inventory, resolved);
    const testRunnerIssues = issues.filter((i) => i.message.includes('test-runner'));
    expect(testRunnerIssues.length).toBeGreaterThan(0);
  });

  it('does not flag rules with non-overlapping globs (backend vs frontend)', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      rules: [
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'backend-rule.md'),
          relativePath: '.claude/rules/backend-rule.md',
        }),
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'frontend-rule.md'),
          relativePath: '.claude/rules/frontend-rule.md',
        }),
      ],
    });
    const issues = contradictionKeywordsRule.check(inventory, resolved);
    // backend/** and frontend/** do NOT overlap — no contradiction
    expect(issues).toHaveLength(0);
  });

  it('includes evidence with file paths, line numbers, and content', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      rules: [
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'always-tabs.md'),
          relativePath: '.claude/rules/always-tabs.md',
        }),
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'always-spaces.md'),
          relativePath: '.claude/rules/always-spaces.md',
        }),
      ],
    });
    const issues = contradictionKeywordsRule.check(inventory, resolved);
    expect(issues.length).toBeGreaterThan(0);

    // At least one issue should have evidence
    const issueWithEvidence = issues.find((i) => i.evidence && i.evidence.length > 0);
    expect(issueWithEvidence).toBeDefined();
    expect(issueWithEvidence!.evidence!.length).toBeGreaterThanOrEqual(2);

    for (const ev of issueWithEvidence!.evidence!) {
      expect(ev.file).toBeTruthy();
      expect(ev.line).toBeGreaterThan(0);
      expect(ev.content).toBeTruthy();
    }
  });

  it('does not compare a rule file against itself', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      rules: [
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'always-tabs.md'),
          relativePath: '.claude/rules/always-tabs.md',
        }),
      ],
    });
    const issues = contradictionKeywordsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('skips negation pair when topics differ (always use prettier vs never use class components)', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      rules: [
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'always-use-prettier.md'),
          relativePath: '.claude/rules/always-use-prettier.md',
        }),
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'never-use-classes.md'),
          relativePath: '.claude/rules/never-use-classes.md',
        }),
      ],
    });
    const issues = contradictionKeywordsRule.check(inventory, resolved);
    const negationIssues = issues.filter((i) => i.message.includes('always use vs never use'));
    expect(negationIssues).toHaveLength(0);
  });

  it('detects negation pair when topics match (always use prettier vs never use prettier)', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      rules: [
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'always-use-prettier.md'),
          relativePath: '.claude/rules/always-use-prettier.md',
        }),
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'never-use-prettier.md'),
          relativePath: '.claude/rules/never-use-prettier.md',
        }),
      ],
    });
    const issues = contradictionKeywordsRule.check(inventory, resolved);
    const negationIssues = issues.filter((i) => i.message.includes('always use vs never use'));
    expect(negationIssues.length).toBeGreaterThan(0);
  });

  it('TOOL_CATEGORIES pairs are unaffected by topic matching', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      rules: [
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'use-jest.md'),
          relativePath: '.claude/rules/use-jest.md',
        }),
        makeRuleFileInfo({
          path: join(crossRef, '.claude', 'rules', 'use-vitest.md'),
          relativePath: '.claude/rules/use-vitest.md',
        }),
      ],
    });
    const issues = contradictionKeywordsRule.check(inventory, resolved);
    const testRunnerIssues = issues.filter((i) => i.message.includes('test-runner'));
    expect(testRunnerIssues.length).toBeGreaterThan(0);
  });
});

describe('extractTopicWords()', () => {
  it('extracts words after phrase', () => {
    expect(extractTopicWords('Always use prettier for formatting', 'always use'))
      .toEqual(['prettier', 'formatting']);
  });

  it('filters out short words (<=3 chars)', () => {
    expect(extractTopicWords('Always use it for the job', 'always use'))
      .toEqual([]);
  });

  it('returns up to 5 words', () => {
    const result = extractTopicWords(
      'Always use alpha bravo charlie delta echo foxtrot golf',
      'always use',
    );
    expect(result).toHaveLength(5);
    expect(result).toEqual(['alpha', 'bravo', 'charlie', 'delta', 'echo']);
  });

  it('is case-insensitive', () => {
    expect(extractTopicWords('ALWAYS USE Prettier', 'always use'))
      .toEqual(['prettier']);
  });

  it('strips punctuation from words', () => {
    expect(extractTopicWords('Always use prettier.', 'always use'))
      .toEqual(['prettier']);
  });

  it('returns empty for no match', () => {
    expect(extractTopicWords('Never require tests', 'always use'))
      .toEqual([]);
  });
});

describe('globArraysOverlap()', () => {
  it('returns false for backend/** and frontend/**', () => {
    expect(globArraysOverlap(['backend/**'], ['frontend/**'])).toBe(false);
  });

  it('returns false for src/backend/** and src/frontend/**', () => {
    expect(globArraysOverlap(['src/backend/**'], ['src/frontend/**'])).toBe(false);
  });

  it('returns true for src/** and src/utils/**', () => {
    expect(globArraysOverlap(['src/**'], ['src/utils/**'])).toBe(true);
  });

  it('returns true for ** and anything', () => {
    expect(globArraysOverlap(['**'], ['src/utils/**'])).toBe(true);
    expect(globArraysOverlap(['src/**'], ['**'])).toBe(true);
  });

  it('returns true for identical globs', () => {
    expect(globArraysOverlap(['src/**/*.ts'], ['src/**/*.ts'])).toBe(true);
  });

  it('returns true when either side has no globs (empty array)', () => {
    expect(globArraysOverlap([], ['src/**'])).toBe(true);
    expect(globArraysOverlap(['src/**'], [])).toBe(true);
    expect(globArraysOverlap([], [])).toBe(true);
  });

  it('returns true when one is a segment prefix of the other', () => {
    expect(globArraysOverlap(['src/**'], ['src/components/**'])).toBe(true);
  });

  it('returns false for completely disjoint paths', () => {
    expect(globArraysOverlap(['lib/**'], ['test/**'])).toBe(false);
  });
});

describe('generateCategoryPairs()', () => {
  const pairs = generateCategoryPairs();

  it('generates expected number of pairs for test-runner category (4 tools -> 6 pairs)', () => {
    const testRunnerPairs = pairs.filter(([, , cat]) => cat === 'test-runner');
    expect(testRunnerPairs).toHaveLength(6);
  });

  it('prefixes single-word tools with "use "', () => {
    const jestPairs = pairs.filter(([a, b]) => a.includes('jest') || b.includes('jest'));
    for (const [a, b] of jestPairs) {
      if (a.includes('jest')) expect(a).toBe('use jest');
      if (b.includes('jest')) expect(b).toBe('use jest');
    }
  });

  it('uses multi-word phrases as-is without "use " prefix', () => {
    const cssPairs = pairs.filter(([, , cat]) => cat === 'css-approach');
    const cssModulesPair = cssPairs.find(([a]) => a === 'css modules');
    expect(cssModulesPair).toBeDefined();
    // "css modules" should NOT be "use css modules"
    expect(cssModulesPair![0]).toBe('css modules');
  });

  it('has no exact duplicate [phraseA, phraseB] pairs across categories', () => {
    const seen = new Set<string>();
    for (const [a, b] of pairs) {
      const key = [a, b].sort().join('|');
      expect(seen.has(key), `Duplicate pair: ${a} / ${b}`).toBe(false);
      seen.add(key);
    }
  });

  it('generates pairs deterministically', () => {
    const pairs2 = generateCategoryPairs();
    expect(pairs).toEqual(pairs2);
  });
});
