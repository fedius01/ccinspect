import { describe, it, expect } from 'vitest';
import { startupLoadRule } from '../../src/rules/budget/startup-load.js';
import { resolve } from '../../src/core/resolver.js';
import type { ConfigInventory, FileInfo } from '../../src/types/index.js';

function makeFileInfo(overrides: Partial<FileInfo> = {}): FileInfo {
  return {
    path: '/test/CLAUDE.md',
    relativePath: 'CLAUDE.md',
    exists: true,
    scope: 'project-shared',
    sizeBytes: 100,
    lineCount: 50,
    estimatedTokens: 200,
    gitTracked: true,
    lastModified: new Date(),
    ...overrides,
  };
}

function makeInventory(totalStartupTokens: number, overrides: Partial<ConfigInventory> = {}): ConfigInventory {
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
    totalStartupTokens,
    totalOnDemandTokens: 0,
    ...overrides,
  };
}

describe('budget/startup-load rule', () => {
  it('passes for low token count', () => {
    const inventory = makeInventory(1000);
    const resolved = resolve(inventory);
    const issues = startupLoadRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('warns between 5000 and 10000 tokens (including overhead)', () => {
    const inventory = makeInventory(5000); // +500 overhead = 5500
    const resolved = resolve(inventory);
    const issues = startupLoadRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].ruleId).toBe('budget/startup-load');
  });

  it('errors above 10000 tokens (including overhead)', () => {
    const inventory = makeInventory(10000); // +500 overhead = 10500
    const resolved = resolve(inventory);
    const issues = startupLoadRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
  });

  it('includes per-file token breakdown as evidence on warning', () => {
    const inventory = makeInventory(5000, {
      projectClaudeMd: makeFileInfo({
        path: '/test/CLAUDE.md',
        relativePath: 'CLAUDE.md',
        estimatedTokens: 3000,
      }),
      globalClaudeMd: makeFileInfo({
        path: '/home/.claude/CLAUDE.md',
        relativePath: '~/.claude/CLAUDE.md',
        estimatedTokens: 2000,
        scope: 'user',
      }),
    });
    const resolved = resolve(inventory);
    const issues = startupLoadRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].evidence).toBeDefined();
    expect(issues[0].evidence!.length).toBe(2);
    // Sorted by tokens descending
    expect(issues[0].evidence![0].content).toBe('3000 tokens');
    expect(issues[0].evidence![0].file).toBe('/test/CLAUDE.md');
    expect(issues[0].evidence![1].content).toBe('2000 tokens');
  });

  it('includes per-file token breakdown as evidence on error', () => {
    const inventory = makeInventory(10000, {
      projectClaudeMd: makeFileInfo({
        path: '/test/CLAUDE.md',
        relativePath: 'CLAUDE.md',
        estimatedTokens: 8000,
      }),
      autoMemory: makeFileInfo({
        path: '/home/.claude/projects/hash/memory/MEMORY.md',
        relativePath: 'MEMORY.md',
        estimatedTokens: 2000,
        scope: 'user',
      }),
    });
    const resolved = resolve(inventory);
    const issues = startupLoadRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].evidence).toBeDefined();
    expect(issues[0].evidence!.length).toBe(2);
    expect(issues[0].evidence![0].content).toBe('8000 tokens');
    expect(issues[0].evidence![1].content).toBe('2000 tokens');
  });

  it('has no evidence when no startup files have tokens', () => {
    const inventory = makeInventory(5000);
    const resolved = resolve(inventory);
    const issues = startupLoadRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    // No startup files with tokens → evidence is undefined
    expect(issues[0].evidence).toBeUndefined();
  });
});
