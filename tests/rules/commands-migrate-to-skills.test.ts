import { describe, it, expect } from 'vitest';
import { migrateToSkillsRule } from '../../src/rules/commands/migrate-to-skills.js';
import { createEmptyResolvedConfig } from '../../src/core/resolver.js';
import type { ConfigInventory, FileInfo } from '../../src/types/index.js';

function makeInventory(overrides: Partial<ConfigInventory> = {}): ConfigInventory {
  return {
    projectRoot: '/test',
    gitRoot: null,
    userSettings: null,
    projectSettings: null,
    localSettings: null,
    managedSettings: null,
    preferences: null,
    enterpriseClaudeMd: null,
    globalClaudeMd: null,
    projectClaudeMd: null,
    localClaudeMd: null,
    subdirClaudeMds: [],
    autoMemory: null,
    autoMemoryTopics: [],
    rules: [],
    userRules: [],
    projectAgents: [],
    userAgents: [],
    projectCommands: [],
    userCommands: [],
    projectSkills: [],
    userSkills: [],
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
    path: '/test/.claude/commands/deploy.md',
    relativePath: '.claude/commands/deploy.md',
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

describe('commands/migrate-to-skills rule', () => {
  const resolved = createEmptyResolvedConfig();

  it('flags project with 2 command files — one info issue with count', () => {
    const inventory = makeInventory({
      projectCommands: [
        makeFileInfo({ path: '/test/.claude/commands/deploy.md', relativePath: '.claude/commands/deploy.md' }),
        makeFileInfo({ path: '/test/.claude/commands/review.md', relativePath: '.claude/commands/review.md' }),
      ],
    });
    const issues = migrateToSkillsRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('commands/migrate-to-skills');
    expect(issues[0].severity).toBe('info');
    expect(issues[0].category).toBe('commands');
    expect(issues[0].message).toContain('2 command file(s)');
    expect(issues[0].message).toContain('project');
    expect(issues[0].message).toContain('legacy');
    expect(issues[0].suggestion).toContain('skills');
  });

  it('still flags when both commands and skills exist', () => {
    const inventory = makeInventory({
      projectCommands: [
        makeFileInfo({ path: '/test/.claude/commands/deploy.md', relativePath: '.claude/commands/deploy.md' }),
      ],
      projectSkills: [
        makeFileInfo({
          path: '/test/.claude/skills/review/SKILL.md',
          relativePath: '.claude/skills/review/SKILL.md',
        }),
      ],
    });
    const issues = migrateToSkillsRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('1 command file(s)');
  });

  it('no issue when no commands exist', () => {
    const inventory = makeInventory({ projectCommands: [], userCommands: [] });
    const issues = migrateToSkillsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('flags user-scope commands separately', () => {
    const inventory = makeInventory({
      userCommands: [
        makeFileInfo({ path: '/home/.claude/commands/global.md', relativePath: '~/.claude/commands/global.md', scope: 'user' }),
      ],
    });
    const issues = migrateToSkillsRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('user scope');
    expect(issues[0].suggestion).toContain('~/.claude/skills');
  });

  it('emits two issues when both project and user commands exist', () => {
    const inventory = makeInventory({
      projectCommands: [
        makeFileInfo({ path: '/test/.claude/commands/deploy.md', relativePath: '.claude/commands/deploy.md' }),
      ],
      userCommands: [
        makeFileInfo({ path: '/home/.claude/commands/global.md', scope: 'user' }),
      ],
    });
    const issues = migrateToSkillsRule.check(inventory, resolved);
    expect(issues).toHaveLength(2);
  });

  it('skips non-existent command files', () => {
    const inventory = makeInventory({
      projectCommands: [makeFileInfo({ exists: false })],
    });
    const issues = migrateToSkillsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });
});
