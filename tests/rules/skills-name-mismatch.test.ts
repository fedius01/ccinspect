import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { skillNameMismatchRule } from '../../src/rules/skills/name-mismatch.js';
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
  const tmpDir = mkdtempSync(join(tmpdir(), 'cci-name-test-'));
  const skillDir = join(tmpDir, '.claude', 'skills', dirName);
  mkdirSync(skillDir, { recursive: true });
  const skillPath = join(skillDir, 'SKILL.md');
  writeFileSync(skillPath, frontmatter);
  return skillPath;
}

describe('skills/name-mismatch rule', () => {
  const resolved = createEmptyResolvedConfig();

  it('warns when directory name differs from frontmatter name', () => {
    const skillPath = createSkillFile(
      'pdf-tools',
      ['---', 'name: pdf-processor', 'description: Processes PDFs', '---', '', '# PDF'].join('\n'),
    );
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: skillPath,
          relativePath: '.claude/skills/pdf-tools/SKILL.md',
        }),
      ],
    });
    const issues = skillNameMismatchRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('skills/name-mismatch');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].category).toBe('skills');
    expect(issues[0].message).toContain('pdf-tools');
    expect(issues[0].message).toContain('pdf-processor');
    expect(issues[0].message).toContain('/pdf-processor');
    expect(issues[0].suggestion).toContain('slash command');
    expect(issues[0].evidence).toHaveLength(1);
    expect(issues[0].evidence![0].content).toContain('pdf-tools');
    expect(issues[0].evidence![0].content).toContain('pdf-processor');
  });

  it('passes when directory name matches frontmatter name', () => {
    const skillPath = createSkillFile(
      'pdf-tools',
      ['---', 'name: pdf-tools', 'description: Processes PDFs', '---', '', '# PDF'].join('\n'),
    );
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: skillPath,
          relativePath: '.claude/skills/pdf-tools/SKILL.md',
        }),
      ],
    });
    const issues = skillNameMismatchRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('skips when name field is missing', () => {
    const skillPath = createSkillFile(
      'pdf-tools',
      ['---', 'description: Processes PDFs', '---', '', '# PDF'].join('\n'),
    );
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: skillPath,
          relativePath: '.claude/skills/pdf-tools/SKILL.md',
        }),
      ],
    });
    const issues = skillNameMismatchRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('skips when frontmatter is absent', () => {
    const skillPath = createSkillFile('pdf-tools', '# Just content\nNo frontmatter here.\n');
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: skillPath,
          relativePath: '.claude/skills/pdf-tools/SKILL.md',
        }),
      ],
    });
    const issues = skillNameMismatchRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('case-sensitive comparison: pdf-tools ≠ PDF-Tools', () => {
    const skillPath = createSkillFile(
      'pdf-tools',
      ['---', 'name: PDF-Tools', 'description: Processes PDFs', '---', '', '# PDF'].join('\n'),
    );
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: skillPath,
          relativePath: '.claude/skills/pdf-tools/SKILL.md',
        }),
      ],
    });
    const issues = skillNameMismatchRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('PDF-Tools');
  });

  it('skips non-existent skill files', () => {
    const inventory = makeInventory({
      projectSkills: [makeFileInfo({ exists: false })],
    });
    const issues = skillNameMismatchRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('checks user-scope skills', () => {
    const skillPath = createSkillFile(
      'my-global-skill',
      ['---', 'name: different-name', 'description: Global skill', '---', '', '# Test'].join('\n'),
    );
    const inventory = makeInventory({
      userSkills: [makeFileInfo({ path: skillPath, scope: 'user' })],
    });
    const issues = skillNameMismatchRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
  });
});
