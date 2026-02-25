import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { permissionPatternsRule } from '../../src/rules/settings/permission-patterns.js';
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
    path: '/test/settings.json',
    relativePath: 'settings.json',
    exists: true,
    scope: 'project-shared',
    sizeBytes: 100,
    lineCount: 10,
    estimatedTokens: 50,
    gitTracked: true,
    lastModified: new Date(),
    ...overrides,
  };
}

describe('settings/permission-patterns rule', () => {
  const resolved = resolve(makeInventory());

  it('passes for valid permission patterns (full-project)', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'full-project', '.claude', 'settings.json'),
      }),
    });
    const issues = permissionPatternsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('flags unknown tool name in overconfigured settings', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'overconfigured', '.claude', 'settings.json'),
      }),
    });
    const issues = permissionPatternsRule.check(inventory, resolved);
    // InvalidTool(foo) is an unknown tool
    const unknownToolIssues = issues.filter((i) => i.message.includes('InvalidTool'));
    expect(unknownToolIssues.length).toBeGreaterThan(0);
    expect(unknownToolIssues[0].severity).toBe('warning');
  });

  it('passes for bare tool names like Bash', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.claude', 'settings.json'),
      }),
    });
    const issues = permissionPatternsRule.check(inventory, resolved);
    // conflicting has standard patterns like Read(**), Write(**), Bash(npm run *)
    const malformedIssues = issues.filter((i) => i.message.includes('Malformed'));
    expect(malformedIssues).toHaveLength(0);
  });

  it('skips files that do not exist', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({ exists: false }),
    });
    const issues = permissionPatternsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('checks all settings levels', () => {
    const inventory = makeInventory({
      projectSettings: makeFileInfo({
        path: join(FIXTURES, 'overconfigured', '.claude', 'settings.json'),
      }),
      localSettings: makeFileInfo({
        path: join(FIXTURES, 'overconfigured', '.claude', 'settings.local.json'),
        scope: 'project-local',
      }),
    });
    const issues = permissionPatternsRule.check(inventory, resolved);
    // Should check both files
    expect(issues.length).toBeGreaterThan(0);
  });
});
