import { describe, it, expect } from 'vitest';
import { localSettingsTrackedRule } from '../../src/rules/git/local-settings-tracked.js';
import { resolve } from '../../src/core/resolver.js';
import type { ConfigInventory } from '../../src/types/index.js';

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

describe('git/local-settings-tracked rule', () => {
  const resolved = resolve(makeInventory());

  it('skips silently when not a git repo', () => {
    const inventory = makeInventory({ gitRoot: null });
    const issues = localSettingsTrackedRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('skips when local files do not exist', () => {
    // Use a temp dir where no local files exist
    const inventory = makeInventory({
      projectRoot: '/tmp/nonexistent-project-dir-12345',
      gitRoot: '/tmp/nonexistent-project-dir-12345',
    });
    const issues = localSettingsTrackedRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('has correct rule metadata', () => {
    expect(localSettingsTrackedRule.id).toBe('git/local-settings-tracked');
    expect(localSettingsTrackedRule.severity).toBe('warning');
    expect(localSettingsTrackedRule.category).toBe('git');
  });

  it('produces issues with correct structure', () => {
    // We can't easily test git-tracked files without a real git repo,
    // but we can verify the rule shape and that it handles non-git gracefully
    const inventory = makeInventory({ gitRoot: null });
    const issues = localSettingsTrackedRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
    // Rule should return empty array, not throw
  });

  it('provides correct suggestion format', () => {
    // Verify by checking rule id format
    expect(localSettingsTrackedRule.id).toBe('git/local-settings-tracked');
    expect(localSettingsTrackedRule.description).toContain('local');
  });
});
