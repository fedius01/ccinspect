import { describe, it, expect } from 'vitest';
import { skillTooLargeRule } from '../../src/rules/skills/too-large.js';
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
    path: '/test/.claude/skills/my-skill/SKILL.md',
    relativePath: '.claude/skills/my-skill/SKILL.md',
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

describe('skills/too-large rule', () => {
  const resolved = createEmptyResolvedConfig();

  it('passes for skill under 500 lines', () => {
    const inventory = makeInventory({
      projectSkills: [makeFileInfo({ lineCount: 100 })],
    });
    const issues = skillTooLargeRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('passes for skill at exactly 500 lines', () => {
    const inventory = makeInventory({
      projectSkills: [makeFileInfo({ lineCount: 500 })],
    });
    const issues = skillTooLargeRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('warns for skill over 500 lines', () => {
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: '/test/.claude/skills/big-skill/SKILL.md',
          relativePath: '.claude/skills/big-skill/SKILL.md',
          lineCount: 600,
        }),
      ],
    });
    const issues = skillTooLargeRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('skills/too-large');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].category).toBe('skills');
    expect(issues[0].message).toContain('big-skill');
    expect(issues[0].message).toContain('600');
    expect(issues[0].suggestion).toContain('supporting files');
    expect(issues[0].autoFixable).toBe(false);
  });

  it('errors for skill over 1000 lines', () => {
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: '/test/.claude/skills/huge-skill/SKILL.md',
          relativePath: '.claude/skills/huge-skill/SKILL.md',
          lineCount: 1200,
        }),
      ],
    });
    const issues = skillTooLargeRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toContain('1,200');
  });

  it('respects custom thresholds via options', () => {
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: '/test/.claude/skills/medium-skill/SKILL.md',
          lineCount: 250,
        }),
      ],
    });
    // Custom: warn at 200, error at 400
    const issues = skillTooLargeRule.check(inventory, resolved, { warn: 200, error: 400 });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].message).toContain('200'); // threshold shown in message
  });

  it('custom error threshold', () => {
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: '/test/.claude/skills/medium-skill/SKILL.md',
          lineCount: 450,
        }),
      ],
    });
    const issues = skillTooLargeRule.check(inventory, resolved, { warn: 200, error: 400 });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
  });

  it('skips non-existent skills', () => {
    const inventory = makeInventory({
      projectSkills: [makeFileInfo({ exists: false, lineCount: 9999 })],
    });
    const issues = skillTooLargeRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('checks user-scope skills', () => {
    const inventory = makeInventory({
      userSkills: [
        makeFileInfo({
          path: '/home/user/.claude/skills/user-skill/SKILL.md',
          scope: 'user',
          lineCount: 700,
        }),
      ],
    });
    const issues = skillTooLargeRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
  });

  it('includes evidence with line count', () => {
    const inventory = makeInventory({
      projectSkills: [makeFileInfo({ lineCount: 600 })],
    });
    const issues = skillTooLargeRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].evidence).toHaveLength(1);
    expect(issues[0].evidence![0].content).toBe('600 lines');
  });
});
