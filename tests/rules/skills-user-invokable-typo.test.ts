import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { userInvokableTypoRule } from '../../src/rules/skills/user-invokable-typo.js';
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

function createSkillFile(frontmatter: string): string {
  const tmpDir = mkdtempSync(join(tmpdir(), 'cci-typo-test-'));
  const skillDir = join(tmpDir, '.claude', 'skills', 'test-skill');
  mkdirSync(skillDir, { recursive: true });
  const skillPath = join(skillDir, 'SKILL.md');
  writeFileSync(skillPath, frontmatter);
  return skillPath;
}

describe('skills/user-invokable-typo rule', () => {
  const resolved = createEmptyResolvedConfig();

  it('flags user-invokable (with k) as error', () => {
    const skillPath = createSkillFile(
      ['---', 'name: test-skill', 'description: A test skill', 'user-invokable: false', '---', '', '# Test'].join('\n'),
    );
    const inventory = makeInventory({
      projectSkills: [makeFileInfo({ path: skillPath, relativePath: '.claude/skills/test-skill/SKILL.md' })],
    });
    const issues = userInvokableTypoRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('skills/user-invokable-typo');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].category).toBe('skills');
    expect(issues[0].message).toContain('test-skill');
    expect(issues[0].message).toContain('user-invokable');
    expect(issues[0].message).toContain('silently ignored');
    expect(issues[0].suggestion).toContain('user-invocable');
    expect(issues[0].autoFixable).toBe(true);
    expect(issues[0].evidence).toHaveLength(1);
    expect(issues[0].evidence![0].content).toContain('user-invokable: false');
  });

  it('passes for correct spelling user-invocable (with c)', () => {
    const skillPath = createSkillFile(
      ['---', 'name: test-skill', 'description: A test skill', 'user-invocable: false', '---', '', '# Test'].join('\n'),
    );
    const inventory = makeInventory({
      projectSkills: [makeFileInfo({ path: skillPath, relativePath: '.claude/skills/test-skill/SKILL.md' })],
    });
    const issues = userInvokableTypoRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('passes when neither field is present', () => {
    const skillPath = createSkillFile(
      ['---', 'name: test-skill', 'description: A test skill', '---', '', '# Test'].join('\n'),
    );
    const inventory = makeInventory({
      projectSkills: [makeFileInfo({ path: skillPath, relativePath: '.claude/skills/test-skill/SKILL.md' })],
    });
    const issues = userInvokableTypoRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('uses name field from frontmatter in message', () => {
    const skillPath = createSkillFile(
      ['---', 'name: my-custom-skill', 'description: Custom', 'user-invokable: true', '---', '', '# Test'].join('\n'),
    );
    const inventory = makeInventory({
      projectSkills: [makeFileInfo({ path: skillPath, relativePath: '.claude/skills/test-skill/SKILL.md' })],
    });
    const issues = userInvokableTypoRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('my-custom-skill');
  });

  it('falls back to directory name when name field is missing', () => {
    const skillPath = createSkillFile(
      ['---', 'description: A skill', 'user-invokable: false', '---', '', '# Test'].join('\n'),
    );
    const inventory = makeInventory({
      projectSkills: [makeFileInfo({ path: skillPath })],
    });
    const issues = userInvokableTypoRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    // Should use directory name as fallback
    expect(issues[0].message).toContain('test-skill');
  });

  it('skips non-existent skill files', () => {
    const inventory = makeInventory({
      projectSkills: [makeFileInfo({ exists: false })],
    });
    const issues = userInvokableTypoRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('skips skills without frontmatter', () => {
    const skillPath = createSkillFile('# Just content, no frontmatter\n');
    const inventory = makeInventory({
      projectSkills: [makeFileInfo({ path: skillPath })],
    });
    const issues = userInvokableTypoRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('checks user-scope skills too', () => {
    const skillPath = createSkillFile(
      ['---', 'name: global-skill', 'description: Global', 'user-invokable: false', '---', '', '# Test'].join('\n'),
    );
    const inventory = makeInventory({
      userSkills: [makeFileInfo({ path: skillPath, scope: 'user' })],
    });
    const issues = userInvokableTypoRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
  });
});
