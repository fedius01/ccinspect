import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
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

    it('has no project skills in minimal project', () => {
      const inventory = scan({ projectDir });
      expect(inventory.projectSkills).toHaveLength(0);
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

    it('discovers skills', () => {
      const inventory = scan({ projectDir });
      expect(inventory.projectSkills.length).toBeGreaterThanOrEqual(1);
      const skillPaths = inventory.projectSkills.map((s) => s.relativePath);
      expect(skillPaths.some((p) => p.includes('SKILL.md'))).toBe(true);
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

  describe('nested-skills project', () => {
    const projectDir = join(FIXTURES, 'nested-skills');

    it('discovers skills nested more than one level deep', () => {
      const inventory = scan({ projectDir });
      expect(inventory.projectSkills.length).toBe(2);
      const skillPaths = inventory.projectSkills.map((s) => s.relativePath);
      expect(skillPaths.some((p) => p.includes('flat-skill'))).toBe(true);
      expect(skillPaths.some((p) => p.includes('nested-skill'))).toBe(true);
    });
  });

  describe('miscased-files project', () => {
    const projectDir = join(FIXTURES, 'miscased-files');

    it('discovers miscased Claude.md as projectClaudeMd', () => {
      const inventory = scan({ projectDir });
      expect(inventory.projectClaudeMd).not.toBeNull();
      expect(inventory.projectClaudeMd?.exists).toBe(true);
      // The path should reflect the actual on-disk filename
      expect(inventory.projectClaudeMd?.path).toContain('Claude.md');
    });

    it('discovers miscased skill.md in projectSkills', () => {
      const inventory = scan({ projectDir });
      expect(inventory.projectSkills.length).toBeGreaterThanOrEqual(1);
      const skillPaths = inventory.projectSkills.map(s => s.path);
      expect(skillPaths.some(p => p.toLowerCase().includes('skill.md'))).toBe(true);
    });

    it('discovers correctly-cased settings.json normally', () => {
      const inventory = scan({ projectDir });
      expect(inventory.projectSettings).not.toBeNull();
      expect(inventory.projectSettings?.exists).toBe(true);
    });
  });

  describe('symlinked skills', () => {
    const tmpDir = join(tmpdir(), `cci-symlink-test-${process.pid}`);

    beforeEach(() => {
      // Create the real skill file outside .claude/skills/
      mkdirSync(join(tmpDir, '.agents', 'skills', 'test-skill'), { recursive: true });
      writeFileSync(
        join(tmpDir, '.agents', 'skills', 'test-skill', 'SKILL.md'),
        [
          '---',
          'name: test-skill',
          'description: A test skill installed via skills.sh',
          '---',
          '# Test Skill',
          'This is a test.',
        ].join('\n'),
      );

      // Symlink into .claude/skills/ (relative, matching skills.sh behavior)
      mkdirSync(join(tmpDir, '.claude', 'skills'), { recursive: true });
      symlinkSync(
        join('..', '..', '.agents', 'skills', 'test-skill'),
        join(tmpDir, '.claude', 'skills', 'test-skill'),
      );

      // git init so scanner can resolve git root
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    });

    afterEach(() => {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('discovers skills installed via symlink', () => {
      const inventory = scan({ projectDir: tmpDir, skipGlobalDirs: true });

      expect(inventory.projectSkills).toHaveLength(1);
      expect(inventory.projectSkills[0].relativePath).toContain(join('test-skill', 'SKILL.md'));
      expect(inventory.projectSkills[0].exists).toBe(true);
      expect(inventory.projectSkills[0].lineCount).toBeGreaterThan(0);
      expect(inventory.projectSkills[0].sizeBytes).toBeGreaterThan(0);
    });

    it('preserves symlink path in FileInfo (not resolved target)', () => {
      const inventory = scan({ projectDir: tmpDir, skipGlobalDirs: true });
      const skill = inventory.projectSkills[0];

      // Path should go through .claude/skills/, not .agents/skills/
      expect(skill.path).toContain(join('.claude', 'skills', 'test-skill'));
      expect(skill.path).not.toContain('.agents');
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
      expect(inventory.projectSkills).toHaveLength(0);
    });
  });
});
