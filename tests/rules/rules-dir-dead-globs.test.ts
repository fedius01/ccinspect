import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { deadGlobsRule } from '../../src/rules/rules-dir/dead-globs.js';
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
    pluginAgents: [],
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

describe('rules-dir/dead-globs rule', () => {
  const resolved = resolve(makeInventory());

  it('warns for dead rules (globs match no files)', () => {
    const projectRoot = join(FIXTURES, 'overconfigured');
    const inventory = makeInventory({
      projectRoot,
      rules: [
        makeRuleFileInfo({
          path: join(projectRoot, '.claude', 'rules', 'dead-rule.md'),
          relativePath: '.claude/rules/dead-rule.md',
        }),
      ],
    });
    const issues = deadGlobsRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('rules-dir/dead-globs');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].category).toBe('rules');
  });

  it('includes dead glob patterns as evidence', () => {
    const projectRoot = join(FIXTURES, 'overconfigured');
    const rulePath = join(projectRoot, '.claude', 'rules', 'dead-rule.md');
    const inventory = makeInventory({
      projectRoot,
      rules: [
        makeRuleFileInfo({
          path: rulePath,
          relativePath: '.claude/rules/dead-rule.md',
        }),
      ],
    });
    const issues = deadGlobsRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].evidence).toBeDefined();
    expect(issues[0].evidence!.length).toBe(2);
    expect(issues[0].evidence![0].file).toBe(rulePath);
    expect(issues[0].evidence![0].content).toContain('nonexistent/**/*.xyz');
    expect(issues[0].evidence![0].content).toContain('matched 0 files');
    expect(issues[0].evidence![1].content).toContain('old-src/**/*.legacy');
  });

  it('passes for live rules (globs match files)', () => {
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
    const issues = deadGlobsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('passes when no rules exist', () => {
    const inventory = makeInventory({ rules: [] });
    const issues = deadGlobsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('skips non-existent rule files', () => {
    const inventory = makeInventory({
      rules: [makeRuleFileInfo({ exists: false })],
    });
    const issues = deadGlobsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });
});
