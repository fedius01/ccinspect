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
});
