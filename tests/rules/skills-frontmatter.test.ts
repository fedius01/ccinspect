import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { skillFrontmatterPresentRule } from '../../src/rules/skills/frontmatter-present.js';
import { skillFrontmatterValidRule } from '../../src/rules/skills/frontmatter-valid.js';
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
    path: '/test/SKILL.md',
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

describe('skills/frontmatter-present rule', () => {
  const resolved = resolve(makeInventory());

  it('passes for skill with frontmatter', () => {
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: join(FIXTURES, 'full-project', '.claude', 'skills', 'code-review', 'SKILL.md'),
          relativePath: '.claude/skills/code-review/SKILL.md',
        }),
      ],
    });
    const issues = skillFrontmatterPresentRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('warns for skill without frontmatter (overconfigured helper agent used as proxy)', () => {
    // Use a file without frontmatter — overconfigured helper.md
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: join(FIXTURES, 'overconfigured', '.claude', 'agents', 'helper.md'),
          relativePath: '.claude/skills/no-frontmatter/SKILL.md',
        }),
      ],
    });
    const issues = skillFrontmatterPresentRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('skills/frontmatter-present');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].category).toBe('skills');
  });

  it('passes when no skills exist', () => {
    const inventory = makeInventory({ projectSkills: [] });
    const issues = skillFrontmatterPresentRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });
});

