import { describe, it, expect } from 'vitest';
import { pluginConflictsRule } from '../../src/rules/cross-level/plugin-conflicts.js';
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

describe('cross-level/plugin-conflicts rule', () => {
  const inventory = makeInventory();

  it('passes when no plugin conflicts exist', () => {
    const resolved = makeResolved();
    const issues = pluginConflictsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('warns for plugin conflicts', () => {
    const resolved = makeResolved({
      plugins: {
        effective: [],
        conflicts: [
          {
            id: 'auto-format@marketplace',
            enabled: true,
            source: '.claude/settings.local.json',
            conflicts: ['.claude/settings.json'],
          },
        ],
      },
    });

    const issues = pluginConflictsRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('cross-level/plugin-conflicts');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].category).toBe('cross-level');
    expect(issues[0].message).toContain('auto-format@marketplace');
  });

  it('reports multiple plugin conflicts', () => {
    const resolved = makeResolved({
      plugins: {
        effective: [],
        conflicts: [
          {
            id: 'plugin-a',
            enabled: true,
            source: 'local',
            conflicts: ['project'],
          },
          {
            id: 'plugin-b',
            enabled: false,
            source: 'local',
            conflicts: ['project'],
          },
        ],
      },
    });

    const issues = pluginConflictsRule.check(inventory, resolved);
    expect(issues).toHaveLength(2);
  });
});
