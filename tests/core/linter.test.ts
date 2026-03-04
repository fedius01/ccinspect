import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { scan } from '../../src/core/scanner.js';
import { resolve } from '../../src/core/resolver.js';
import { Linter } from '../../src/core/linter.js';
import { getAllRules } from '../../src/rules/index.js';
import { buildSingleFileInventory } from '../../src/utils/single-file-inventory.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

function lintProject(projectDir: string) {
  const inventory = scan({ projectDir });
  const resolved = resolve(inventory);
  const linter = new Linter();
  linter.registerRules(getAllRules());
  return linter.run(inventory, resolved);
}

describe('Linter', () => {
  describe('minimal-project (healthy)', () => {
    it('produces no errors for a well-configured project', () => {
      const result = lintProject(join(FIXTURES, 'minimal-project'));
      expect(result.stats.errors).toBe(0);
    });

    it('runs all registered rules', () => {
      const result = lintProject(join(FIXTURES, 'minimal-project'));
      expect(result.stats.rulesRun).toBe(getAllRules().length);
    });
  });

  describe('full-project (well-configured)', () => {
    it('produces no memory errors', () => {
      const result = lintProject(join(FIXTURES, 'full-project'));
      const memoryErrors = result.issues.filter(
        (i) => i.category === 'memory' && i.severity === 'error',
      );
      expect(memoryErrors).toHaveLength(0);
    });

    it('does not flag deny-env-files (env deny rules present)', () => {
      const result = lintProject(join(FIXTURES, 'full-project'));
      const envIssues = result.issues.filter((i) => i.ruleId === 'settings/deny-env-files');
      expect(envIssues).toHaveLength(0);
    });

    it('does not flag sandbox (sandbox enabled)', () => {
      const result = lintProject(join(FIXTURES, 'full-project'));
      const sandboxIssues = result.issues.filter(
        (i) => i.ruleId === 'settings/sandbox-recommended',
      );
      expect(sandboxIssues).toHaveLength(0);
    });
  });

  describe('conflicting project', () => {
    it('flags oversize CLAUDE.md', () => {
      const result = lintProject(join(FIXTURES, 'conflicting'));
      const lineIssues = result.issues.filter((i) => i.ruleId === 'memory/line-count');
      expect(lineIssues.length).toBeGreaterThanOrEqual(1);
      expect(lineIssues[0].severity).toBe('warning');
    });

    it('flags missing sandbox', () => {
      const result = lintProject(join(FIXTURES, 'conflicting'));
      const sandboxIssues = result.issues.filter(
        (i) => i.ruleId === 'settings/sandbox-recommended',
      );
      expect(sandboxIssues).toHaveLength(1);
    });

    it('flags missing env deny rules', () => {
      const result = lintProject(join(FIXTURES, 'conflicting'));
      const envIssues = result.issues.filter((i) => i.ruleId === 'settings/deny-env-files');
      expect(envIssues).toHaveLength(1);
    });

    it('returns correct stats', () => {
      const result = lintProject(join(FIXTURES, 'conflicting'));
      expect(result.stats.rulesRun).toBe(getAllRules().length);
      expect(result.stats.warnings).toBeGreaterThanOrEqual(2);
      expect(result.stats.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('rule disable', () => {
    it('skips disabled rules', () => {
      const inventory = scan({ projectDir: join(FIXTURES, 'conflicting') });
      const resolved = resolve(inventory);
      const linter = new Linter();
      linter.registerRules(getAllRules());
      const result = linter.run(inventory, resolved, {
        rules: { 'settings/sandbox-recommended': false },
      });
      const sandboxIssues = result.issues.filter(
        (i) => i.ruleId === 'settings/sandbox-recommended',
      );
      expect(sandboxIssues).toHaveLength(0);
      expect(result.stats.rulesRun).toBe(getAllRules().length - 1);
    });
  });

  describe('single-file category filtering', () => {
    it('runs only memory and naming rules for claude-md fileType', async () => {
      const claudeMdPath = join(FIXTURES, 'full-project', 'CLAUDE.md');
      const ctx = await buildSingleFileInventory(claudeMdPath);
      const linter = new Linter();
      linter.registerRules(getAllRules());
      const result = linter.run(ctx.inventory, ctx.resolved, undefined, 'claude-md');

      // Every issue should be in memory or naming category
      for (const issue of result.issues) {
        expect(['memory', 'naming']).toContain(issue.category);
      }

      // rulesRun should be 9 memory + 1 naming = 10
      const allRules = getAllRules();
      const expectedCount = allRules.filter(
        (r) => r.category === 'memory' || r.category === 'naming',
      ).length;
      expect(result.stats.rulesRun).toBe(expectedCount);
    });

    it('produces zero settings issues when linting CLAUDE.md', async () => {
      const claudeMdPath = join(FIXTURES, 'full-project', 'CLAUDE.md');
      const ctx = await buildSingleFileInventory(claudeMdPath);
      const linter = new Linter();
      linter.registerRules(getAllRules());
      const result = linter.run(ctx.inventory, ctx.resolved, undefined, 'claude-md');

      const settingsIssues = result.issues.filter((i) => i.category === 'settings');
      expect(settingsIssues).toHaveLength(0);
    });

    it('the 3 previously-leaking rules produce zero issues for claude-md', async () => {
      const claudeMdPath = join(FIXTURES, 'full-project', 'CLAUDE.md');
      const ctx = await buildSingleFileInventory(claudeMdPath);
      const linter = new Linter();
      linter.registerRules(getAllRules());
      const result = linter.run(ctx.inventory, ctx.resolved, undefined, 'claude-md');

      const leakingRuleIds = [
        'settings/sandbox-recommended',
        'settings/deny-env-files',
        'settings/deny-sensitive-paths',
      ];
      const leakingIssues = result.issues.filter((i) => leakingRuleIds.includes(i.ruleId));
      expect(leakingIssues).toHaveLength(0);
    });

    it('runs only settings and naming rules for settings-json fileType', async () => {
      const settingsPath = join(FIXTURES, 'full-project', '.claude', 'settings.json');
      const ctx = await buildSingleFileInventory(settingsPath);
      const linter = new Linter();
      linter.registerRules(getAllRules());
      const result = linter.run(ctx.inventory, ctx.resolved, undefined, 'settings-json');

      for (const issue of result.issues) {
        expect(['settings', 'naming']).toContain(issue.category);
      }

      // No memory issues in settings-json mode
      const memoryIssues = result.issues.filter((i) => i.category === 'memory');
      expect(memoryIssues).toHaveLength(0);
    });

    it('runs all rules when fileType is not provided (project mode)', () => {
      const inventory = scan({ projectDir: join(FIXTURES, 'conflicting') });
      const resolved = resolve(inventory);
      const linter = new Linter();
      linter.registerRules(getAllRules());
      const result = linter.run(inventory, resolved);

      expect(result.stats.rulesRun).toBe(getAllRules().length);
    });

    it('rulesRun count differs between single-file and project mode', async () => {
      const claudeMdPath = join(FIXTURES, 'full-project', 'CLAUDE.md');
      const ctx = await buildSingleFileInventory(claudeMdPath);
      const linter = new Linter();
      linter.registerRules(getAllRules());

      const singleFileResult = linter.run(ctx.inventory, ctx.resolved, undefined, 'claude-md');
      const projectResult = linter.run(
        scan({ projectDir: join(FIXTURES, 'full-project') }),
        resolve(scan({ projectDir: join(FIXTURES, 'full-project') })),
      );

      expect(singleFileResult.stats.rulesRun).toBeLessThan(projectResult.stats.rulesRun);
    });
  });
});
