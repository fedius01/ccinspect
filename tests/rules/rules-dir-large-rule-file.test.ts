import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { largeRuleFileRule } from '../../src/rules/rules-dir/large-rule-file.js';
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

describe('rules-dir/large-rule-file rule', () => {
  const resolved = resolve(makeInventory());

  it('flags rule files exceeding 3000 tokens as info', () => {
    const inventory = makeInventory({
      rules: [
        makeRuleFileInfo({
          relativePath: '.claude/rules/large-rule.md',
          estimatedTokens: 3500,
        }),
      ],
    });
    const issues = largeRuleFileRule.check(inventory, resolved);

    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('rules-dir/large-rule-file');
    expect(issues[0].severity).toBe('info');
    expect(issues[0].category).toBe('rules');
    expect(issues[0].message).toContain('large-rule.md');
    expect(issues[0].message).toContain('tokens');
    expect(issues[0].suggestion).toContain('splitting');
  });

  it('escalates to warning at 5000 tokens', () => {
    const inventory = makeInventory({
      rules: [
        makeRuleFileInfo({
          estimatedTokens: 5500,
          relativePath: '.claude/rules/massive.md',
        }),
      ],
    });
    const issues = largeRuleFileRule.check(inventory, resolved);

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
  });

  it('reports info severity between 3000 and 5000 tokens', () => {
    const inventory = makeInventory({
      rules: [
        makeRuleFileInfo({
          estimatedTokens: 3500,
          relativePath: '.claude/rules/medium.md',
        }),
      ],
    });
    const issues = largeRuleFileRule.check(inventory, resolved);

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('info');
  });

  it('does not flag small rule files', () => {
    const inventory = makeInventory({
      rules: [
        makeRuleFileInfo({
          path: join(FIXTURES, 'overconfigured', '.claude', 'rules', 'typescript.md'),
          relativePath: '.claude/rules/typescript.md',
          estimatedTokens: 80,
        }),
      ],
    });
    const issues = largeRuleFileRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('does not flag when no rules exist', () => {
    const inventory = makeInventory({ rules: [] });
    const issues = largeRuleFileRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('skips non-existent rule files', () => {
    const inventory = makeInventory({
      rules: [makeRuleFileInfo({ exists: false, estimatedTokens: 5000 })],
    });
    const issues = largeRuleFileRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('respects custom threshold options', () => {
    const inventory = makeInventory({
      rules: [
        makeRuleFileInfo({
          estimatedTokens: 500,
          relativePath: '.claude/rules/custom.md',
        }),
      ],
    });

    // With a low info threshold of 400, this should trigger
    const issues = largeRuleFileRule.check(inventory, resolved, { infoThreshold: 400 });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('info');
  });

  it('checks multiple rule files and only flags large ones', () => {
    const inventory = makeInventory({
      rules: [
        makeRuleFileInfo({
          estimatedTokens: 50,
          relativePath: '.claude/rules/small.md',
        }),
        makeRuleFileInfo({
          estimatedTokens: 3500,
          relativePath: '.claude/rules/medium-large.md',
        }),
        makeRuleFileInfo({
          estimatedTokens: 6000,
          relativePath: '.claude/rules/huge.md',
        }),
      ],
    });
    const issues = largeRuleFileRule.check(inventory, resolved);

    expect(issues).toHaveLength(2);
    const mediumIssue = issues.find((i) => i.message.includes('medium-large.md'));
    const hugeIssue = issues.find((i) => i.message.includes('huge.md'));
    expect(mediumIssue).toBeDefined();
    expect(mediumIssue!.severity).toBe('info');
    expect(hugeIssue).toBeDefined();
    expect(hugeIssue!.severity).toBe('warning');
  });
});
