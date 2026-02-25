import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { commandFrontmatterValidRule } from '../../src/rules/commands/frontmatter-valid.js';
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
    path: '/test/command.md',
    relativePath: '.claude/commands/command.md',
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

describe('commands/frontmatter-valid rule', () => {
  const resolved = resolve(makeInventory());

  it('passes for command without frontmatter (frontmatter is optional)', () => {
    const inventory = makeInventory({
      projectCommands: [
        makeFileInfo({
          path: join(FIXTURES, 'full-project', '.claude', 'commands', 'deploy.md'),
          relativePath: '.claude/commands/deploy.md',
        }),
      ],
    });
    const issues = commandFrontmatterValidRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('flags unknown frontmatter fields with info severity', () => {
    const inventory = makeInventory({
      projectCommands: [
        makeFileInfo({
          path: join(FIXTURES, 'overconfigured', '.claude', 'commands', 'run.md'),
          relativePath: '.claude/commands/run.md',
        }),
      ],
    });
    const issues = commandFrontmatterValidRule.check(inventory, resolved);
    // run.md has "author" which is an unknown field
    const unknownIssues = issues.filter((i) => i.message.includes('unknown'));
    expect(unknownIssues.length).toBeGreaterThan(0);
    expect(unknownIssues[0].severity).toBe('info');
    expect(unknownIssues[0].category).toBe('commands');
  });

  it('passes when no commands exist', () => {
    const inventory = makeInventory({ projectCommands: [], userCommands: [] });
    const issues = commandFrontmatterValidRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });
});
