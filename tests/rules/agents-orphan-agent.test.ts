import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { orphanAgentRule } from '../../src/rules/agents/orphan-agent.js';
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

describe('agents/orphan-agent rule', () => {
  const resolved = resolve(makeInventory());

  it('detects orphaned agents not referenced anywhere', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'agents', 'orphan.md'),
          relativePath: '.claude/agents/orphan.md',
        }),
        makeFileInfo({
          path: join(crossRef, '.claude', 'agents', 'reviewer.md'),
          relativePath: '.claude/agents/reviewer.md',
        }),
      ],
    });
    const issues = orphanAgentRule.check(inventory, resolved);
    // Both agents are orphans (neither references the other by name as an "agent")
    // reviewer mentions skills, not other agents
    expect(issues.length).toBeGreaterThan(0);
    const orphanIssue = issues.find((i) => i.message.includes('"orphan"'));
    expect(orphanIssue).toBeDefined();
    expect(orphanIssue?.severity).toBe('info');
    expect(orphanIssue?.ruleId).toBe('agents/orphan-agent');
  });

  it('does not flag agents referenced in skills', () => {
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
      ],
    });
    const issues = orphanAgentRule.check(inventory, resolved);
    // code-review SKILL.md says "Delegates to the reviewer agent"
    const reviewerIssue = issues.find((i) => i.message.includes('"reviewer"'));
    expect(reviewerIssue).toBeUndefined();
  });

  it('does not flag agents mentioned in CLAUDE.md', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'agents', 'reviewer.md'),
          relativePath: '.claude/agents/reviewer.md',
        }),
        makeFileInfo({
          path: join(crossRef, '.claude', 'agents', 'deployer.md'),
          relativePath: '.claude/agents/deployer.md',
        }),
      ],
      projectClaudeMd: makeFileInfo({
        path: join(crossRef, 'CLAUDE.md'),
        relativePath: 'CLAUDE.md',
      }),
    });
    const issues = orphanAgentRule.check(inventory, resolved);
    // CLAUDE.md mentions "reviewer" and "deployer"
    const reviewerIssue = issues.find((i) => i.message.includes('"reviewer"'));
    const deployerIssue = issues.find((i) => i.message.includes('"deployer"'));
    expect(reviewerIssue).toBeUndefined();
    expect(deployerIssue).toBeUndefined();
  });

  it('passes when no agents exist', () => {
    const inventory = makeInventory({ projectAgents: [], userAgents: [] });
    const issues = orphanAgentRule.check(inventory, resolved);
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
    const issues = orphanAgentRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });
});
