import { describe, it, expect } from 'vitest';
import { mcpConflictsRule } from '../../src/rules/cross-level/mcp-conflicts.js';
import type { ConfigInventory, ResolvedConfig } from '../../src/types/index.js';

function makeInventory(): ConfigInventory {
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
  };
}

function makeResolved(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    permissions: {
      effectiveAllow: [],
      effectiveDeny: [],
      effectiveAsk: [],
      conflicts: [],
      redundancies: [],
    },
    environment: { effective: new Map(), shadows: [] },
    mcpServers: { effective: [], conflicts: [] },
    model: {
      effectiveModel: { value: 'claude-sonnet-4-20250514', origin: 'default' },
      subagentModel: null,
      haikuModel: null,
      opusModel: null,
    },
    sandbox: {
      enabled: { value: false, origin: 'default' },
      autoAllowBashIfSandboxed: null,
      excludedCommands: null,
      networkConfig: {},
    },
    plugins: { effective: [], conflicts: [] },
    ...overrides,
  };
}

describe('cross-level/mcp-conflicts rule', () => {
  const inventory = makeInventory();

  it('passes when no MCP conflicts exist', () => {
    const resolved = makeResolved();
    const issues = mcpConflictsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('warns for MCP server conflicts', () => {
    const resolved = makeResolved({
      mcpServers: {
        effective: [],
        conflicts: [
          {
            name: 'postgres',
            enabled: false,
            origin: 'managed-mcp.json',
            config: {},
            conflicts: [{ enabled: true, origin: '.mcp.json' }],
          },
        ],
      },
    });

    const issues = mcpConflictsRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('cross-level/mcp-conflicts');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].category).toBe('cross-level');
    expect(issues[0].message).toContain('postgres');
  });
});
