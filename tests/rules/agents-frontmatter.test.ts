import { describe, it, expect } from 'vitest';
import { writeFileSync, rmSync } from 'fs';
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

  it('accepts tools as a comma-separated string', () => {
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(FIXTURES, 'overconfigured', '.claude', 'agents', 'reviewer.md'),
          relativePath: '.claude/agents/reviewer.md',
        }),
      ],
    });
    const issues = agentFrontmatterValidRule.check(inventory, resolved);
    const toolsTypeIssues = issues.filter((i) => i.message.includes('tools') && i.message.includes('not a string or array'));
    expect(toolsTypeIssues).toHaveLength(0);
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

  it('accepts all 14 valid frontmatter fields without issues', () => {
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(FIXTURES, 'agent-validation', '.claude', 'agents', 'all-fields.md'),
          relativePath: '.claude/agents/all-fields.md',
        }),
      ],
    });
    const issues = agentFrontmatterValidRule.check(inventory, resolved);
    // Only the missing-name check should not fire; no unknown field warnings
    const unknownFieldIssues = issues.filter((i) => i.message.includes('unknown'));
    expect(unknownFieldIssues).toHaveLength(0);
  });

  it('accepts disallowedTools as a valid field', () => {
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(FIXTURES, 'agent-validation', '.claude', 'agents', 'all-fields.md'),
          relativePath: '.claude/agents/all-fields.md',
        }),
      ],
    });
    const issues = agentFrontmatterValidRule.check(inventory, resolved);
    const disallowedToolsIssues = issues.filter((i) => i.message.includes('disallowedTools'));
    expect(disallowedToolsIssues).toHaveLength(0);
  });

  it('accepts mcpServers, hooks, maxTurns, background, isolation as valid fields', () => {
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(FIXTURES, 'agent-validation', '.claude', 'agents', 'all-fields.md'),
          relativePath: '.claude/agents/all-fields.md',
        }),
      ],
    });
    const issues = agentFrontmatterValidRule.check(inventory, resolved);
    for (const field of ['mcpServers', 'hooks', 'maxTurns', 'background', 'isolation']) {
      const fieldIssues = issues.filter((i) => i.message.includes(field));
      expect(fieldIssues).toHaveLength(0);
    }
  });

  it('emits specific warning for allowedTools (not generic unknown-field)', () => {
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(FIXTURES, 'agent-validation', '.claude', 'agents', 'allowed-tools-invalid.md'),
          relativePath: '.claude/agents/allowed-tools-invalid.md',
        }),
      ],
    });
    const issues = agentFrontmatterValidRule.check(inventory, resolved);
    const allowedToolsIssues = issues.filter((i) => i.message.includes('allowedTools'));
    expect(allowedToolsIssues).toHaveLength(1);
    expect(allowedToolsIssues[0].severity).toBe('warning');
    expect(allowedToolsIssues[0].message).toContain('silently ignored');
    expect(allowedToolsIssues[0].message).toContain('tools');
    expect(allowedToolsIssues[0].message).toContain('disallowedTools');
    // Must NOT be the generic unknown-field message
    expect(allowedToolsIssues[0].message).not.toContain('unknown frontmatter field');
  });

  it('emits error for missing name field', () => {
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(FIXTURES, 'agent-validation', '.claude', 'agents', 'missing-name.md'),
          relativePath: '.claude/agents/missing-name.md',
        }),
      ],
    });
    const issues = agentFrontmatterValidRule.check(inventory, resolved);
    const nameIssues = issues.filter((i) => i.message.includes('missing required name'));
    expect(nameIssues).toHaveLength(1);
    expect(nameIssues[0].severity).toBe('error');
    expect(nameIssues[0].message).toContain('#6377');
    expect(nameIssues[0].message).toContain('#17154');
  });

  it('warns when tools is neither a string nor an array', () => {
    // Create a temp fixture with tools: 123
    // writeFileSync and rmSync imported at top level
    const tmpDir = join(FIXTURES, 'agent-validation', '.claude', 'agents');
    const tmpFile = join(tmpDir, 'bad-tools-type.md');
    writeFileSync(tmpFile, '---\nname: bad-tools\ntools: 123\ndescription: test\n---\nBody\n');
    try {
      const inventory = makeInventory({
        projectAgents: [
          makeFileInfo({
            path: tmpFile,
            relativePath: '.claude/agents/bad-tools-type.md',
          }),
        ],
      });
      const issues = agentFrontmatterValidRule.check(inventory, resolved);
      const toolsIssues = issues.filter((i) => i.message.includes('tools') && i.message.includes('not a string or array'));
      expect(toolsIssues).toHaveLength(1);
      expect(toolsIssues[0].suggestion).toContain('comma-separated string or array');
    } finally {
      rmSync(tmpFile);
    }
  });

  it('still warns for generic unknown fields like foobar', () => {
    const inventory = makeInventory({
      projectAgents: [
        makeFileInfo({
          path: join(FIXTURES, 'overconfigured', '.claude', 'agents', 'reviewer.md'),
          relativePath: '.claude/agents/reviewer.md',
        }),
      ],
    });
    const issues = agentFrontmatterValidRule.check(inventory, resolved);
    const unknownIssues = issues.filter((i) => i.message.includes('unknown frontmatter field'));
    expect(unknownIssues.length).toBeGreaterThan(0);
  });
});
