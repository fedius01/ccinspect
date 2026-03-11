import { describe, it, expect } from 'vitest';

import { filenameCasingRule } from '../../../src/rules/naming/filename-casing.js';
import { createEmptyResolvedConfig } from '../../../src/core/resolver.js';
import type { ConfigInventory, FileInfo } from '../../../src/types/index.js';

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
    path: '/test/CLAUDE.md',
    relativePath: 'CLAUDE.md',
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

describe('naming/filename-casing rule', () => {
  const resolved = createEmptyResolvedConfig();

  it('produces warning for miscased projectClaudeMd (Claude.md)', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: '/test/Claude.md',
        relativePath: 'Claude.md',
      }),
    });

    const issues = filenameCasingRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('naming/filename-casing');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].category).toBe('naming');
    expect(issues[0].message).toContain('Claude.md');
    expect(issues[0].message).toContain('CLAUDE.md');
    expect(issues[0].file).toBe('/test/Claude.md');
    expect(issues[0].evidence).toHaveLength(1);
    expect(issues[0].evidence![0].content).toContain('Actual: Claude.md');
    expect(issues[0].evidence![0].content).toContain('Expected: CLAUDE.md');
  });

  it('produces no issues for correctly-named CLAUDE.md', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: '/test/CLAUDE.md',
        relativePath: 'CLAUDE.md',
      }),
    });

    const issues = filenameCasingRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('produces warning for miscased skill file (skill.md)', () => {
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: '/test/.claude/skills/my-skill/skill.md',
          relativePath: '.claude/skills/my-skill/skill.md',
        }),
      ],
    });

    const issues = filenameCasingRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('skill.md');
    expect(issues[0].message).toContain('SKILL.md');
  });

  it('produces no issues when only agents/rules/commands are present (no canonical names)', () => {
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: '/test/.claude/agents/reviewer.md',
          relativePath: '.claude/agents/reviewer.md',
        }),
      ],
      rules: [],
      projectCommands: [
        makeFileInfo({
          path: '/test/.claude/commands/deploy.md',
          relativePath: '.claude/commands/deploy.md',
        }),
      ],
    });

    const issues = filenameCasingRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('produces one issue per miscased file when multiple are present', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: '/test/claude.md',
        relativePath: 'claude.md',
      }),
      projectSkills: [
        makeFileInfo({
          path: '/test/.claude/skills/a/Skill.md',
          relativePath: '.claude/skills/a/Skill.md',
        }),
        makeFileInfo({
          path: '/test/.claude/skills/b/SKILL.md',
          relativePath: '.claude/skills/b/SKILL.md',
        }),
      ],
    });

    const issues = filenameCasingRule.check(inventory, resolved);
    expect(issues).toHaveLength(2);
    expect(issues[0].file).toBe('/test/claude.md');
    expect(issues[1].file).toBe('/test/.claude/skills/a/Skill.md');
  });

  it('produces no issues for empty inventory (all nulls)', () => {
    const inventory = makeInventory();
    const issues = filenameCasingRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('skips non-existent files', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: '/test/claude.md',
        relativePath: 'claude.md',
        exists: false,
      }),
    });

    const issues = filenameCasingRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('detects miscased CLAUDE.local.md', () => {
    const inventory = makeInventory({
      localClaudeMd: makeFileInfo({
        path: '/test/Claude.Local.md',
        relativePath: 'Claude.Local.md',
        scope: 'project-local',
      }),
    });

    const issues = filenameCasingRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('Claude.Local.md');
    expect(issues[0].message).toContain('CLAUDE.local.md');
  });

  it('detects miscased subdirectory CLAUDE.md', () => {
    const inventory = makeInventory({
      subdirClaudeMds: [
        makeFileInfo({
          path: '/test/src/claude.md',
          relativePath: 'src/claude.md',
        }),
      ],
    });

    const issues = filenameCasingRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('claude.md');
    expect(issues[0].message).toContain('CLAUDE.md');
  });

  it('detects miscased .mcp.json', () => {
    const inventory = makeInventory({
      projectMcp: makeFileInfo({
        path: '/test/.MCP.json',
        relativePath: '.MCP.json',
      }),
    });

    const issues = filenameCasingRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('.MCP.json');
    expect(issues[0].message).toContain('.mcp.json');
  });

  it('has correct rule metadata', () => {
    expect(filenameCasingRule.id).toBe('naming/filename-casing');
    expect(filenameCasingRule.severity).toBe('warning');
    expect(filenameCasingRule.category).toBe('naming');
  });
});
