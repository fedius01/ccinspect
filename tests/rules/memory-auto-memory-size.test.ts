import { describe, it, expect } from 'vitest';
import { autoMemorySizeRule } from '../../src/rules/memory/auto-memory-size.js';
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
    path: '/test/MEMORY.md',
    relativePath: 'MEMORY.md',
    exists: true,
    scope: 'user',
    sizeBytes: 1000,
    lineCount: 100,
    estimatedTokens: 400,
    gitTracked: false,
    lastModified: new Date(),
    ...overrides,
  };
}

describe('memory/auto-memory-size rule', () => {
  const resolved = resolve(makeInventory());

  it('passes when no autoMemory file exists', () => {
    const inventory = makeInventory({ autoMemory: null });
    const issues = autoMemorySizeRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('passes when autoMemory is under 200 lines', () => {
    const inventory = makeInventory({
      autoMemory: makeFileInfo({ lineCount: 150 }),
    });
    const issues = autoMemorySizeRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('warns when autoMemory exceeds 200 lines', () => {
    const inventory = makeInventory({
      autoMemory: makeFileInfo({ lineCount: 250 }),
    });
    const issues = autoMemorySizeRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('memory/auto-memory-size');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].category).toBe('memory');
  });

  it('warns at exactly 201 lines', () => {
    const inventory = makeInventory({
      autoMemory: makeFileInfo({ lineCount: 201 }),
    });
    const issues = autoMemorySizeRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
  });

  it('passes at exactly 200 lines', () => {
    const inventory = makeInventory({
      autoMemory: makeFileInfo({ lineCount: 200 }),
    });
    const issues = autoMemorySizeRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('supports custom maxLines option', () => {
    const inventory = makeInventory({
      autoMemory: makeFileInfo({ lineCount: 150 }),
    });
    const issues = autoMemorySizeRule.check(inventory, resolved, { maxLines: 100 });
    expect(issues).toHaveLength(1);
  });

  it('skips non-existent autoMemory file', () => {
    const inventory = makeInventory({
      autoMemory: makeFileInfo({ exists: false, lineCount: 500 }),
    });
    const issues = autoMemorySizeRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });
});
