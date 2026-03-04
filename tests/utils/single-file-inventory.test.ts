import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { buildSingleFileInventory } from '../../src/utils/single-file-inventory.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const FULL_PROJECT = join(FIXTURES, 'full-project');
const MINIMAL_PROJECT = join(FIXTURES, 'minimal-project');

describe('buildSingleFileInventory', () => {
  describe('CLAUDE.md files', () => {
    it('builds inventory for project CLAUDE.md', async () => {
      const ctx = await buildSingleFileInventory(join(FULL_PROJECT, 'CLAUDE.md'));

      expect(ctx.fileType).toBe('claude-md');
      expect(ctx.scope).toBe('project-shared');
      expect(ctx.inventory.projectClaudeMd).not.toBeNull();
      expect(ctx.inventory.projectClaudeMd!.exists).toBe(true);
      expect(ctx.inventory.projectClaudeMd!.lineCount).toBeGreaterThan(0);
      expect(ctx.inventory.projectClaudeMd!.estimatedTokens).toBeGreaterThan(0);
    });

    it('builds inventory for CLAUDE.local.md', async () => {
      const ctx = await buildSingleFileInventory(join(FULL_PROJECT, 'CLAUDE.local.md'));

      expect(ctx.fileType).toBe('claude-md');
      expect(ctx.scope).toBe('project-local');
      expect(ctx.inventory.localClaudeMd).not.toBeNull();
      expect(ctx.inventory.projectClaudeMd).toBeNull();
    });
  });

  describe('settings files', () => {
    it('builds inventory for project settings.json', async () => {
      const ctx = await buildSingleFileInventory(join(FULL_PROJECT, '.claude', 'settings.json'));

      expect(ctx.fileType).toBe('settings-json');
      expect(ctx.scope).toBe('project-shared');
      expect(ctx.inventory.projectSettings).not.toBeNull();
      expect(ctx.inventory.projectSettings!.exists).toBe(true);
      expect(ctx.inventory.localSettings).toBeNull();
    });

    it('builds inventory for settings.local.json', async () => {
      const ctx = await buildSingleFileInventory(join(FULL_PROJECT, '.claude', 'settings.local.json'));

      expect(ctx.fileType).toBe('settings-json');
      expect(ctx.scope).toBe('project-local');
      expect(ctx.inventory.localSettings).not.toBeNull();
      expect(ctx.inventory.projectSettings).toBeNull();
    });
  });

  describe('MCP files', () => {
    it('builds inventory for .mcp.json', async () => {
      const ctx = await buildSingleFileInventory(join(FULL_PROJECT, '.mcp.json'));

      expect(ctx.fileType).toBe('mcp-json');
      expect(ctx.scope).toBe('project-shared');
      expect(ctx.inventory.projectMcp).not.toBeNull();
    });
  });

  describe('rule files', () => {
    it('builds inventory for a rule file', async () => {
      const ctx = await buildSingleFileInventory(join(FULL_PROJECT, '.claude', 'rules', 'testing.md'));

      expect(ctx.fileType).toBe('rule-md');
      expect(ctx.scope).toBe('project-shared');
      expect(ctx.inventory.rules).toHaveLength(1);
      expect(ctx.inventory.rules[0].exists).toBe(true);
      expect(ctx.inventory.rules[0].exists).toBe(true);
      expect(ctx.inventory.rules[0].estimatedTokens).toBeGreaterThan(0);
    });
  });

  describe('agent files', () => {
    it('builds inventory for a project agent', async () => {
      const ctx = await buildSingleFileInventory(join(FULL_PROJECT, '.claude', 'agents', 'reviewer.md'));

      expect(ctx.fileType).toBe('agent-md');
      expect(ctx.scope).toBe('project-shared');
      expect(ctx.inventory.projectAgents).toHaveLength(1);
      expect(ctx.inventory.userAgents).toHaveLength(0);
    });
  });

  describe('skill files', () => {
    it('builds inventory for a skill file', async () => {
      const ctx = await buildSingleFileInventory(join(FULL_PROJECT, '.claude', 'skills', 'code-review', 'SKILL.md'));

      expect(ctx.fileType).toBe('skill-md');
      expect(ctx.scope).toBe('project-shared');
      expect(ctx.inventory.projectSkills).toHaveLength(1);
    });
  });

  describe('command files', () => {
    it('builds inventory for a project command', async () => {
      const ctx = await buildSingleFileInventory(join(FULL_PROJECT, '.claude', 'commands', 'deploy.md'));

      expect(ctx.fileType).toBe('command-md');
      expect(ctx.scope).toBe('project-shared');
      expect(ctx.inventory.projectCommands).toHaveLength(1);
      expect(ctx.inventory.userCommands).toHaveLength(0);
    });
  });

  describe('inventory metadata', () => {
    it('sets totalFiles to 1', async () => {
      const ctx = await buildSingleFileInventory(join(MINIMAL_PROJECT, 'CLAUDE.md'));

      expect(ctx.inventory.totalFiles).toBe(1);
    });

    it('sets totalStartupTokens to file tokens', async () => {
      const ctx = await buildSingleFileInventory(join(MINIMAL_PROJECT, 'CLAUDE.md'));

      expect(ctx.inventory.totalStartupTokens).toBeGreaterThan(0);
      expect(ctx.inventory.totalStartupTokens).toBe(ctx.inventory.projectClaudeMd!.estimatedTokens);
    });

    it('returns empty resolved config', async () => {
      const ctx = await buildSingleFileInventory(join(MINIMAL_PROJECT, 'CLAUDE.md'));

      expect(ctx.resolved.permissions.effectiveAllow).toEqual([]);
      expect(ctx.resolved.permissions.effectiveDeny).toEqual([]);
      expect(ctx.resolved.environment.effective.size).toBe(0);
      expect(ctx.resolved.mcpServers.effective).toEqual([]);
      expect(ctx.resolved.model.effectiveModel.value).toBe('unknown');
      expect(ctx.resolved.sandbox.enabled.value).toBe(false);
      expect(ctx.resolved.plugins.effective).toEqual([]);
    });

    it('other slots remain null/empty', async () => {
      const ctx = await buildSingleFileInventory(join(FULL_PROJECT, '.claude', 'settings.json'));

      expect(ctx.inventory.projectClaudeMd).toBeNull();
      expect(ctx.inventory.globalClaudeMd).toBeNull();
      expect(ctx.inventory.rules).toEqual([]);
      expect(ctx.inventory.projectAgents).toEqual([]);
      expect(ctx.inventory.projectMcp).toBeNull();
    });
  });

  describe('error handling', () => {
    it('throws for nonexistent file', async () => {
      await expect(
        buildSingleFileInventory(join(FIXTURES, 'nonexistent', 'CLAUDE.md')),
      ).rejects.toThrow('File not found');
    });

    it('throws for unrecognized file type', async () => {
      // package.json in fixture directory
      await expect(
        buildSingleFileInventory(join(import.meta.dirname, '..', '..', 'package.json')),
      ).rejects.toThrow('Unrecognized config file type');
    });

    it('includes supported types in error message', async () => {
      await expect(
        buildSingleFileInventory(join(import.meta.dirname, '..', '..', 'package.json')),
      ).rejects.toThrow('claude-md');
    });
  });
});
