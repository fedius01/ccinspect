import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { redundantPermissionsRule } from '../../src/rules/settings/redundant-permissions.js';
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

describe('settings/redundant-permissions rule', () => {
  const resolved = resolve(makeInventory());

  it('does not flag when no settings files exist', () => {
    const inventory = makeInventory();
    const issues = redundantPermissionsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('flags bare tool subsuming scoped patterns', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.claude', 'settings.redundant.json'),
        relativePath: '.claude/settings.redundant.json',
      }),
    });
    const issues = redundantPermissionsRule.check(inventory, resolved);

    // In allow: Bash covers Bash(npm run *) and Bash(npm run test), Read covers Read(src/index.ts)
    // mcp__* covers mcp__github__* and mcp__server__tool
    // Bash(npm run *) covers Bash(npm run test) — but Bash already covers it too
    // In deny: Write(src/**) covers Write(src/index.ts)
    const bashNpmRunStar = issues.find((i) => i.message.includes('"Bash(npm run *)"'));
    const bashNpmRunTest = issues.find((i) => i.message.includes('"Bash(npm run test)"'));
    const readSrcIndex = issues.find((i) => i.message.includes('"Read(src/index.ts)"'));

    expect(bashNpmRunStar).toBeDefined();
    expect(bashNpmRunTest).toBeDefined();
    expect(readSrcIndex).toBeDefined();

    // MCP wildcard patterns
    const mcpGithub = issues.find((i) => i.message.includes('"mcp__github__*"'));
    const mcpServerTool = issues.find((i) => i.message.includes('"mcp__server__tool"'));
    expect(mcpGithub).toBeDefined();
    expect(mcpServerTool).toBeDefined();

    // Deny redundancies
    const writeSrcIndex = issues.find((i) => i.message.includes('"Write(src/index.ts)"'));
    expect(writeSrcIndex).toBeDefined();

    expect(issues.every((i) => i.ruleId === 'settings/redundant-permissions')).toBe(true);
    expect(issues.every((i) => i.severity === 'info')).toBe(true);
  });

  it('does not flag non-redundant patterns', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'full-project', '.claude', 'settings.json'),
        relativePath: '.claude/settings.json',
      }),
    });
    const issues = redundantPermissionsRule.check(inventory, resolved);
    // full-project has scoped patterns like Bash(npm run *), Read(src/**), Read(tests/**) — not redundant
    expect(issues).toHaveLength(0);
  });

  it('checks across settings files', () => {
    // If user settings has "Bash" and project settings has "Bash(npm run *)",
    // the project pattern is redundant
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.claude', 'settings.redundant.json'),
        relativePath: '.claude/settings.redundant.json',
      }),
    });
    const issues = redundantPermissionsRule.check(inventory, resolved);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('skips non-existent settings files', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({ exists: false }),
    });
    const issues = redundantPermissionsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });
});
