import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { importDepthRule } from '../../src/rules/memory/import-depth.js';
import { resolve } from '../../src/core/resolver.js';
import type { ConfigInventory, FileInfo } from '../../src/types/index.js';

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

describe('memory/import-depth rule', () => {
  const resolved = resolve(makeInventory());

  it('passes when no imports exist', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: join(FIXTURES, 'full-project', 'CLAUDE.md'),
      }),
    });
    const issues = importDepthRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('passes when import depth is within default limit (5)', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: join(FIXTURES, 'overconfigured', 'CLAUDE.md'),
      }),
    });
    // Overconfigured has depth 3 (imported.md -> deep-level2.md -> deep-level3.md)
    const issues = importDepthRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('errors when import depth exceeds custom maxDepth', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: join(FIXTURES, 'overconfigured', 'CLAUDE.md'),
      }),
    });
    // Set maxDepth to 1 to trigger the error (actual depth is 3)
    const issues = importDepthRule.check(inventory, resolved, { maxDepth: 1 });
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('memory/import-depth');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].category).toBe('memory');
  });

  it('skips non-existent files', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({ exists: false }),
    });
    const issues = importDepthRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });
});
