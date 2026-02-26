import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { staleImportsRule } from '../../src/rules/memory/stale-imports.js';
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
    lineCount: 10,
    estimatedTokens: 50,
    gitTracked: false,
    lastModified: new Date(),
    ...overrides,
  };
}

describe('memory/stale-imports rule', () => {
  const resolved = resolve(makeInventory());

  it('does not flag when no CLAUDE.md files exist', () => {
    const inventory = makeInventory();
    const issues = staleImportsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('flags broken @import references', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: join(FIXTURES, 'conflicting', 'CLAUDE.stale-imports.md'),
        relativePath: 'CLAUDE.stale-imports.md',
      }),
    });
    const issues = staleImportsRule.check(inventory, resolved);

    // docs/api-guide.md, docs/architecture.md, ./nonexistent-file.md — all don't exist
    expect(issues.length).toBe(3);
    expect(issues.every((i) => i.ruleId === 'memory/stale-imports')).toBe(true);
    expect(issues.every((i) => i.severity === 'warning')).toBe(true);
    expect(issues.every((i) => i.category === 'memory')).toBe(true);

    // Check specific files are mentioned
    const apiGuide = issues.find((i) => i.message.includes('api-guide.md'));
    expect(apiGuide).toBeDefined();
    expect(apiGuide!.line).toBeDefined();

    const nonexistent = issues.find((i) => i.message.includes('nonexistent-file.md'));
    expect(nonexistent).toBeDefined();
  });

  it('does not flag valid @imports that exist', () => {
    // full-project/CLAUDE.md has no @imports, so no issues
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: join(FIXTURES, 'full-project', 'CLAUDE.md'),
        relativePath: 'CLAUDE.md',
      }),
    });
    const issues = staleImportsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('skips non-existent CLAUDE.md files', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({ exists: false }),
    });
    const issues = staleImportsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('reports correct line numbers', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: join(FIXTURES, 'conflicting', 'CLAUDE.stale-imports.md'),
        relativePath: 'CLAUDE.stale-imports.md',
      }),
    });
    const issues = staleImportsRule.check(inventory, resolved);
    // All issues should have line numbers
    expect(issues.every((i) => typeof i.line === 'number' && i.line > 0)).toBe(true);
  });
});
