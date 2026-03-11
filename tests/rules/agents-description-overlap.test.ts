import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { descriptionOverlapRule } from '../../src/rules/agents/description-overlap.js';
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

describe('agents/description-overlap rule', () => {
  const resolved = resolve(makeInventory());

  it('detects agents with similar descriptions', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'agents', 'reviewer.md'),
          relativePath: '.claude/agents/reviewer.md',
        }),
        makeFileInfo({
          path: join(crossRef, '.claude', 'agents', 'similar-reviewer.md'),
          relativePath: '.claude/agents/similar-reviewer.md',
        }),
      ],
    });
    const issues = descriptionOverlapRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('agents/description-overlap');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].message).toContain('reviewer');
    expect(issues[0].message).toContain('similar-reviewer');
  });

  it('passes for agents with different descriptions', () => {
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
    });
    const issues = descriptionOverlapRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('skips agents without descriptions', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'agents', 'reviewer.md'),
          relativePath: '.claude/agents/reviewer.md',
        }),
        // helper.md has no frontmatter at all
        makeFileInfo({
          path: join(FIXTURES, 'overconfigured', '.claude', 'agents', 'helper.md'),
          relativePath: '.claude/agents/helper.md',
        }),
      ],
    });
    const issues = descriptionOverlapRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('passes when only one agent exists', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'agents', 'reviewer.md'),
          relativePath: '.claude/agents/reviewer.md',
        }),
      ],
    });
    const issues = descriptionOverlapRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('passes when no agents exist', () => {
    const inventory = makeInventory({ projectAgents: [], userAgents: [] });
    const issues = descriptionOverlapRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('respects configurable threshold', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'agents', 'reviewer.md'),
          relativePath: '.claude/agents/reviewer.md',
        }),
        makeFileInfo({
          path: join(crossRef, '.claude', 'agents', 'similar-reviewer.md'),
          relativePath: '.claude/agents/similar-reviewer.md',
        }),
      ],
    });

    // Very high threshold — should not trigger
    const noIssues = descriptionOverlapRule.check(inventory, resolved, { threshold: 0.99 });
    expect(noIssues).toHaveLength(0);

    // Very low threshold — should trigger
    const someIssues = descriptionOverlapRule.check(inventory, resolved, { threshold: 0.1 });
    expect(someIssues.length).toBeGreaterThan(0);
  });

  it('compares across project and user agents', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'agents', 'reviewer.md'),
          relativePath: '.claude/agents/reviewer.md',
        }),
      ],
      userAgents: [
        makeFileInfo({
          path: join(crossRef, '.claude', 'agents', 'similar-reviewer.md'),
          relativePath: '~/.claude/agents/similar-reviewer.md',
        }),
      ],
    });
    const issues = descriptionOverlapRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
  });

  it('includes both descriptions and similarity score as evidence', () => {
    const crossRef = join(FIXTURES, 'cross-reference');
    const reviewerPath = join(crossRef, '.claude', 'agents', 'reviewer.md');
    const similarPath = join(crossRef, '.claude', 'agents', 'similar-reviewer.md');
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: reviewerPath,
          relativePath: '.claude/agents/reviewer.md',
        }),
        makeFileInfo({
          path: similarPath,
          relativePath: '.claude/agents/similar-reviewer.md',
        }),
      ],
    });
    const issues = descriptionOverlapRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].evidence).toBeDefined();
    expect(issues[0].evidence!.length).toBe(3);
    // First two are descriptions
    expect(issues[0].evidence![0].content).toMatch(/^description: "/);
    expect(issues[0].evidence![1].content).toMatch(/^description: "/);
    // Third is similarity score
    expect(issues[0].evidence![2].content).toMatch(/^Jaccard similarity: \d+%$/);
    // File paths match the agents
    const evidenceFiles = issues[0].evidence!.map(e => e.file);
    expect(evidenceFiles).toContain(reviewerPath);
    expect(evidenceFiles).toContain(similarPath);
  });
});
