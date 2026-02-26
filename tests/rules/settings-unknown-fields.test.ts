import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { unknownFieldsRule } from '../../src/rules/settings/unknown-fields.js';
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

describe('settings/unknown-fields rule', () => {
  const resolved = resolve(makeInventory());

  it('does not warn when no settings files exist', () => {
    const inventory = makeInventory();
    const issues = unknownFieldsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('does not warn for valid fields (full-project fixture)', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'full-project', '.claude', 'settings.json'),
      }),
    });
    const issues = unknownFieldsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('warns for typo fields with "did you mean" suggestions', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.claude', 'settings.typos.json'),
        relativePath: '.claude/settings.json',
      }),
    });
    const issues = unknownFieldsRule.check(inventory, resolved);

    // sandBox, permission, mcpservers, allowedTool, hook = 5 unknown fields
    // env is valid so not flagged
    expect(issues).toHaveLength(5);
    expect(issues.every((i) => i.ruleId === 'settings/unknown-fields')).toBe(true);
    expect(issues.every((i) => i.severity === 'warning')).toBe(true);
  });

  it('suggests "sandbox" for "sandBox"', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.claude', 'settings.typos.json'),
        relativePath: '.claude/settings.json',
      }),
    });
    const issues = unknownFieldsRule.check(inventory, resolved);
    const sandboxIssue = issues.find((i) => i.message.includes('sandBox'));
    expect(sandboxIssue).toBeDefined();
    expect(sandboxIssue!.message).toContain('Did you mean "sandbox"');
  });

  it('suggests "permissions" for "permission"', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.claude', 'settings.typos.json'),
        relativePath: '.claude/settings.json',
      }),
    });
    const issues = unknownFieldsRule.check(inventory, resolved);
    const permIssue = issues.find((i) => i.message.includes('"permission"'));
    expect(permIssue).toBeDefined();
    expect(permIssue!.message).toContain('Did you mean "permissions"');
  });

  it('does not flag known fields like env, model, plugins', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'overconfigured', '.claude', 'settings.json'),
      }),
    });
    const issues = unknownFieldsRule.check(inventory, resolved);
    // overconfigured settings has: permissions, env, sandbox, hooks, plugins, model — all valid
    expect(issues).toHaveLength(0);
  });

  it('skips non-existent settings files', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({ exists: false }),
    });
    const issues = unknownFieldsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });
});
