import { describe, it, expect } from 'vitest';
import { tokenBudgetRule } from '../../src/rules/memory/token-budget.js';
import { resolve } from '../../src/core/resolver.js';
import type { ConfigInventory, FileInfo } from '../../src/types/index.js';

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

function makeFileInfo(overrides: Partial<FileInfo> = {}): FileInfo {
  return {
    path: '/test/CLAUDE.md',
    relativePath: 'CLAUDE.md',
    exists: true,
    scope: 'project-shared',
    sizeBytes: 100,
    lineCount: 50,
    estimatedTokens: 200,
    gitTracked: false,
    lastModified: new Date(),
    ...overrides,
  };
}

describe('memory/token-budget rule', () => {
  const resolved = resolve(makeInventory());

  it('passes for files under 1800 tokens', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({ estimatedTokens: 1000 }),
    });
    const issues = tokenBudgetRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('warns for files between 1800 and 4500 tokens', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({ estimatedTokens: 2500 }),
    });
    const issues = tokenBudgetRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].ruleId).toBe('memory/token-budget');
    expect(issues[0].category).toBe('memory');
  });

  it('errors for files over 4500 tokens', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({ estimatedTokens: 5000 }),
    });
    const issues = tokenBudgetRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].ruleId).toBe('memory/token-budget');
  });

  it('checks multiple CLAUDE.md files', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({ estimatedTokens: 2000, relativePath: 'CLAUDE.md' }),
      globalClaudeMd: makeFileInfo({
        estimatedTokens: 2500,
        path: '/home/.claude/CLAUDE.md',
        relativePath: '~/.claude/CLAUDE.md',
      }),
    });
    const issues = tokenBudgetRule.check(inventory, resolved);
    expect(issues).toHaveLength(2);
  });

  it('skips non-existent files', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({ exists: false, estimatedTokens: 5000 }),
    });
    const issues = tokenBudgetRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('respects custom thresholds via options', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({ estimatedTokens: 500 }),
    });
    const issues = tokenBudgetRule.check(inventory, resolved, { warn: 400, error: 800 });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
  });
});
