import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { skillDescriptionVagueRule } from '../../src/rules/skills/description-vague.js';
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

function createSkillFile(dirName: string, frontmatter: string): string {
  const tmpDir = mkdtempSync(join(tmpdir(), 'cci-vague-test-'));
  const skillDir = join(tmpDir, '.claude', 'skills', dirName);
  mkdirSync(skillDir, { recursive: true });
  const skillPath = join(skillDir, 'SKILL.md');
  writeFileSync(skillPath, frontmatter);
  return skillPath;
}

describe('skills/description-vague rule', () => {
  const resolved = createEmptyResolvedConfig();

  it('flags missing description', () => {
    const skillPath = createSkillFile(
      'test-skill',
      ['---', 'name: test-skill', '---', '', '# Test'].join('\n'),
    );
    const inventory = makeInventory({
      projectSkills: [makeFileInfo({ path: skillPath, relativePath: '.claude/skills/test-skill/SKILL.md' })],
    });
    const issues = skillDescriptionVagueRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('skills/description-vague');
    expect(issues[0].severity).toBe('info');
    expect(issues[0].category).toBe('skills');
    expect(issues[0].message).toContain('no description');
    expect(issues[0].message).toContain('auto-invoke');
  });

  it('flags too-short description (under 20 chars)', () => {
    const skillPath = createSkillFile(
      'test-skill',
      ['---', 'name: test-skill', 'description: A tool', '---', '', '# Test'].join('\n'),
    );
    const inventory = makeInventory({
      projectSkills: [makeFileInfo({ path: skillPath, relativePath: '.claude/skills/test-skill/SKILL.md' })],
    });
    const issues = skillDescriptionVagueRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('6 chars');
    expect(issues[0].message).toContain('under 20');
    expect(issues[0].evidence).toHaveLength(1);
    expect(issues[0].evidence![0].content).toContain('A tool');
  });

  it('flags vague language: "helps with"', () => {
    const skillPath = createSkillFile(
      'test-skill',
      ['---', 'name: test-skill', 'description: Helps with general tasks and stuff', '---', '', '# Test'].join('\n'),
    );
    const inventory = makeInventory({
      projectSkills: [makeFileInfo({ path: skillPath, relativePath: '.claude/skills/test-skill/SKILL.md' })],
    });
    const issues = skillDescriptionVagueRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('vague language');
    expect(issues[0].message).toContain('Helps with');
    expect(issues[0].evidence).toHaveLength(1);
  });

  it('flags vague language: "for tasks"', () => {
    const skillPath = createSkillFile(
      'test-skill',
      ['---', 'name: test-skill', 'description: Useful for tasks related to coding', '---', '', '# Test'].join('\n'),
    );
    const inventory = makeInventory({
      projectSkills: [makeFileInfo({ path: skillPath, relativePath: '.claude/skills/test-skill/SKILL.md' })],
    });
    const issues = skillDescriptionVagueRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('for tasks');
  });

  it('flags vague language: "general purpose"', () => {
    const skillPath = createSkillFile(
      'test-skill',
      ['---', 'name: test-skill', 'description: A general purpose utility for development', '---', '', '# Test'].join('\n'),
    );
    const inventory = makeInventory({
      projectSkills: [makeFileInfo({ path: skillPath, relativePath: '.claude/skills/test-skill/SKILL.md' })],
    });
    const issues = skillDescriptionVagueRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('general purpose');
  });

  it('passes for specific, adequately long description', () => {
    const skillPath = createSkillFile(
      'test-skill',
      ['---', 'name: test-skill', 'description: Generates database migration files when schema changes are needed', '---', '', '# Test'].join('\n'),
    );
    const inventory = makeInventory({
      projectSkills: [makeFileInfo({ path: skillPath, relativePath: '.claude/skills/test-skill/SKILL.md' })],
    });
    const issues = skillDescriptionVagueRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('skips when no frontmatter', () => {
    const skillPath = createSkillFile('test-skill', '# Just content\nNo frontmatter.\n');
    const inventory = makeInventory({
      projectSkills: [makeFileInfo({ path: skillPath, relativePath: '.claude/skills/test-skill/SKILL.md' })],
    });
    const issues = skillDescriptionVagueRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('skips non-existent skill files', () => {
    const inventory = makeInventory({
      projectSkills: [makeFileInfo({ exists: false })],
    });
    const issues = skillDescriptionVagueRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('uses name field in message, falls back to directory name', () => {
    const skillPath = createSkillFile(
      'my-dir',
      ['---', 'name: my-named-skill', '---', '', '# Test'].join('\n'),
    );
    const inventory = makeInventory({
      projectSkills: [makeFileInfo({ path: skillPath })],
    });
    const issues = skillDescriptionVagueRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('my-named-skill');
  });

  it('falls back to directory name when name field missing', () => {
    const skillPath = createSkillFile(
      'fallback-dir',
      ['---', 'allowed-tools: ["Read"]', '---', '', '# Test'].join('\n'),
    );
    const inventory = makeInventory({
      projectSkills: [makeFileInfo({ path: skillPath })],
    });
    const issues = skillDescriptionVagueRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('fallback-dir');
  });

  it('only reports first vague pattern match per skill', () => {
    const skillPath = createSkillFile(
      'test-skill',
      ['---', 'name: test-skill', 'description: Helps with general purpose tasks and use when needed', '---', '', '# Test'].join('\n'),
    );
    const inventory = makeInventory({
      projectSkills: [makeFileInfo({ path: skillPath, relativePath: '.claude/skills/test-skill/SKILL.md' })],
    });
    const issues = skillDescriptionVagueRule.check(inventory, resolved);
    // Multiple vague patterns match, but only one issue should be emitted
    expect(issues).toHaveLength(1);
  });

  it('description at exactly 20 chars passes length check', () => {
    const skillPath = createSkillFile(
      'test-skill',
      ['---', 'name: test-skill', 'description: "Exactly twenty chars!"', '---', '', '# Test'].join('\n'),
    );
    const inventory = makeInventory({
      projectSkills: [makeFileInfo({ path: skillPath, relativePath: '.claude/skills/test-skill/SKILL.md' })],
    });
    const issues = skillDescriptionVagueRule.check(inventory, resolved);
    // 20 chars is not "under 20", so no length issue — but check for vague patterns
    const lengthIssues = issues.filter((i) => i.message.includes('chars'));
    expect(lengthIssues).toHaveLength(0);
  });

  it('checks user-scope skills', () => {
    const skillPath = createSkillFile(
      'global-skill',
      ['---', 'name: global-skill', '---', '', '# Test'].join('\n'),
    );
    const inventory = makeInventory({
      userSkills: [makeFileInfo({ path: skillPath, scope: 'user' })],
    });
    const issues = skillDescriptionVagueRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
  });
});
