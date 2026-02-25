import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { sandboxRecommendedRule } from '../../src/rules/settings/sandbox-recommended.js';
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
    path: '/test/.claude/settings.json',
    relativePath: '.claude/settings.json',
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

describe('settings/sandbox-recommended rule', () => {
  const resolved = resolve(makeInventory());

  it('warns when no settings files exist', () => {
    const inventory = makeInventory();
    const issues = sandboxRecommendedRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].ruleId).toBe('settings/sandbox-recommended');
    expect(issues[0].category).toBe('settings');
  });

  it('passes when sandbox is enabled (full-project fixture)', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'full-project', '.claude', 'settings.json'),
        relativePath: '.claude/settings.json',
      }),
    });
    const issues = sandboxRecommendedRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('warns when settings exist but no sandbox key (conflicting fixture)', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.claude', 'settings.json'),
        relativePath: '.claude/settings.json',
      }),
    });
    const issues = sandboxRecommendedRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].message).toContain('Sandbox is not enabled');
  });

  it('passes when sandbox is enabled in any settings level', () => {
    // conflicting has no sandbox, but overconfigured does
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.claude', 'settings.json'),
      }),
      localSettings: makeFileInfo({
        path: join(FIXTURES, 'overconfigured', '.claude', 'settings.json'),
        scope: 'project-local',
      }),
    });
    const issues = sandboxRecommendedRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('skips non-existent settings files', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({ exists: false }),
    });
    const issues = sandboxRecommendedRule.check(inventory, resolved);
    // No existing files to check, so sandbox not found → warn
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('settings/sandbox-recommended');
  });
});
