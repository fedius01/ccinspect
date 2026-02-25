import { describe, it, expect } from 'vitest';
import { join } from 'path';
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
    // "license" is unknown
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
});
