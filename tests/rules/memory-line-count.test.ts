import { describe, it, expect } from 'vitest';
import { lineCountRule } from '../../src/rules/memory/line-count.js';
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

describe('memory/line-count rule', () => {
  const resolved = resolve(makeInventory());

  it('passes for files under 150 lines', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({ lineCount: 100 }),
    });
    const issues = lineCountRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('warns for files between 150 and 300 lines', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({ lineCount: 200 }),
    });
    const issues = lineCountRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].ruleId).toBe('memory/line-count');
  });

  it('errors for files over 300 lines', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({ lineCount: 350 }),
    });
    const issues = lineCountRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
  });

  it('checks multiple CLAUDE.md files', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({ lineCount: 200, relativePath: 'CLAUDE.md' }),
      globalClaudeMd: makeFileInfo({
        lineCount: 160,
        path: '/home/.claude/CLAUDE.md',
        relativePath: '~/.claude/CLAUDE.md',
      }),
    });
    const issues = lineCountRule.check(inventory, resolved);
    expect(issues).toHaveLength(2);
  });

  it('skips non-existent files', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({ exists: false, lineCount: 500 }),
    });
    const issues = lineCountRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });
});
