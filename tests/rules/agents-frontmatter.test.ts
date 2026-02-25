import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { agentFrontmatterPresentRule } from '../../src/rules/agents/frontmatter-present.js';
import { agentFrontmatterValidRule } from '../../src/rules/agents/frontmatter-valid.js';
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

describe('agents/frontmatter-present rule', () => {
  const resolved = resolve(makeInventory());

  it('passes for agent with frontmatter', () => {
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(FIXTURES, 'full-project', '.claude', 'agents', 'reviewer.md'),
          relativePath: '.claude/agents/reviewer.md',
        }),
      ],
    });
    const issues = agentFrontmatterPresentRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('warns for agent without frontmatter', () => {
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(FIXTURES, 'overconfigured', '.claude', 'agents', 'helper.md'),
          relativePath: '.claude/agents/helper.md',
        }),
      ],
    });
    const issues = agentFrontmatterPresentRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('agents/frontmatter-present');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].category).toBe('agents');
  });

  it('checks both project and user agents', () => {
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(FIXTURES, 'overconfigured', '.claude', 'agents', 'helper.md'),
          relativePath: '.claude/agents/helper.md',
        }),
      ],
      userAgents: [
        makeFileInfo({
          path: join(FIXTURES, 'conflicting', '.claude', 'agents', 'broken.md'),
          relativePath: '~/.claude/agents/broken.md',
        }),
      ],
    });
    const issues = agentFrontmatterPresentRule.check(inventory, resolved);
    expect(issues).toHaveLength(2);
  });

  it('passes when no agents exist', () => {
    const inventory = makeInventory({ projectAgents: [], userAgents: [] });
    const issues = agentFrontmatterPresentRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });
});

describe('agents/frontmatter-valid rule', () => {
  const resolved = resolve(makeInventory());

  it('passes for valid agent frontmatter', () => {
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(FIXTURES, 'full-project', '.claude', 'agents', 'reviewer.md'),
          relativePath: '.claude/agents/reviewer.md',
        }),
      ],
    });
    const issues = agentFrontmatterValidRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('warns when tools is not an array', () => {
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(FIXTURES, 'overconfigured', '.claude', 'agents', 'reviewer.md'),
          relativePath: '.claude/agents/reviewer.md',
        }),
      ],
    });
    const issues = agentFrontmatterValidRule.check(inventory, resolved);
    const toolsIssues = issues.filter((i) => i.message.includes('tools'));
    expect(toolsIssues.length).toBeGreaterThan(0);
  });

  it('warns for unknown frontmatter fields', () => {
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(FIXTURES, 'overconfigured', '.claude', 'agents', 'reviewer.md'),
          relativePath: '.claude/agents/reviewer.md',
        }),
      ],
    });
    const issues = agentFrontmatterValidRule.check(inventory, resolved);
    const unknownIssues = issues.filter((i) => i.message.includes('unknown'));
    expect(unknownIssues.length).toBeGreaterThan(0);
  });

  it('skips agents without frontmatter', () => {
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(FIXTURES, 'overconfigured', '.claude', 'agents', 'helper.md'),
          relativePath: '.claude/agents/helper.md',
        }),
      ],
    });
    const issues = agentFrontmatterValidRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });
});
