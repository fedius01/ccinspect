import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { symlinkDetectedRule } from '../../src/rules/skills/symlink-detected.js';
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

describe('skills/symlink-detected rule', () => {
  const resolved = createEmptyResolvedConfig();

  it('reports symlinked skill', () => {
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: '/test/.claude/skills/test-skill/SKILL.md',
          relativePath: '.claude/skills/test-skill/SKILL.md',
          isSymlink: true,
          symlinkTarget: '../../.agents/skills/test-skill/SKILL.md',
        }),
      ],
    });
    const issues = symlinkDetectedRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('skills/symlink-detected');
    expect(issues[0].severity).toBe('info');
    expect(issues[0].category).toBe('skills');
    expect(issues[0].message).toContain('test-skill');
    expect(issues[0].message).toContain('symlink');
    expect(issues[0].suggestion).toContain('../../.agents/skills/test-skill/SKILL.md');
    expect(issues[0].evidence).toHaveLength(1);
    expect(issues[0].evidence![0].content).toContain('../../.agents/skills/test-skill/SKILL.md');
  });

  it('does not report non-symlinked skill', () => {
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: '/test/.claude/skills/regular-skill/SKILL.md',
          relativePath: '.claude/skills/regular-skill/SKILL.md',
          // isSymlink not set (undefined)
        }),
      ],
    });
    const issues = symlinkDetectedRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('reports multiple symlinked skills and ignores regular ones', () => {
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: '/test/.claude/skills/skill-a/SKILL.md',
          relativePath: '.claude/skills/skill-a/SKILL.md',
          isSymlink: true,
          symlinkTarget: '../../.agents/skills/skill-a/SKILL.md',
        }),
        makeFileInfo({
          path: '/test/.claude/skills/regular/SKILL.md',
          relativePath: '.claude/skills/regular/SKILL.md',
        }),
        makeFileInfo({
          path: '/test/.claude/skills/skill-b/SKILL.md',
          relativePath: '.claude/skills/skill-b/SKILL.md',
          isSymlink: true,
          symlinkTarget: '../../.agents/skills/skill-b/SKILL.md',
        }),
      ],
    });
    const issues = symlinkDetectedRule.check(inventory, resolved);
    expect(issues).toHaveLength(2);
    expect(issues[0].message).toContain('skill-a');
    expect(issues[1].message).toContain('skill-b');
  });

  it('handles user-scope symlinked skills', () => {
    const inventory = makeInventory({
      projectSkills: [],
      userSkills: [
        makeFileInfo({
          path: '/home/user/.claude/skills/shared-skill/SKILL.md',
          relativePath: '~/.claude/skills/shared-skill/SKILL.md',
          scope: 'user',
          isSymlink: true,
          symlinkTarget: '../../../.agents/skills/shared-skill/SKILL.md',
        }),
      ],
    });
    const issues = symlinkDetectedRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('shared-skill');
  });

  it('skips non-existent skill files', () => {
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: '/test/.claude/skills/missing/SKILL.md',
          relativePath: '.claude/skills/missing/SKILL.md',
          exists: false,
          isSymlink: true,
          symlinkTarget: '../../.agents/skills/missing/SKILL.md',
        }),
      ],
    });
    const issues = symlinkDetectedRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });
});

describe('skills/symlink-detected scanner integration', () => {
  const tmpDir = join(tmpdir(), `cci-symlink-rule-test-${process.pid}`);

  beforeEach(() => {
    // Create the real skill file outside .claude/skills/
    mkdirSync(join(tmpDir, '.agents', 'skills', 'test-skill'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.agents', 'skills', 'test-skill', 'SKILL.md'),
      [
        '---',
        'name: test-skill',
        'description: A test skill installed via skills.sh',
        '---',
        '# Test Skill',
        'This is a test.',
      ].join('\n'),
    );

    // Symlink directory into .claude/skills/ (relative, matching skills.sh behavior)
    mkdirSync(join(tmpDir, '.claude', 'skills'), { recursive: true });
    symlinkSync(
      join('..', '..', '.agents', 'skills', 'test-skill'),
      join(tmpDir, '.claude', 'skills', 'test-skill'),
    );
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('scanner populates isSymlink for symlinked skill directory', async () => {
    // Dynamic import to avoid import-time side effects
    const { scan } = await import('../../src/core/scanner.js');
    const { execSync } = await import('child_process');

    // git init so scanner can resolve git root
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });

    const inventory = scan({ projectDir: tmpDir, skipGlobalDirs: true });
    expect(inventory.projectSkills).toHaveLength(1);

    const skill = inventory.projectSkills[0];
    expect(skill.isSymlink).toBe(true);
    expect(skill.symlinkTarget).toBeDefined();
    expect(skill.symlinkTarget).toContain('test-skill');
    expect(skill.symlinkTarget).toContain('.agents');

    // Now run the rule against scanner output
    const issues = symlinkDetectedRule.check(inventory, createEmptyResolvedConfig());
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('skills/symlink-detected');
    expect(issues[0].message).toContain('test-skill');
  });
});
