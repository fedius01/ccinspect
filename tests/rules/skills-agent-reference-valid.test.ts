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
          path: join(crossRef, '.claude', 'agents', 'code-reviewer.md'),
          relativePath: '.claude/agents/code-reviewer.md',
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
    // code-review SKILL.md says "Delegates to the code-reviewer agent"
    const broken = issues.filter((i) => i.message.includes('code-reviewer'));
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
          path: join(crossRef, '.claude', 'agents', 'code-reviewer.md'),
          relativePath: '~/.claude/agents/code-reviewer.md',
        }),
      ],
    });
    const issues = agentReferenceValidRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('includes referencing line as evidence for broken agent reference', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const skillPath = join(crossRef, '.claude', 'skills', 'code-review', 'SKILL.md');
    const inventory = makeInventory({
      projectSkills: [
        makeFileInfo({
          path: skillPath,
          relativePath: '.claude/skills/code-review/SKILL.md',
        }),
      ],
      projectAgents: [], // No agents
    });
    const issues = agentReferenceValidRule.check(inventory, resolved);
    const broken = issues.filter((i) => i.message.includes('code-reviewer'));
    expect(broken).toHaveLength(1);
    expect(broken[0].evidence).toBeDefined();
    expect(broken[0].evidence!.length).toBe(1);
    expect(broken[0].evidence![0].file).toBe(skillPath);
    expect(broken[0].evidence![0].line).toBeGreaterThan(0);
    expect(broken[0].evidence![0].content).toContain('code-reviewer');
  });

  it('ignores single-word agent names from body text (prose noise)', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    // deploy-helper SKILL.md has no hyphenated agent refs
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
    // Single-word refs like "specialized" or "framework" should be filtered out
    expect(issues).toHaveLength(0);
  });
});
