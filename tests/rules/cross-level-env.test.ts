import { describe, it, expect } from 'vitest';
import { envShadowsRule } from '../../src/rules/cross-level/env-shadows.js';
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

describe('cross-level/env-shadows rule', () => {
  const inventory = makeInventory();

  it('passes when no env shadows exist', () => {
    const resolved = makeResolved();
    const issues = envShadowsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('reports info for each shadowed env variable', () => {
    const resolved = makeResolved({
      environment: {
        effective: new Map(),
        shadows: [
          {
            name: 'NODE_ENV',
            value: 'production',
            origin: '.claude/settings.local.json',
            shadowedValues: [
              { value: 'development', origin: '.claude/settings.json' },
            ],
          },
        ],
      },
    });

    const issues = envShadowsRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('cross-level/env-shadows');
    expect(issues[0].severity).toBe('info');
    expect(issues[0].category).toBe('cross-level');
    expect(issues[0].message).toContain('NODE_ENV');
    // Short filenames in message, not full paths
    expect(issues[0].message).toContain('settings.local.json');
    expect(issues[0].message).toContain('shadows settings.json');
    expect(issues[0].message).not.toContain('.claude/settings.local.json');
  });

  it('includes evidence with values and origins', () => {
    const resolved = makeResolved({
      environment: {
        effective: new Map(),
        shadows: [
          {
            name: 'NODE_ENV',
            value: 'test',
            origin: '/project/.claude/settings.local.json',
            shadowedValues: [
              { value: 'development', origin: '/project/.claude/settings.json' },
            ],
          },
        ],
      },
    });

    const issues = envShadowsRule.check(inventory, resolved);
    expect(issues[0].evidence).toBeDefined();
    expect(issues[0].evidence).toHaveLength(2);
    // Effective value
    expect(issues[0].evidence![0].file).toBe('/project/.claude/settings.local.json');
    expect(issues[0].evidence![0].content).toBe('NODE_ENV=test');
    // Shadowed value
    expect(issues[0].evidence![1].file).toBe('/project/.claude/settings.json');
    expect(issues[0].evidence![1].content).toBe('NODE_ENV=development (shadowed)');
  });

  it('reports multiple shadows', () => {
    const resolved = makeResolved({
      environment: {
        effective: new Map(),
        shadows: [
          {
            name: 'NODE_ENV',
            value: 'production',
            origin: 'local',
            shadowedValues: [{ value: 'development', origin: 'project' }],
          },
          {
            name: 'LOG_LEVEL',
            value: 'trace',
            origin: 'local',
            shadowedValues: [{ value: 'debug', origin: 'project' }],
          },
        ],
      },
    });

    const issues = envShadowsRule.check(inventory, resolved);
    expect(issues).toHaveLength(2);
  });
});
