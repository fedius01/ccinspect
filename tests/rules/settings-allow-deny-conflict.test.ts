import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { allowDenyConflictRule } from '../../src/rules/settings/allow-deny-conflict.js';
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

describe('settings/allow-deny-conflict rule', () => {
  const resolved = resolve(makeInventory());

  it('does not flag when no settings files exist', () => {
    const inventory = makeInventory();
    const issues = allowDenyConflictRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('flags exact match patterns in both allow and deny', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.claude', 'settings.allow-deny-conflict.json'),
        relativePath: '.claude/settings.allow-deny-conflict.json',
      }),
    });
    const issues = allowDenyConflictRule.check(inventory, resolved);

    // "Bash(npm run *)" is in both allow and deny → exact match
    const bashConflict = issues.find((i) => i.message.includes('"Bash(npm run *)"'));
    expect(bashConflict).toBeDefined();
    expect(bashConflict!.message).toContain('both allow and deny');
    expect(bashConflict!.severity).toBe('warning');

    // "mcp__server__*" is in both allow and deny → exact match
    const mcpConflict = issues.find((i) => i.message.includes('"mcp__server__*"'));
    expect(mcpConflict).toBeDefined();
  });

  it('flags bare deny overriding scoped allow', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.claude', 'settings.allow-deny-bare.json'),
        relativePath: '.claude/settings.allow-deny-bare.json',
      }),
    });
    const issues = allowDenyConflictRule.check(inventory, resolved);

    // deny: "Bash" + allow: "Bash(npm run *)" → bare deny overrides scoped allow
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('overridden by bare deny');
    expect(issues[0].message).toContain('"Bash"');
  });

  it('does NOT flag bare allow + scoped deny (intentional scoping)', () => {
    // The dangerous fixture has "Bash" in allow + "Bash(rm -rf /)" in deny — this is fine
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.claude', 'settings.dangerous.json'),
        relativePath: '.claude/settings.dangerous.json',
      }),
    });
    const issues = allowDenyConflictRule.check(inventory, resolved);
    // Bare allow + scoped deny is intentional (allow everything except specific patterns)
    expect(issues).toHaveLength(0);
  });

  it('does not flag clean settings with no conflicts', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'full-project', '.claude', 'settings.json'),
        relativePath: '.claude/settings.json',
      }),
    });
    const issues = allowDenyConflictRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('skips non-existent settings files', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({ exists: false }),
    });
    const issues = allowDenyConflictRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('only checks within the same file, not cross-level', () => {
    // local has allow-deny conflict, but project does not
    const inventory = makeInventory({
      localSettings: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.claude', 'settings.allow-deny-conflict.json'),
        relativePath: '.claude/settings.allow-deny-conflict.json',
        scope: 'project-local',
      }),
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'full-project', '.claude', 'settings.json'),
        relativePath: '.claude/settings.json',
      }),
    });
    const issues = allowDenyConflictRule.check(inventory, resolved);

    // Should only find issues from the local settings file, not cross-level
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.file === join(FIXTURES, 'conflicting', '.claude', 'settings.allow-deny-conflict.json'))).toBe(true);
  });
});
