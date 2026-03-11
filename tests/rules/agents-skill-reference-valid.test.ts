import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { skillReferenceValidRule } from '../../src/rules/agents/skill-reference-valid.js';
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
    path: '/test/agent.md',
    relativePath: '.claude/agents/agent.md',
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

describe('agents/skill-reference-valid rule', () => {
  const resolved = resolve(makeInventory());

  it('passes when agent references existing skills', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'agents', 'reviewer.md'),
          relativePath: '.claude/agents/reviewer.md',
        }),
      ],
      projectSkills: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'skills', 'code-review', 'SKILL.md'),
          relativePath: '.claude/skills/code-review/SKILL.md',
        }),
        makeFileInfo({
          path: join(crossRef, '.claude', 'skills', 'deploy-helper', 'SKILL.md'),
          relativePath: '.claude/skills/deploy-helper/SKILL.md',
        }),
      ],
    });
    const issues = skillReferenceValidRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('reports error when agent references non-existent skill', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'agents', 'broken-skill-ref.md'),
          relativePath: '.claude/agents/broken-skill-ref.md',
        }),
      ],
      projectSkills: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'skills', 'deploy-helper', 'SKILL.md'),
          relativePath: '.claude/skills/deploy-helper/SKILL.md',
        }),
      ],
    });
    const issues = skillReferenceValidRule.check(inventory, resolved);
    const broken = issues.filter((i) => i.message.includes('nonexistent-skill'));
    expect(broken).toHaveLength(1);
    expect(broken[0].severity).toBe('error');
    expect(broken[0].ruleId).toBe('agents/skill-reference-valid');
  });

  it('passes when no agents exist', () => {
    const inventory = makeInventory({ projectAgents: [], userAgents: [] });
    const issues = skillReferenceValidRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('passes when agent has no skill references in body', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'agents', 'deployer.md'),
          relativePath: '.claude/agents/deployer.md',
        }),
      ],
      projectSkills: [],
    });
    const issues = skillReferenceValidRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('skips non-existent agent files', () => {
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: '/nonexistent/agent.md',
          relativePath: '.claude/agents/agent.md',
          exists: false,
        }),
      ],
    });
    const issues = skillReferenceValidRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('checks user agents too', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      userAgents: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'agents', 'broken-skill-ref.md'),
          relativePath: '~/.claude/agents/broken-skill-ref.md',
        }),
      ],
      projectSkills: [],
    });
    const issues = skillReferenceValidRule.check(inventory, resolved);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('includes referencing line as evidence for broken skill reference', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const agentPath = join(crossRef, '.claude', 'agents', 'broken-skill-ref.md');
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: agentPath,
          relativePath: '.claude/agents/broken-skill-ref.md',
        }),
      ],
      projectSkills: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'skills', 'deploy-helper', 'SKILL.md'),
          relativePath: '.claude/skills/deploy-helper/SKILL.md',
        }),
      ],
    });
    const issues = skillReferenceValidRule.check(inventory, resolved);
    const broken = issues.filter((i) => i.message.includes('nonexistent-skill'));
    expect(broken).toHaveLength(1);
    expect(broken[0].evidence).toBeDefined();
    expect(broken[0].evidence!.length).toBe(1);
    expect(broken[0].evidence![0].file).toBe(agentPath);
    expect(broken[0].evidence![0].line).toBeGreaterThan(0);
    expect(broken[0].evidence![0].content).toContain('nonexistent-skill');
  });

  it('ignores single-word skill names from body text (prose noise)', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'agents', 'prose-noise.md'),
          relativePath: '.claude/agents/prose-noise.md',
        }),
      ],
      projectSkills: [],
    });
    const issues = skillReferenceValidRule.check(inventory, resolved);
    // "framework" and "structure" are single-word, should be filtered out
    expect(issues).toHaveLength(0);
  });

  it('flags hyphenated skill names from body text', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'agents', 'broken-skill-ref.md'),
          relativePath: '.claude/agents/broken-skill-ref.md',
        }),
      ],
      projectSkills: [], // No skills at all
    });
    const issues = skillReferenceValidRule.check(inventory, resolved);
    // "nonexistent-skill" and "deploy-helper" are hyphenated and both missing
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues.some((i) => i.message.includes('nonexistent-skill'))).toBe(true);
  });

  it('validates frontmatter skills field regardless of naming', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'agents', 'frontmatter-skills.md'),
          relativePath: '.claude/agents/frontmatter-skills.md',
        }),
      ],
      projectSkills: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'skills', 'deploy-helper', 'SKILL.md'),
          relativePath: '.claude/skills/deploy-helper/SKILL.md',
        }),
      ],
    });
    const issues = skillReferenceValidRule.check(inventory, resolved);
    // "missing-skill" is in frontmatter skills and does not exist — should be flagged
    // "deploy-helper" is in frontmatter and exists — should NOT be flagged
    const missingSkill = issues.filter((i) => i.message.includes('missing-skill'));
    expect(missingSkill).toHaveLength(1);
    expect(missingSkill[0].message).toContain('frontmatter');
    expect(missingSkill[0].severity).toBe('error');
  });
});
