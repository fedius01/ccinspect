import { describe, it, expect } from 'vitest';
import { pluginReferenceValidRule } from '../../src/rules/plugins/reference-valid.js';
import { resolve } from '../../src/core/resolver.js';
import type { ConfigInventory, PluginInfo, ResolvedConfig } from '../../src/types/index.js';

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

function makeResolved(plugins: PluginInfo[] = []): ResolvedConfig {
  const base = resolve(makeInventory());
  return {
    ...base,
    plugins: {
      effective: plugins,
      conflicts: [],
    },
  };
}

describe('plugins/reference-valid rule', () => {
  it('passes for valid plugin ID format', () => {
    const inventory = makeInventory();
    const resolved = makeResolved([
      { id: 'my-plugin@anthropic', enabled: true, source: '.claude/settings.json' },
      { id: 'linter@marketplace', enabled: true, source: '.claude/settings.json' },
    ]);
    const issues = pluginReferenceValidRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('warns for plugin ID without @ separator', () => {
    const inventory = makeInventory();
    const resolved = makeResolved([
      { id: 'my-plugin', enabled: true, source: '.claude/settings.json' },
    ]);
    const issues = pluginReferenceValidRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('plugins/reference-valid');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].category).toBe('plugins');
    expect(issues[0].message).toContain('my-plugin');
    expect(issues[0].message).toContain('invalid ID format');
  });

  it('warns for plugin ID with spaces', () => {
    const inventory = makeInventory();
    const resolved = makeResolved([
      { id: 'my plugin@marketplace', enabled: true, source: '.claude/settings.json' },
    ]);
    const issues = pluginReferenceValidRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
  });

  it('warns for empty plugin ID', () => {
    const inventory = makeInventory();
    const resolved = makeResolved([
      { id: '', enabled: true, source: '.claude/settings.json' },
    ]);
    const issues = pluginReferenceValidRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
  });

  it('passes when no plugins exist', () => {
    const inventory = makeInventory();
    const resolved = makeResolved([]);
    const issues = pluginReferenceValidRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('checks inventory plugins too', () => {
    const inventory = makeInventory({
      plugins: [
        { id: 'bad-format', enabled: true, source: '.claude/settings.json' },
      ],
    });
    const resolved = makeResolved([]);
    const issues = pluginReferenceValidRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('bad-format');
  });

  it('does not duplicate reports for same plugin in inventory and resolved', () => {
    const plugin: PluginInfo = { id: 'bad-format', enabled: true, source: '.claude/settings.json' };
    const inventory = makeInventory({
      plugins: [plugin],
    });
    const resolved = makeResolved([plugin]);
    const issues = pluginReferenceValidRule.check(inventory, resolved);
    // Should only report once
    expect(issues).toHaveLength(1);
  });

  it('handles multiple invalid plugins', () => {
    const inventory = makeInventory();
    const resolved = makeResolved([
      { id: 'no-at-sign', enabled: true, source: '.claude/settings.json' },
      { id: 'valid-one@marketplace', enabled: true, source: '.claude/settings.json' },
      { id: 'also invalid', enabled: true, source: '.claude/settings.json' },
    ]);
    const issues = pluginReferenceValidRule.check(inventory, resolved);
    expect(issues).toHaveLength(2);
  });
});
