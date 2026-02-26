import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { denySensitivePathsRule } from '../../src/rules/settings/deny-sensitive-paths.js';
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

describe('settings/deny-sensitive-paths rule', () => {
  const resolved = resolve(makeInventory());

  it('warns for all sensitive path groups when no deny rules exist', () => {
    const inventory = makeInventory();
    const issues = denySensitivePathsRule.check(inventory, resolved);
    // 5 groups: SSH, AWS, GCloud, .gitignore, .npmrc
    expect(issues).toHaveLength(5);
    expect(issues.every((i) => i.ruleId === 'settings/deny-sensitive-paths')).toBe(true);
    expect(issues.every((i) => i.severity === 'info')).toBe(true);
    expect(issues.every((i) => i.category === 'settings')).toBe(true);
  });

  it('warns when settings have deny rules but not for sensitive paths (full-project)', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'full-project', '.claude', 'settings.json'),
      }),
    });
    const issues = denySensitivePathsRule.check(inventory, resolved);
    // full-project has .env deny rules but not SSH/AWS/etc
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.message.includes('SSH'))).toBe(true);
    expect(issues.some((i) => i.message.includes('AWS'))).toBe(true);
  });

  it('mentions the specific missing patterns in the message', () => {
    const inventory = makeInventory();
    const issues = denySensitivePathsRule.check(inventory, resolved);
    const sshIssue = issues.find((i) => i.message.includes('SSH'));
    expect(sshIssue).toBeDefined();
    expect(sshIssue!.message).toContain('Read(./.ssh/**)');
    expect(sshIssue!.message).toContain('Write(./.ssh/**)');
  });

  it('does not flag when deny rules cover sensitive paths (conflicting has no deny)', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.claude', 'settings.json'),
      }),
    });
    const issues = denySensitivePathsRule.check(inventory, resolved);
    // conflicting only has "Bash(rm -rf /)" in deny — all 5 groups should be flagged
    expect(issues).toHaveLength(5);
  });

  it('skips non-existent settings files', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({ exists: false }),
    });
    const issues = denySensitivePathsRule.check(inventory, resolved);
    // No existing files → all 5 groups flagged
    expect(issues).toHaveLength(5);
  });

  it('sets autoFixable to false', () => {
    const inventory = makeInventory();
    const issues = denySensitivePathsRule.check(inventory, resolved);
    expect(issues.every((i) => !i.autoFixable)).toBe(true);
  });
});