describe('skills/frontmatter-valid rule', () => {
  const resolved = resolve(makeInventory());

  it('passes for valid skill frontmatter', () => {
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: join(FIXTURES, 'full-project', '.claude', 'skills', 'code-review', 'SKILL.md'),
          relativePath: '.claude/skills/code-review/SKILL.md',
        }),
      ],
    });
    const issues = skillFrontmatterValidRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('warns for missing name field', () => {
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: join(FIXTURES, 'overconfigured', '.claude', 'skills', 'my-skill', 'SKILL.md'),
          relativePath: '.claude/skills/my-skill/SKILL.md',
        }),
      ],
    });
    const issues = skillFrontmatterValidRule.check(inventory, resolved);
    const nameIssues = issues.filter((i) => i.message.includes('name'));
    expect(nameIssues.length).toBeGreaterThan(0);
  });

  it('warns for missing name and description', () => {
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: join(FIXTURES, 'conflicting', '.claude', 'skills', 'bad-skill', 'SKILL.md'),
          relativePath: '.claude/skills/bad-skill/SKILL.md',
        }),
      ],
    });
    const issues = skillFrontmatterValidRule.check(inventory, resolved);
    const nameIssues = issues.filter((i) => i.message.includes('name'));
    const descIssues = issues.filter((i) => i.message.includes('description'));
    expect(nameIssues.length).toBeGreaterThan(0);
    expect(descIssues.length).toBeGreaterThan(0);
  });

  it('warns for unknown fields', () => {
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: join(FIXTURES, 'conflicting', '.claude', 'skills', 'bad-skill', 'SKILL.md'),
          relativePath: '.claude/skills/bad-skill/SKILL.md',
        }),
      ],
    });
    const issues = skillFrontmatterValidRule.check(inventory, resolved);
    const unknownIssues = issues.filter((i) => i.message.includes('unknown'));
    // "priority" is unknown (license is now a known field)
    expect(unknownIssues.length).toBeGreaterThan(0);
  });

  it('skips skills without frontmatter', () => {
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: join(FIXTURES, 'overconfigured', '.claude', 'agents', 'helper.md'),
          relativePath: '.claude/skills/no-fm/SKILL.md',
        }),
      ],
    });
    const issues = skillFrontmatterValidRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('accepts all valid fields without unknown-field warnings', () => {
    // Create a temp skill file with every valid field
    const tmpDir = mkdtempSync(join(tmpdir(), 'cci-skill-test-'));
    const skillDir = join(tmpDir, '.claude', 'skills', 'all-fields');
    mkdirSync(skillDir, { recursive: true });
    const skillPath = join(skillDir, 'SKILL.md');
    writeFileSync(
      skillPath,
      [
        '---',
        'name: all-fields-skill',
        'description: A skill with every valid field',
        'allowed-tools: ["Read", "Edit"]',
        'disable-model-invocation: false',
        'user-invocable: true',
        'context: fork',
        'agent: my-agent',
        'model: sonnet',
        'argument-hint: "<file-path>"',
        'hooks: {}',
        'license: MIT',
        'metadata: {}',
        '---',
        '',
        '# All Fields Skill',
      ].join('\n'),
    );

    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: skillPath,
          relativePath: '.claude/skills/all-fields/SKILL.md',
        }),
      ],
    });
    const issues = skillFrontmatterValidRule.check(inventory, resolved);
    const unknownIssues = issues.filter((i) => i.message.includes('unknown'));
    expect(unknownIssues).toHaveLength(0);
  });

  it('flags version and mode as unknown fields', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cci-skill-test-'));
    const skillDir = join(tmpDir, '.claude', 'skills', 'old-fields');
    mkdirSync(skillDir, { recursive: true });
    const skillPath = join(skillDir, 'SKILL.md');
    writeFileSync(
      skillPath,
      [
        '---',
        'name: old-fields-skill',
        'description: A skill with removed fields',
        'version: 1.0',
        'mode: test',
        '---',
        '',
        '# Old Fields Skill',
      ].join('\n'),
    );

    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: skillPath,
          relativePath: '.claude/skills/old-fields/SKILL.md',
        }),
      ],
    });
    const issues = skillFrontmatterValidRule.check(inventory, resolved);
    const unknownIssues = issues.filter((i) => i.message.includes('unknown'));
    expect(unknownIssues).toHaveLength(2);
    expect(unknownIssues.some((i) => i.message.includes('"version"'))).toBe(true);
    expect(unknownIssues.some((i) => i.message.includes('"mode"'))).toBe(true);
  });

  it('does not include user-invokable (with k) in allowlist', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cci-skill-test-'));
    const skillDir = join(tmpDir, '.claude', 'skills', 'typo-skill');
    mkdirSync(skillDir, { recursive: true });
    const skillPath = join(skillDir, 'SKILL.md');
    writeFileSync(
      skillPath,
      [
        '---',
        'name: typo-skill',
        'description: Skill with wrong spelling',
        'user-invokable: false',
        '---',
        '',
        '# Typo Skill',
      ].join('\n'),
    );

    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: skillPath,
          relativePath: '.claude/skills/typo-skill/SKILL.md',
        }),
      ],
    });
    const issues = skillFrontmatterValidRule.check(inventory, resolved);
    const unknownIssues = issues.filter((i) => i.message.includes('unknown'));
    expect(unknownIssues).toHaveLength(1);
    expect(unknownIssues[0].message).toContain('"user-invokable"');
  });

  it('emits info severity for unknown fields on symlinked (third-party) skills', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cci-skill-test-'));
    // Create the actual skill in a source directory
    const sourceDir = join(tmpDir, 'source', 'dignified-python');
    mkdirSync(sourceDir, { recursive: true });
    const sourcePath = join(sourceDir, 'SKILL.md');
    writeFileSync(
      sourcePath,
      [
        '---',
        'name: dignified-python',
        'description: Python coding standards',
        'references:',
        '  - pep8',
        '---',
        '',
        '# Dignified Python',
      ].join('\n'),
    );

    // Create a symlinked skill directory
    const skillsDir = join(tmpDir, '.claude', 'skills');
    mkdirSync(skillsDir, { recursive: true });
    symlinkSync(sourceDir, join(skillsDir, 'dignified-python'));

    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: join(skillsDir, 'dignified-python', 'SKILL.md'),
          relativePath: '.claude/skills/dignified-python/SKILL.md',
          isSymlink: true,
          symlinkTarget: sourceDir,
        }),
      ],
    });
    const issues = skillFrontmatterValidRule.check(inventory, resolved);
    const unknownIssues = issues.filter((i) => i.message.includes('unknown'));
    expect(unknownIssues).toHaveLength(1);
    expect(unknownIssues[0].severity).toBe('info');
    expect(unknownIssues[0].message).toContain('Third-party skill');
    expect(unknownIssues[0].message).toContain('dignified-python');
    expect(unknownIssues[0].suggestion).toContain('installed via a package manager');
  });

  it('emits warning severity for unknown fields on non-symlinked skills', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cci-skill-test-'));
    const skillDir = join(tmpDir, '.claude', 'skills', 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    const skillPath = join(skillDir, 'SKILL.md');
    writeFileSync(
      skillPath,
      [
        '---',
        'name: my-skill',
        'description: A local skill',
        'custom-field: value',
        '---',
        '',
        '# My Skill',
      ].join('\n'),
    );

    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: skillPath,
          relativePath: '.claude/skills/my-skill/SKILL.md',
        }),
      ],
    });
    const issues = skillFrontmatterValidRule.check(inventory, resolved);
    const unknownIssues = issues.filter((i) => i.message.includes('unknown'));
    expect(unknownIssues).toHaveLength(1);
    expect(unknownIssues[0].severity).toBe('warning');
    expect(unknownIssues[0].message).not.toContain('Third-party');
  });

  it('shows correct known fields in suggestion text', () => {
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: join(FIXTURES, 'conflicting', '.claude', 'skills', 'bad-skill', 'SKILL.md'),
          relativePath: '.claude/skills/bad-skill/SKILL.md',
        }),
      ],
    });
    const issues = skillFrontmatterValidRule.check(inventory, resolved);
    const unknownIssues = issues.filter((i) => i.message.includes('unknown'));
    expect(unknownIssues.length).toBeGreaterThan(0);
    // Must NOT contain the wrong fields
    expect(unknownIssues[0].suggestion).not.toContain('user-invokable');
    expect(unknownIssues[0].suggestion).not.toContain(', version,');
    expect(unknownIssues[0].suggestion).not.toContain(', mode,');
    // Must contain the correct fields
    expect(unknownIssues[0].suggestion).toContain('user-invocable');
    expect(unknownIssues[0].suggestion).toContain('context');
    expect(unknownIssues[0].suggestion).toContain('metadata');
  });
});
