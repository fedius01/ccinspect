import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { agentReferenceValidRule } from '../../src/rules/skills/agent-reference-valid.js';
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

describe('skills/agent-reference-valid rule', () => {
  const resolved = resolve(makeInventory());

  it('passes when skill references existing agents', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'skills', 'code-review', 'SKILL.md'),
          relativePath: '.claude/skills/code-review/SKILL.md',
        }),
      ],
      projectAgents: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'agents', 'reviewer.md'),
          relativePath: '.claude/agents/reviewer.md',
        }),
      ],
    });
    const issues = agentReferenceValidRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('reports error when skill references non-existent agent', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'skills', 'code-review', 'SKILL.md'),
          relativePath: '.claude/skills/code-review/SKILL.md',
        }),
      ],
      projectAgents: [], // No agents
    });
    const issues = agentReferenceValidRule.check(inventory, resolved);
    // code-review SKILL.md says "Delegates to the reviewer agent"
    const broken = issues.filter((i) => i.message.includes('reviewer'));
    expect(broken).toHaveLength(1);
    expect(broken[0].severity).toBe('error');
    expect(broken[0].ruleId).toBe('skills/agent-reference-valid');
  });

  it('passes when skill has no agent references', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'skills', 'deploy-helper', 'SKILL.md'),
          relativePath: '.claude/skills/deploy-helper/SKILL.md',
        }),
      ],
      projectAgents: [],
    });
    const issues = agentReferenceValidRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('passes when no skills exist', () => {
    const inventory = makeInventory({ projectSkills: [] });
    const issues = agentReferenceValidRule.check(inventory, resolved);
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
    const issues = agentReferenceValidRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('considers user agents as valid targets', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'skills', 'code-review', 'SKILL.md'),
          relativePath: '.claude/skills/code-review/SKILL.md',
        }),
      ],
      userAgents: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'agents', 'reviewer.md'),
          relativePath: '~/.claude/agents/reviewer.md',
        }),
      ],
    });
    const issues = agentReferenceValidRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });
});
