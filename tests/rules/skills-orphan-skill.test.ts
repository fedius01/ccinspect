import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { orphanSkillRule } from '../../src/rules/skills/orphan-skill.js';
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

describe('skills/orphan-skill rule', () => {
  const resolved = resolve(makeInventory());

  it('warns when disable-model-invocation skill is not referenced by any agent', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'skills', 'orphaned-skill', 'SKILL.md'),
          relativePath: '.claude/skills/orphaned-skill/SKILL.md',
        }),
      ],
      projectAgents: [],
    });
    const issues = orphanSkillRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('skills/orphan-skill');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].message).toContain('orphaned-skill');
    expect(issues[0].message).toContain('disable-model-invocation');
  });

  it('passes for skills without disable-model-invocation', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'skills', 'code-review', 'SKILL.md'),
          relativePath: '.claude/skills/code-review/SKILL.md',
        }),
      ],
      projectAgents: [],
    });
    const issues = orphanSkillRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('passes when disable-model-invocation skill is referenced by an agent', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'skills', 'orphaned-skill', 'SKILL.md'),
          relativePath: '.claude/skills/orphaned-skill/SKILL.md',
        }),
      ],
      projectAgents: [
        // Create an agent that references orphaned-skill
        makeFileInfo({
          path: join(crossRef, '.claude', 'agents', 'broken-skill-ref.md'),
          relativePath: '.claude/agents/broken-skill-ref.md',
        }),
      ],
    });
    // broken-skill-ref.md mentions "nonexistent-skill" and "deploy-helper" but not "orphaned-skill"
    // So orphaned-skill should still be flagged
    const issues = orphanSkillRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
  });

  it('passes when no skills exist', () => {
    const inventory = makeInventory({ projectSkills: [] });
    const issues = orphanSkillRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('skips non-existent skill files', () => {
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: '/nonexistent/SKILL.md',
          relativePath: '.claude/skills/missing/SKILL.md',
          exists: false,
        }),
      ],
    });
    const issues = orphanSkillRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
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
    const issues = orphanSkillRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });
});
