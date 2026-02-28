import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { contradictionKeywordsRule } from '../../src/rules/rules-dir/contradiction-keywords.js';
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
    frontmatter: {},
    matchedFiles: [],
    isDead: false,
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
    // Updated fixtures have "always use tabs" + "never use spaces" and vice versa
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
});
