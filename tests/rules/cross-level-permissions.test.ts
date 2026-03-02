import { describe, it, expect } from 'vitest';
import { permissionConflictsRule } from '../../src/rules/cross-level/permission-conflicts.js';
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

describe('cross-level/permission-conflicts rule', () => {
  const inventory = makeInventory();

  it('passes when no permission conflicts exist', () => {
    const resolved = makeResolved();
    const issues = permissionConflictsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('warns for each permission conflict', () => {
    const resolved = makeResolved({
      permissions: {
        effectiveAllow: [],
        effectiveDeny: [],
        effectiveAsk: [],
        conflicts: [
          {
            pattern: 'Bash(npm run *)',
            rules: [
              { pattern: 'Bash(npm run *)', action: 'allow', origin: '.claude/settings.json' },
              { pattern: 'Bash(npm run *)', action: 'deny', origin: '.claude/settings.local.json' },
            ],
            resolution: 'deny',
            explanation: 'Denied at local settings (higher precedence).',
          },
        ],
        redundancies: [],
      },
    });

    const issues = permissionConflictsRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('cross-level/permission-conflicts');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].category).toBe('cross-level');
    expect(issues[0].message).toContain('Bash(npm run *)');
  });

  it('reports multiple conflicts', () => {
    const resolved = makeResolved({
      permissions: {
        effectiveAllow: [],
        effectiveDeny: [],
        effectiveAsk: [],
        conflicts: [
          {
            pattern: 'Bash(npm run *)',
            rules: [
              { pattern: 'Bash(npm run *)', action: 'allow', origin: 'a' },
              { pattern: 'Bash(npm run *)', action: 'deny', origin: 'b' },
            ],
            resolution: 'deny',
            explanation: '',
          },
          {
            pattern: 'Read(.env)',
            rules: [
              { pattern: 'Read(.env)', action: 'allow', origin: 'a' },
              { pattern: 'Read(.env)', action: 'deny', origin: 'b' },
            ],
            resolution: 'deny',
            explanation: '',
          },
        ],
        redundancies: [],
      },
    });

    const issues = permissionConflictsRule.check(inventory, resolved);
    expect(issues).toHaveLength(2);
  });

  it('includes evidence showing action and pattern from each origin', () => {
    const resolved = makeResolved({
      permissions: {
        effectiveAllow: [],
        effectiveDeny: [],
        effectiveAsk: [],
        conflicts: [
          {
            pattern: 'Bash(npm run *)',
            rules: [
              { pattern: 'Bash(npm run *)', action: 'allow', origin: '.claude/settings.json' },
              { pattern: 'Bash(npm run *)', action: 'deny', origin: '.claude/settings.local.json' },
            ],
            resolution: 'deny',
            explanation: 'Denied at local settings.',
          },
        ],
        redundancies: [],
      },
    });

    const issues = permissionConflictsRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);

    const issue = issues[0];
    expect(issue.evidence).toBeDefined();
    expect(issue.evidence).toHaveLength(2);

    // Each evidence entry shows origin file and action:pattern
    expect(issue.evidence![0].file).toBe('.claude/settings.json');
    expect(issue.evidence![0].content).toBe('allow: Bash(npm run *)');

    expect(issue.evidence![1].file).toBe('.claude/settings.local.json');
    expect(issue.evidence![1].content).toBe('deny: Bash(npm run *)');
  });

  it('evidence count matches conflict rules count', () => {
    const resolved = makeResolved({
      permissions: {
        effectiveAllow: [],
        effectiveDeny: [],
        effectiveAsk: [],
        conflicts: [
          {
            pattern: 'Edit(*)',
            rules: [
              { pattern: 'Edit(*)', action: 'allow', origin: 'user-settings' },
              { pattern: 'Edit(*)', action: 'ask', origin: 'project-settings' },
              { pattern: 'Edit(*)', action: 'deny', origin: 'managed-settings' },
            ],
            resolution: 'deny',
            explanation: 'Managed policy overrides.',
          },
        ],
        redundancies: [],
      },
    });

    const issues = permissionConflictsRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].evidence).toHaveLength(3);
  });
});
