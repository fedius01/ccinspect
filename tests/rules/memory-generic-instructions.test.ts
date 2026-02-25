import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { genericInstructionsRule } from '../../src/rules/memory/generic-instructions.js';
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

describe('memory/generic-instructions rule', () => {
  const resolved = resolve(makeInventory());

  it('passes for a well-written CLAUDE.md', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: join(FIXTURES, 'full-project', 'CLAUDE.md'),
      }),
    });
    const issues = genericInstructionsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('detects generic instructions in conflicting CLAUDE.md', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: join(FIXTURES, 'conflicting', 'CLAUDE.md'),
      }),
    });
    const issues = genericInstructionsRule.check(inventory, resolved);
    expect(issues.length).toBeGreaterThan(10);
    expect(issues[0].ruleId).toBe('memory/generic-instructions');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].category).toBe('memory');
  });

  it('detects generic instructions in overconfigured CLAUDE.md', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: join(FIXTURES, 'overconfigured', 'CLAUDE.md'),
      }),
    });
    const issues = genericInstructionsRule.check(inventory, resolved);
    expect(issues.length).toBeGreaterThan(10);
  });

  it('includes line numbers in issues', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: join(FIXTURES, 'conflicting', 'CLAUDE.md'),
      }),
    });
    const issues = genericInstructionsRule.check(inventory, resolved);
    for (const issue of issues) {
      expect(issue.line).toBeGreaterThan(0);
    }
  });

  it('respects ignorePatterns option', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: join(FIXTURES, 'conflicting', 'CLAUDE.md'),
      }),
    });
    const allIssues = genericInstructionsRule.check(inventory, resolved);
    const filteredIssues = genericInstructionsRule.check(inventory, resolved, {
      ignorePatterns: ['follow best practices', 'write clean code'],
    });
    expect(filteredIssues.length).toBeLessThan(allIssues.length);
  });

  it('skips non-existent files', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({ exists: false }),
    });
    const issues = genericInstructionsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('supports extraPatterns option', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: join(FIXTURES, 'full-project', 'CLAUDE.md'),
      }),
    });
    // Full-project CLAUDE.md has "zero-downtime" text — use it as an extraPattern
    const issues = genericInstructionsRule.check(inventory, resolved, {
      extraPatterns: ['zero-downtime'],
    });
    expect(issues.length).toBeGreaterThan(0);
  });
});
