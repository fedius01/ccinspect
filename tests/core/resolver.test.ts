import { describe, it, expect } from 'vitest';
import { resolve, type ParsedConfigLayers } from '../../src/core/resolver.js';
import type { ConfigInventory } from '../../src/types/index.js';
import type { ParsedSettings } from '../../src/parsers/settings-json.js';

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

function makeSettings(overrides: Partial<ParsedSettings> = {}): ParsedSettings {
  return {
    permissions: { allow: [], deny: [] },
    env: {},
    hooks: [],
    sandbox: {},
    plugins: {},
    raw: {},
    ...overrides,
  };
}

function makeLayers(overrides: Partial<ParsedConfigLayers> = {}): ParsedConfigLayers {
  return {
    userSettings: null,
    projectSettings: null,
    localSettings: null,
    managedSettings: null,
    projectMcp: null,
    managedMcp: null,
    ...overrides,
  };
}

describe('resolver', () => {
  describe('backward compatibility (no layers)', () => {
    it('returns default config when no layers provided', () => {
      const inventory = makeInventory();
      const resolved = resolve(inventory);

      expect(resolved.permissions.effectiveAllow).toHaveLength(0);
      expect(resolved.permissions.effectiveDeny).toHaveLength(0);
      expect(resolved.permissions.conflicts).toHaveLength(0);
      expect(resolved.environment.shadows).toHaveLength(0);
      expect(resolved.model.effectiveModel.value).toBe('claude-sonnet-4-20250514');
      expect(resolved.sandbox.enabled.value).toBe(false);
    });
  });

  describe('permission resolution', () => {
    it('collects allow and deny from multiple layers', () => {
      const inventory = makeInventory({
        projectSettings: { path: '.claude/settings.json', relativePath: '.claude/settings.json', exists: true, scope: 'project-shared', sizeBytes: 100, lineCount: 10, estimatedTokens: 50, gitTracked: true, lastModified: new Date() },
        userSettings: { path: '~/.claude/settings.json', relativePath: '~/.claude/settings.json', exists: true, scope: 'user', sizeBytes: 100, lineCount: 10, estimatedTokens: 50, gitTracked: false, lastModified: new Date() },
      });

      const layers = makeLayers({
        projectSettings: makeSettings({
          permissions: { allow: ['Read(src/**)'], deny: ['Bash(rm -rf *)'] },
        }),
        userSettings: makeSettings({
          permissions: { allow: ['Bash(npm run *)'], deny: [] },
        }),
      });

      const resolved = resolve(inventory, layers);
      expect(resolved.permissions.effectiveAllow).toHaveLength(2);
      expect(resolved.permissions.effectiveDeny).toHaveLength(1);
    });

    it('detects permission conflicts (same pattern in allow and deny)', () => {
      const inventory = makeInventory({
        projectSettings: { path: '.claude/settings.json', relativePath: '.claude/settings.json', exists: true, scope: 'project-shared', sizeBytes: 100, lineCount: 10, estimatedTokens: 50, gitTracked: true, lastModified: new Date() },
        localSettings: { path: '.claude/settings.local.json', relativePath: '.claude/settings.local.json', exists: true, scope: 'project-local', sizeBytes: 100, lineCount: 10, estimatedTokens: 50, gitTracked: false, lastModified: new Date() },
      });

      const layers = makeLayers({
        projectSettings: makeSettings({
          permissions: { allow: ['Bash(npm run *)'], deny: [] },
        }),
        localSettings: makeSettings({
          permissions: { allow: [], deny: ['Bash(npm run *)'] },
        }),
      });

      const resolved = resolve(inventory, layers);
      expect(resolved.permissions.conflicts).toHaveLength(1);
      expect(resolved.permissions.conflicts[0].pattern).toBe('Bash(npm run *)');
      // Local settings has higher precedence than project settings
      expect(resolved.permissions.conflicts[0].resolution).toBe('deny');
    });

    it('detects permission redundancies', () => {
      const inventory = makeInventory({
        projectSettings: { path: '.claude/settings.json', relativePath: '.claude/settings.json', exists: true, scope: 'project-shared', sizeBytes: 100, lineCount: 10, estimatedTokens: 50, gitTracked: true, lastModified: new Date() },
      });

      const layers = makeLayers({
        projectSettings: makeSettings({
          permissions: {
            allow: ['Bash(npm run *)', 'Bash(npm run test)'],
            deny: [],
          },
        }),
      });

      const resolved = resolve(inventory, layers);
      expect(resolved.permissions.redundancies.length).toBeGreaterThan(0);
    });
  });

  describe('environment resolution', () => {
    it('detects env variable shadows across layers', () => {
      const inventory = makeInventory({
        projectSettings: { path: '.claude/settings.json', relativePath: '.claude/settings.json', exists: true, scope: 'project-shared', sizeBytes: 100, lineCount: 10, estimatedTokens: 50, gitTracked: true, lastModified: new Date() },
        localSettings: { path: '.claude/settings.local.json', relativePath: '.claude/settings.local.json', exists: true, scope: 'project-local', sizeBytes: 100, lineCount: 10, estimatedTokens: 50, gitTracked: false, lastModified: new Date() },
      });

      const layers = makeLayers({
        localSettings: makeSettings({
          env: { NODE_ENV: 'production' },
        }),
        projectSettings: makeSettings({
          env: { NODE_ENV: 'development' },
        }),
      });

      const resolved = resolve(inventory, layers);
      expect(resolved.environment.shadows).toHaveLength(1);
      expect(resolved.environment.shadows[0].name).toBe('NODE_ENV');
      // Local has higher precedence
      expect(resolved.environment.shadows[0].value).toBe('production');
      expect(resolved.environment.shadows[0].shadowedValues).toHaveLength(1);
    });

    it('first occurrence (highest precedence) wins', () => {
      const inventory = makeInventory({
        localSettings: { path: 'local', relativePath: 'local', exists: true, scope: 'project-local', sizeBytes: 0, lineCount: 0, estimatedTokens: 0, gitTracked: false, lastModified: new Date() },
        projectSettings: { path: 'project', relativePath: 'project', exists: true, scope: 'project-shared', sizeBytes: 0, lineCount: 0, estimatedTokens: 0, gitTracked: false, lastModified: new Date() },
      });

      const layers = makeLayers({
        localSettings: makeSettings({ env: { API_KEY: 'local-key' } }),
        projectSettings: makeSettings({ env: { API_KEY: 'project-key' } }),
      });

      const resolved = resolve(inventory, layers);
      const effective = resolved.environment.effective.get('API_KEY');
      expect(effective).toBeDefined();
      expect(effective!.value).toBe('local-key');
    });
  });

  describe('MCP server resolution', () => {
    it('resolves MCP servers from project MCP config', () => {
      const inventory = makeInventory();
      const layers = makeLayers({
        projectMcp: {
          servers: [
            { name: 'postgres', command: 'npx', args: ['-y', 'server-pg'], env: {} },
          ],
          source: '.mcp.json',
        },
      });

      const resolved = resolve(inventory, layers);
      expect(resolved.mcpServers.effective).toHaveLength(1);
      expect(resolved.mcpServers.effective[0].name).toBe('postgres');
      expect(resolved.mcpServers.effective[0].enabled).toBe(true);
    });

    it('detects MCP conflicts between managed and project', () => {
      const inventory = makeInventory();
      const layers = makeLayers({
        managedMcp: {
          servers: [
            { name: 'postgres', command: 'npx', args: [], env: {}, disabled: true },
          ],
          source: 'managed-mcp.json',
        },
        projectMcp: {
          servers: [
            { name: 'postgres', command: 'npx', args: [], env: {} },
          ],
          source: '.mcp.json',
        },
      });

      const resolved = resolve(inventory, layers);
      expect(resolved.mcpServers.conflicts).toHaveLength(1);
      expect(resolved.mcpServers.conflicts[0].name).toBe('postgres');
      // Managed has higher precedence — disabled wins
      expect(resolved.mcpServers.conflicts[0].enabled).toBe(false);
    });
  });

  describe('plugin resolution', () => {
    it('detects plugin conflicts across layers', () => {
      const inventory = makeInventory({
        projectSettings: { path: 'project', relativePath: 'project', exists: true, scope: 'project-shared', sizeBytes: 0, lineCount: 0, estimatedTokens: 0, gitTracked: false, lastModified: new Date() },
        localSettings: { path: 'local', relativePath: 'local', exists: true, scope: 'project-local', sizeBytes: 0, lineCount: 0, estimatedTokens: 0, gitTracked: false, lastModified: new Date() },
      });

      const layers = makeLayers({
        localSettings: makeSettings({
          plugins: { enabledPlugins: { 'my-plugin@market': true } },
        }),
        projectSettings: makeSettings({
          plugins: { enabledPlugins: { 'my-plugin@market': false } },
        }),
      });

      const resolved = resolve(inventory, layers);
      expect(resolved.plugins.conflicts).toHaveLength(1);
      expect(resolved.plugins.conflicts[0].id).toBe('my-plugin@market');
      // Local has higher precedence
      expect(resolved.plugins.conflicts[0].enabled).toBe(true);
    });
  });

  describe('sandbox resolution', () => {
    it('defaults to disabled', () => {
      const inventory = makeInventory();
      const layers = makeLayers({});
      const resolved = resolve(inventory, layers);
      expect(resolved.sandbox.enabled.value).toBe(false);
      expect(resolved.sandbox.enabled.origin).toBe('default');
    });

    it('uses first layer that sets sandbox', () => {
      const inventory = makeInventory({
        projectSettings: { path: 'project', relativePath: 'project', exists: true, scope: 'project-shared', sizeBytes: 0, lineCount: 0, estimatedTokens: 0, gitTracked: false, lastModified: new Date() },
      });

      const layers = makeLayers({
        projectSettings: makeSettings({
          sandbox: { enabled: true },
        }),
      });

      const resolved = resolve(inventory, layers);
      expect(resolved.sandbox.enabled.value).toBe(true);
    });
  });

  describe('model resolution', () => {
    it('defaults to claude-sonnet-4-20250514', () => {
      const inventory = makeInventory();
      const layers = makeLayers({});
      const resolved = resolve(inventory, layers);
      expect(resolved.model.effectiveModel.value).toBe('claude-sonnet-4-20250514');
      expect(resolved.model.effectiveModel.origin).toBe('default');
    });

    it('uses model from settings layer', () => {
      const inventory = makeInventory({
        projectSettings: { path: 'project', relativePath: 'project', exists: true, scope: 'project-shared', sizeBytes: 0, lineCount: 0, estimatedTokens: 0, gitTracked: false, lastModified: new Date() },
      });

      const layers = makeLayers({
        projectSettings: makeSettings({
          model: 'claude-opus-4-20250514',
        }),
      });

      const resolved = resolve(inventory, layers);
      expect(resolved.model.effectiveModel.value).toBe('claude-opus-4-20250514');
    });
  });
});
