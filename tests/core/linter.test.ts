import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { scan } from '../../src/core/scanner.js';
import { resolve } from '../../src/core/resolver.js';
import { Linter } from '../../src/core/linter.js';
import { getAllRules } from '../../src/rules/index.js';

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
});
