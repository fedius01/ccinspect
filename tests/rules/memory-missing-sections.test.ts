import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { missingSectionsRule } from '../../src/rules/memory/missing-sections.js';
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

describe('memory/missing-sections rule', () => {
  const resolved = resolve(makeInventory());

  it('passes when all sections present (full-project)', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: join(FIXTURES, 'full-project', 'CLAUDE.md'),
      }),
    });
    const issues = missingSectionsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('returns no issues when projectClaudeMd is null', () => {
    const inventory = makeInventory({ projectClaudeMd: null });
    const issues = missingSectionsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('returns no issues when projectClaudeMd does not exist', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({ exists: false }),
    });
    const issues = missingSectionsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('flags missing sections in minimal CLAUDE.md', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: join(FIXTURES, 'minimal-project', 'CLAUDE.md'),
      }),
    });
    const issues = missingSectionsRule.check(inventory, resolved);
    // Minimal project only has a title, no overview/commands/architecture sections
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].ruleId).toBe('memory/missing-sections');
    expect(issues[0].severity).toBe('info');
    expect(issues[0].category).toBe('memory');
  });

  it('supports custom required sections list', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: join(FIXTURES, 'full-project', 'CLAUDE.md'),
      }),
    });
    // Require a section that doesn't exist
    const issues = missingSectionsRule.check(inventory, resolved, {
      required: ['overview', 'deployment'],
    });
    // 'deployment' is not a section heading in full-project CLAUDE.md
    const deploymentIssue = issues.find((i) => i.message.includes('deployment'));
    expect(deploymentIssue).toBeDefined();
  });
});
