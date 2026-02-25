import { describe, it, expect } from 'vitest';
import { startupLoadRule } from '../../src/rules/budget/startup-load.js';
import { resolve } from '../../src/core/resolver.js';
import type { ConfigInventory } from '../../src/types/index.js';

function makeInventory(totalStartupTokens: number): ConfigInventory {
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
    totalStartupTokens,
    totalOnDemandTokens: 0,
  };
}

describe('budget/startup-load rule', () => {
  it('passes for low token count', () => {
    const inventory = makeInventory(1000);
    const resolved = resolve(inventory);
    const issues = startupLoadRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('warns between 5000 and 10000 tokens (including overhead)', () => {
    const inventory = makeInventory(5000); // +500 overhead = 5500
    const resolved = resolve(inventory);
    const issues = startupLoadRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].ruleId).toBe('budget/startup-load');
  });

  it('errors above 10000 tokens (including overhead)', () => {
    const inventory = makeInventory(10000); // +500 overhead = 10500
    const resolved = resolve(inventory);
    const issues = startupLoadRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
  });
});
