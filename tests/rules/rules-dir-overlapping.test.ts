import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { overlappingRulesRule } from '../../src/rules/rules-dir/overlapping-rules.js';
import { resolve } from '../../src/core/resolver.js';
import type { ConfigInventory, RuleFileInfo } from '../../src/types/index.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

function makeInventory(overrides: Partial<ConfigInventory> = {}): ConfigInventory {
  return {
    projectRoot: '/test',
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

describe('rules-dir/overlapping-rules rule', () => {
  const resolved = resolve(makeInventory());

  it('detects overlapping rules in overconfigured fixture', () => {
    const projectRoot = join(FIXTURES, 'overconfigured');
    const inventory = makeInventory({
      projectRoot,
      rules: [
        makeRuleFileInfo({
          path: join(projectRoot, '.claude', 'rules', 'typescript.md'),
          relativePath: '.claude/rules/typescript.md',
        }),
        makeRuleFileInfo({
          path: join(projectRoot, '.claude', 'rules', 'ts-strict.md'),
          relativePath: '.claude/rules/ts-strict.md',
        }),
      ],
    });
    const issues = overlappingRulesRule.check(inventory, resolved);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].ruleId).toBe('rules-dir/overlapping-rules');
    expect(issues[0].severity).toBe('info');
    expect(issues[0].category).toBe('rules');
  });

  it('passes when rules have non-overlapping scopes', () => {
    const projectRoot = join(FIXTURES, 'full-project');
    const inventory = makeInventory({
      projectRoot,
      rules: [
        makeRuleFileInfo({
          path: join(projectRoot, '.claude', 'rules', 'typescript.md'),
          relativePath: '.claude/rules/typescript.md',
        }),
        makeRuleFileInfo({
          path: join(projectRoot, '.claude', 'rules', 'testing.md'),
          relativePath: '.claude/rules/testing.md',
        }),
      ],
    });
    const issues = overlappingRulesRule.check(inventory, resolved);
    // typescript targets src/**/*.ts, testing targets tests/**/*.ts
    // There may be some overlap if src/**/*.test.ts matches — depends on fixture files
    // But generally these should be non-overlapping or below threshold
    expect(issues).toHaveLength(0);
  });

  it('passes when no rules exist', () => {
    const inventory = makeInventory({ rules: [] });
    const issues = overlappingRulesRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('passes with single rule', () => {
    const projectRoot = join(FIXTURES, 'overconfigured');
    const inventory = makeInventory({
      projectRoot,
      rules: [
        makeRuleFileInfo({
          path: join(projectRoot, '.claude', 'rules', 'typescript.md'),
          relativePath: '.claude/rules/typescript.md',
        }),
      ],
    });
    const issues = overlappingRulesRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });
});
