import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { dangerousAllowRule } from '../../src/rules/settings/dangerous-allow.js';
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
    pluginAgents: [],
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

describe('settings/dangerous-allow rule', () => {
  const resolved = resolve(makeInventory());

  it('does not warn when no settings files exist', () => {
    const inventory = makeInventory();
    const issues = dangerousAllowRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('warns for bare dangerous patterns (dangerous fixture)', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.claude', 'settings.dangerous.json'),
      }),
    });
    const issues = dangerousAllowRule.check(inventory, resolved);
    // Should flag: Bash, Write, Edit, mcp__*, Task (5 patterns)
    // Should NOT flag: Read (low risk)
    expect(issues).toHaveLength(5);
    expect(issues.every((i) => i.ruleId === 'settings/dangerous-allow')).toBe(true);
    expect(issues.every((i) => i.severity === 'warning')).toBe(true);
    expect(issues.every((i) => i.category === 'settings')).toBe(true);
  });

  it('flags Bash with correct message', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.claude', 'settings.dangerous.json'),
      }),
    });
    const issues = dangerousAllowRule.check(inventory, resolved);
    const bashIssue = issues.find((i) => i.message.includes('"Bash"'));
    expect(bashIssue).toBeDefined();
    expect(bashIssue!.message).toContain('unrestricted shell access');
    expect(bashIssue!.suggestion).toContain('Bash(npm run *)');
  });

  it('flags mcp__* wildcard', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.claude', 'settings.dangerous.json'),
      }),
    });
    const issues = dangerousAllowRule.check(inventory, resolved);
    const mcpIssue = issues.find((i) => i.message.includes('mcp__*'));
    expect(mcpIssue).toBeDefined();
    expect(mcpIssue!.suggestion).toContain('mcp__servername__*');
  });

  it('does not flag scoped patterns (full-project fixture)', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'full-project', '.claude', 'settings.json'),
      }),
    });
    const issues = dangerousAllowRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('does not flag Read or Glob bare patterns', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.claude', 'settings.dangerous.json'),
      }),
    });
    const issues = dangerousAllowRule.check(inventory, resolved);
    const readIssue = issues.find((i) => i.message.includes('"Read"'));
    expect(readIssue).toBeUndefined();
  });

  it('warns for wildcard ToolName(*) patterns', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.claude', 'settings.dangerous-wildcard.json'),
      }),
    });
    const issues = dangerousAllowRule.check(inventory, resolved);
    // Should flag: Bash(*), Write(*), Edit(*), Task(*) — 4 patterns
    // Should NOT flag: Read(*), Bash(npm run *), Bash(git *)
    expect(issues).toHaveLength(4);
    expect(issues.every((i) => i.severity === 'warning')).toBe(true);
  });

  it('flags Bash(*) with correct message', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.claude', 'settings.dangerous-wildcard.json'),
      }),
    });
    const issues = dangerousAllowRule.check(inventory, resolved);
    const bashIssue = issues.find((i) => i.message.includes('"Bash(*)"'));
    expect(bashIssue).toBeDefined();
    expect(bashIssue!.message).toContain('unrestricted shell access');
  });

  it('flags Edit(*) with correct message', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.claude', 'settings.dangerous-wildcard.json'),
      }),
    });
    const issues = dangerousAllowRule.check(inventory, resolved);
    const editIssue = issues.find((i) => i.message.includes('"Edit(*)"'));
    expect(editIssue).toBeDefined();
    expect(editIssue!.message).toContain('allows editing any file');
  });

  it('flags Write(*) with correct message', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.claude', 'settings.dangerous-wildcard.json'),
      }),
    });
    const issues = dangerousAllowRule.check(inventory, resolved);
    const writeIssue = issues.find((i) => i.message.includes('"Write(*)"'));
    expect(writeIssue).toBeDefined();
    expect(writeIssue!.message).toContain('allows writing to any file');
  });

  it('flags Task(*) with correct message', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.claude', 'settings.dangerous-wildcard.json'),
      }),
    });
    const issues = dangerousAllowRule.check(inventory, resolved);
    const taskIssue = issues.find((i) => i.message.includes('"Task(*)"'));
    expect(taskIssue).toBeDefined();
    expect(taskIssue!.message).toContain('allows spawning any sub-agent');
  });

  it('does not flag Read(*) wildcard', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.claude', 'settings.dangerous-wildcard.json'),
      }),
    });
    const issues = dangerousAllowRule.check(inventory, resolved);
    const readIssue = issues.find((i) => i.message.includes('"Read(*)"'));
    expect(readIssue).toBeUndefined();
  });

  it('does not flag scoped Bash(npm run *) pattern', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.claude', 'settings.dangerous-wildcard.json'),
      }),
    });
    const issues = dangerousAllowRule.check(inventory, resolved);
    const scopedIssue = issues.find((i) => i.message.includes('"Bash(npm run *)"'));
    expect(scopedIssue).toBeUndefined();
  });

  it('skips non-existent settings files', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({ exists: false }),
    });
    const issues = dangerousAllowRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('checks all settings levels', () => {
    const dangerousPath = join(FIXTURES, 'conflicting', '.claude', 'settings.dangerous.json');
    const inventory = makeInventory({
      projectSettings: makeFileInfo({ path: dangerousPath }),
      userSettings: makeFileInfo({
        path: dangerousPath,
        scope: 'user',
      }),
    });
    const issues = dangerousAllowRule.check(inventory, resolved);
    // 5 issues per file × 2 files = 10
    expect(issues).toHaveLength(10);
  });
});
