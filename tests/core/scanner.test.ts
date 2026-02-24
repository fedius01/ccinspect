import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { scan } from '../../src/core/scanner.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

describe('Scanner', () => {
  describe('minimal-project', () => {
    const projectDir = join(FIXTURES, 'minimal-project');

    it('discovers project CLAUDE.md', () => {
      const inventory = scan({ projectDir });
      expect(inventory.projectClaudeMd).not.toBeNull();
      expect(inventory.projectClaudeMd?.exists).toBe(true);
      expect(inventory.projectClaudeMd?.scope).toBe('project-shared');
    });

    it('reports correct project root', () => {
      const inventory = scan({ projectDir });
      expect(inventory.projectRoot).toBe(projectDir);
    });

    it('counts existing files', () => {
      const inventory = scan({ projectDir });
      expect(inventory.totalFiles).toBeGreaterThanOrEqual(1);
    });

    it('estimates tokens for CLAUDE.md', () => {
      const inventory = scan({ projectDir });
      expect(inventory.projectClaudeMd?.estimatedTokens).toBeGreaterThan(0);
    });

    it('counts lines for CLAUDE.md', () => {
      const inventory = scan({ projectDir });
      expect(inventory.projectClaudeMd?.lineCount).toBeGreaterThan(0);
    });

    it('has no rules in minimal project', () => {
      const inventory = scan({ projectDir });
      expect(inventory.rules).toHaveLength(0);
    });

    it('has no project agents in minimal project', () => {
      const inventory = scan({ projectDir });
      expect(inventory.projectAgents).toHaveLength(0);
    });
  });

  describe('full-project', () => {
    const projectDir = join(FIXTURES, 'full-project');

    it('discovers all settings files', () => {
      const inventory = scan({ projectDir });
      expect(inventory.projectSettings?.exists).toBe(true);
      expect(inventory.localSettings?.exists).toBe(true);
    });

    it('discovers CLAUDE.md and CLAUDE.local.md', () => {
      const inventory = scan({ projectDir });
      expect(inventory.projectClaudeMd?.exists).toBe(true);
      expect(inventory.localClaudeMd?.exists).toBe(true);
    });

    it('discovers rules', () => {
      const inventory = scan({ projectDir });
      expect(inventory.rules.length).toBeGreaterThanOrEqual(2);
      const ruleNames = inventory.rules.map((r) => r.relativePath);
      expect(ruleNames.some((n) => n.includes('typescript'))).toBe(true);
      expect(ruleNames.some((n) => n.includes('testing'))).toBe(true);
    });

    it('discovers agents', () => {
      const inventory = scan({ projectDir });
      expect(inventory.projectAgents.length).toBeGreaterThanOrEqual(1);
    });

    it('discovers commands', () => {
      const inventory = scan({ projectDir });
      expect(inventory.projectCommands.length).toBeGreaterThanOrEqual(1);
    });

    it('discovers MCP config', () => {
      const inventory = scan({ projectDir });
      expect(inventory.projectMcp?.exists).toBe(true);
    });

    it('calculates startup tokens', () => {
      const inventory = scan({ projectDir });
      expect(inventory.totalStartupTokens).toBeGreaterThan(0);
    });

    it('calculates on-demand tokens', () => {
      const inventory = scan({ projectDir });
      expect(inventory.totalOnDemandTokens).toBeGreaterThan(0);
    });
  });

  describe('conflicting project', () => {
    const projectDir = join(FIXTURES, 'conflicting');

    it('discovers oversize CLAUDE.md', () => {
      const inventory = scan({ projectDir });
      expect(inventory.projectClaudeMd?.exists).toBe(true);
      expect(inventory.projectClaudeMd!.lineCount).toBeGreaterThan(150);
    });

    it('discovers settings without sandbox', () => {
      const inventory = scan({ projectDir });
      expect(inventory.projectSettings?.exists).toBe(true);
    });
  });

  describe('non-existent project', () => {
    it('handles missing project dir gracefully', () => {
      const projectDir = join(FIXTURES, 'does-not-exist');
      const inventory = scan({ projectDir });
      expect(inventory.projectRoot).toBe(projectDir);
      // Project-level files should not exist
      expect(inventory.projectClaudeMd?.exists).toBe(false);
      expect(inventory.projectSettings?.exists).toBe(false);
      expect(inventory.localSettings?.exists).toBe(false);
      expect(inventory.rules).toHaveLength(0);
      expect(inventory.projectAgents).toHaveLength(0);
    });
  });
});
