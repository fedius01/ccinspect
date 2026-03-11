import { describe, it, expect } from 'vitest';
import { extractInstructions } from '../../src/core/rule-compliance.js';

describe('extractInstructions', () => {
  // ---- Command preference ----

  it('extracts "use X, not Y"', () => {
    const result = extractInstructions('Always use pnpm, not npm for package management.');
    expect(result).toHaveLength(2);
    const pref = result.find((r) => r.preferred === 'pnpm');
    expect(pref).toBeDefined();
    expect(pref!.patternType).toBe('command-preference');
    expect(pref!.preferred).toBe('pnpm');
    expect(pref!.avoided).toBe('npm');
  });

  it('extracts "prefer X over Y"', () => {
    const result = extractInstructions('We prefer bun over npm in this project.');
    expect(result).toHaveLength(1);
    expect(result[0].patternType).toBe('command-preference');
    expect(result[0].preferred).toBe('bun');
    expect(result[0].avoided).toBe('npm');
    expect(result[0].matchedText).toBe('prefer bun over npm');
  });

  it('extracts "always use X" (no avoided)', () => {
    const result = extractInstructions('You should always use yarn for dependencies.');
    expect(result).toHaveLength(1);
    expect(result[0].patternType).toBe('command-preference');
    expect(result[0].preferred).toBe('yarn');
    expect(result[0].avoided).toBeUndefined();
  });

  it('extracts "never use X"', () => {
    const result = extractInstructions('Never use npm in this project.');
    expect(result).toHaveLength(1);
    expect(result[0].patternType).toBe('command-preference');
    expect(result[0].preferred).toBeUndefined();
    expect(result[0].avoided).toBe('npm');
  });

  it('extracts "don\'t use X"', () => {
    const result = extractInstructions("Don't use npm for installing packages.");
    expect(result).toHaveLength(1);
    expect(result[0].patternType).toBe('command-preference');
    expect(result[0].preferred).toBeUndefined();
    expect(result[0].avoided).toBe('npm');
  });

  it('extracts "use X instead of Y"', () => {
    const result = extractInstructions('Use pnpm instead of npm.');
    expect(result).toHaveLength(1);
    expect(result[0].preferred).toBe('pnpm');
    expect(result[0].avoided).toBe('npm');
  });

  it('extracts "use X rather than Y"', () => {
    const result = extractInstructions('Use bun rather than yarn.');
    expect(result).toHaveLength(1);
    expect(result[0].preferred).toBe('bun');
    expect(result[0].avoided).toBe('yarn');
  });

  // ---- Test workflow ----

  it('extracts "run tests after every edit"', () => {
    const result = extractInstructions('Always run tests after every edit.');
    expect(result).toHaveLength(1);
    expect(result[0].patternType).toBe('test-workflow');
    expect(result[0].matchedText).toMatch(/run tests after every edit/i);
  });

  it('extracts "always run vitest after changes"', () => {
    const result = extractInstructions('Always run vitest after changes.');
    const workflow = result.filter((r) => r.patternType === 'test-workflow');
    expect(workflow.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts "run npm test after"', () => {
    const result = extractInstructions('Run npm test after making modifications.');
    expect(result).toHaveLength(1);
    expect(result[0].patternType).toBe('test-workflow');
  });

  // ---- Tool restrictions ----

  it('extracts "never use Write"', () => {
    const result = extractInstructions('Never use Write for modifications.');
    const restriction = result.filter((r) => r.patternType === 'tool-restriction');
    expect(restriction).toHaveLength(1);
    expect(restriction[0].avoided).toBe('Write');
  });

  it('extracts "prefer Edit over Write"', () => {
    const result = extractInstructions('Prefer Edit over Write for file changes.');
    const restriction = result.filter((r) => r.patternType === 'tool-restriction');
    expect(restriction).toHaveLength(1);
    expect(restriction[0].preferred).toBe('Edit');
    expect(restriction[0].avoided).toBe('Write');
  });

  it('extracts "always use Edit instead of Write"', () => {
    const result = extractInstructions('Always use Edit instead of Write.');
    const restriction = result.filter((r) => r.patternType === 'tool-restriction');
    expect(restriction).toHaveLength(1);
    expect(restriction[0].preferred).toBe('Edit');
    expect(restriction[0].avoided).toBe('Write');
  });

  // ---- Branch conventions ----

  it('extracts "always work on feature branches"', () => {
    const result = extractInstructions('Always work on feature branches.');
    expect(result).toHaveLength(1);
    expect(result[0].patternType).toBe('branch-convention');
  });

  it('extracts "never commit directly to main"', () => {
    const result = extractInstructions('Never commit directly to main.');
    expect(result).toHaveLength(1);
    expect(result[0].patternType).toBe('branch-convention');
  });

  it('extracts "never push to master"', () => {
    const result = extractInstructions('Never push to master.');
    expect(result).toHaveLength(1);
    expect(result[0].patternType).toBe('branch-convention');
  });

  it('extracts "always create a feature branch"', () => {
    const result = extractInstructions('Always create a feature branch before starting work.');
    expect(result).toHaveLength(1);
    expect(result[0].patternType).toBe('branch-convention');
  });

  // ---- Vague / no match ----

  it('returns empty for vague "think carefully about edge cases"', () => {
    const result = extractInstructions('Think carefully about edge cases.');
    expect(result).toHaveLength(0);
  });

  it('returns empty for vague "follow best practices"', () => {
    const result = extractInstructions('Follow best practices when writing code.');
    expect(result).toHaveLength(0);
  });

  it('returns empty for vague "write clean code"', () => {
    const result = extractInstructions('Write clean code and maintain high quality.');
    expect(result).toHaveLength(0);
  });

  // ---- Multiple patterns ----

  it('extracts multiple patterns from one rule body', () => {
    const body = `
# Code style
Use pnpm, not npm for dependencies.

# Testing
Always run tests after every edit.
    `;
    const result = extractInstructions(body);
    expect(result.length).toBeGreaterThanOrEqual(2);
    const types = result.map((r) => r.patternType);
    expect(types).toContain('command-preference');
    expect(types).toContain('test-workflow');
  });

  // ---- Deduplication ----

  it('deduplicates "use pnpm" and "always use pnpm"', () => {
    const body = `
Use pnpm for everything.
Always use pnpm for package management.
    `;
    const result = extractInstructions(body);
    // Both match "always use pnpm" or "use pnpm" — deduplicated by key
    const pnpmEntries = result.filter(
      (r) => r.patternType === 'command-preference' && r.preferred === 'pnpm',
    );
    expect(pnpmEntries).toHaveLength(1);
  });

  // ---- Negation guard ----

  it('skips "you don\'t need to always use pnpm"', () => {
    const body = "You don't need to always use pnpm.";
    const result = extractInstructions(body);
    const pnpmEntries = result.filter(
      (r) => r.preferred === 'pnpm',
    );
    expect(pnpmEntries).toHaveLength(0);
  });

  it('skips "no need to always use strict"', () => {
    const body = 'There is no need to always use strict mode.';
    const result = extractInstructions(body);
    const strictEntries = result.filter((r) => r.preferred === 'strict');
    expect(strictEntries).toHaveLength(0);
  });

  // ---- Edge cases ----

  it('returns empty for empty body', () => {
    expect(extractInstructions('')).toHaveLength(0);
  });

  it('returns empty for frontmatter-only (no body)', () => {
    expect(extractInstructions('')).toHaveLength(0);
  });

  it('limits to 10 patterns maximum', () => {
    // Generate a body with many extractable patterns
    const lines: string[] = [];
    for (let i = 0; i < 15; i++) {
      lines.push(`Always use tool${i} for task ${i}.`);
    }
    const result = extractInstructions(lines.join('\n'));
    expect(result.length).toBeLessThanOrEqual(10);
  });

  // ---- Regression: do not use ----

  it('extracts "do not use npm"', () => {
    const result = extractInstructions('Do not use npm in this project.');
    expect(result).toHaveLength(1);
    expect(result[0].avoided).toBe('npm');
    expect(result[0].preferred).toBeUndefined();
  });
});
