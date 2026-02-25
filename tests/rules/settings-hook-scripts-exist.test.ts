import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { hookScriptsExistRule } from '../../src/rules/settings/hook-scripts-exist.js';
import { resolve } from '../../src/core/resolver.js';
import type { ConfigInventory, HookInfo } from '../../src/types/index.js';

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

describe('settings/hook-scripts-exist rule', () => {
  const resolved = resolve(makeInventory());

  it('passes when no hooks exist', () => {
    const inventory = makeInventory({ hooks: [] });
    const issues = hookScriptsExistRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('errors when hook references missing script', () => {
    const hook: HookInfo = {
      event: 'PreToolUse',
      matcher: 'Bash',
      type: 'command',
      command: './scripts/lint-check.sh',
      source: 'settings.json',
    };
    const inventory = makeInventory({
      projectRoot: join(FIXTURES, 'overconfigured'),
      hooks: [hook],
    });
    const issues = hookScriptsExistRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('settings/hook-scripts-exist');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].category).toBe('settings');
  });

  it('passes when hook references existing script', () => {
    const hook: HookInfo = {
      event: 'PreToolUse',
      matcher: 'Bash',
      type: 'command',
      // Point to a file that actually exists
      command: './CLAUDE.md',
      source: 'settings.json',
    };
    const inventory = makeInventory({
      projectRoot: join(FIXTURES, 'full-project'),
      hooks: [hook],
    });
    const issues = hookScriptsExistRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('skips prompt-type hooks', () => {
    const hook: HookInfo = {
      event: 'PreToolUse',
      matcher: 'Bash',
      type: 'prompt',
      command: 'nonexistent-script.sh',
      source: 'settings.json',
    };
    const inventory = makeInventory({ hooks: [hook] });
    const issues = hookScriptsExistRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('skips hooks without command', () => {
    const hook: HookInfo = {
      event: 'PreToolUse',
      matcher: 'Bash',
      type: 'command',
      source: 'settings.json',
    };
    const inventory = makeInventory({ hooks: [hook] });
    const issues = hookScriptsExistRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });
});
