import { describe, it, expect, afterAll } from 'vitest';
import { join } from 'path';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures');
const CLI_ENTRY = join(import.meta.dirname, '..', '..', '..', 'src', 'cli', 'index.ts');
const TSX = 'npx tsx';

function runCli(args: string, expectFail = false): string {
  try {
    // eslint-disable-next-line sonarjs/os-command -- Test helper executing CLI for integration testing
    return execSync(`${TSX} ${CLI_ENTRY} ${args}`, {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
  } catch (err) {
    if (expectFail) {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      return (e.stdout || '') + (e.stderr || '');
    }
    throw err;
  }
}

describe('cci lint command — single-file mode', () => {
  describe('CLAUDE.md lint', () => {
    const file = join(FIXTURES, 'full-project', 'CLAUDE.md');

    it('shows single-file banner in terminal output', () => {
      const output = runCli(`lint ${file}`);
      expect(output).toContain('Single-file mode');
      expect(output).toContain('CLAUDE.md');
      expect(output).toContain('memory');
      expect(output).toContain('Cross-file and project-level rules skipped');
    });

    it('includes correct singleFileMode metadata', () => {
      const output = runCli(`lint --format json ${file}`);
      const parsed = JSON.parse(output);
      expect(parsed.singleFileMode).toBeDefined();
      expect(parsed.singleFileMode.type).toBe('claude-md');
      expect(parsed.singleFileMode.label).toBe('memory');
    });

    it('does not produce cross-level issues', () => {
      const output = runCli(`lint --format json ${file}`);
      const parsed = JSON.parse(output);

      const crossLevelIssues = parsed.issues.filter(
        (i: { category: string }) => i.category === 'cross-level',
      );
      expect(crossLevelIssues).toHaveLength(0);
    });
  });

  describe('settings.json lint', () => {
    const file = join(FIXTURES, 'full-project', '.claude', 'settings.json');

    it('shows single-file banner with settings label', () => {
      const output = runCli(`lint ${file}`);
      expect(output).toContain('Single-file mode');
      expect(output).toContain('settings.json');
      expect(output).toContain('settings');
    });

    it('does not produce memory or cross-level issues for settings file', () => {
      const output = runCli(`lint --format json ${file}`);
      const parsed = JSON.parse(output);
      expect(parsed.singleFileMode).toBeDefined();
      expect(parsed.singleFileMode.type).toBe('settings-json');

      const nonSettingsIssues = parsed.issues.filter(
        (i: { category: string }) => i.category === 'cross-level' || i.category === 'memory',
      );
      expect(nonSettingsIssues).toHaveLength(0);
    });
  });

  describe('rule file lint', () => {
    const file = join(FIXTURES, 'full-project', '.claude', 'rules', 'testing.md');

    it('shows single-file banner with rule label', () => {
      const output = runCli(`lint ${file}`);
      expect(output).toContain('Single-file mode');
      expect(output).toContain('testing.md');
      expect(output).toContain('rule');
    });

    it('includes correct singleFileMode metadata for rule files', () => {
      const output = runCli(`lint --format json ${file}`);
      const parsed = JSON.parse(output);
      expect(parsed.singleFileMode.type).toBe('rule-md');
      expect(parsed.singleFileMode.label).toBe('rule');
    });

    it('does not produce cross-level or memory issues for rule file', () => {
      const output = runCli(`lint --format json ${file}`);
      const parsed = JSON.parse(output);

      const crossLevelIssues = parsed.issues.filter(
        (i: { category: string }) => i.category === 'cross-level' || i.category === 'memory',
      );
      expect(crossLevelIssues).toHaveLength(0);
    });
  });

  describe('agent file lint', () => {
    const file = join(FIXTURES, 'full-project', '.claude', 'agents', 'reviewer.md');

    it('shows single-file banner with agent label', () => {
      const output = runCli(`lint ${file}`);
      expect(output).toContain('Single-file mode');
      expect(output).toContain('reviewer.md');
      expect(output).toContain('agent');
    });

    it('includes correct singleFileMode metadata for agent files', () => {
      const output = runCli(`lint --format json ${file}`);
      const parsed = JSON.parse(output);
      expect(parsed.singleFileMode.type).toBe('agent-md');
      expect(parsed.singleFileMode.label).toBe('agent');
    });

    it('does not produce cross-level or memory issues for agent file', () => {
      const output = runCli(`lint --format json ${file}`);
      const parsed = JSON.parse(output);

      const crossLevelIssues = parsed.issues.filter(
        (i: { category: string }) => i.category === 'cross-level' || i.category === 'memory',
      );
      expect(crossLevelIssues).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('shows error for unrecognized file type', () => {
      const file = join(FIXTURES, 'full-project', '..', '..', '..', 'package.json');
      const output = runCli(`lint ${file}`, true);
      expect(output).toContain('unsupported file type');
      expect(output).toContain('CLAUDE.md');
      expect(output).toContain('settings.json');
    });

    it('shows error for nonexistent file', () => {
      const output = runCli('lint nonexistent-file-xyz.md', true);
      expect(output).toContain('not found');
    });
  });

  describe('JSON output', () => {
    it('includes singleFileMode property', () => {
      const file = join(FIXTURES, 'full-project', 'CLAUDE.md');
      const output = runCli(`lint --format json ${file}`);
      const parsed = JSON.parse(output);

      expect(parsed.singleFileMode).toEqual({
        file: 'CLAUDE.md',
        type: 'claude-md',
        label: 'memory',
      });
      expect(parsed.issues).toBeDefined();
      expect(parsed.stats).toBeDefined();
    });

    it('does not include casingMismatch top-level field', () => {
      const file = join(FIXTURES, 'full-project', 'CLAUDE.md');
      const output = runCli(`lint --format json ${file}`);
      const parsed = JSON.parse(output);
      expect(parsed.casingMismatch).toBeUndefined();
    });
  });

  describe('markdown output', () => {
    it('includes single-file note at top', () => {
      const file = join(FIXTURES, 'full-project', 'CLAUDE.md');
      const output = runCli(`lint --format md ${file}`);
      expect(output).toContain('> **Single-file mode**');
      expect(output).toContain('`CLAUDE.md`');
      expect(output).toContain('cross-file rules skipped');
      // Should still contain the normal report
      expect(output).toContain('# ccinspect Lint Report');
    });
  });
});

describe('cci lint command — naming/filename-casing via lint rule', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'ccinspect-lint-casing-'));

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('produces naming/filename-casing issue for miscased file in single-file mode', () => {
    const filePath = join(tmpDir, 'Claude.md');
    writeFileSync(filePath, '# Project\nSome content here.\n');
    const output = runCli(`lint --format json ${filePath}`);
    const parsed = JSON.parse(output);

    const namingIssues = parsed.issues.filter(
      (i: { ruleId: string }) => i.ruleId === 'naming/filename-casing',
    );
    expect(namingIssues).toHaveLength(1);
    expect(namingIssues[0].severity).toBe('warning');
    expect(namingIssues[0].category).toBe('naming');
    expect(namingIssues[0].message).toContain('Claude.md');
    expect(namingIssues[0].message).toContain('CLAUDE.md');
  });

  it('shows naming issue in terminal output for miscased file', () => {
    const filePath = join(tmpDir, 'Claude.md');
    const output = runCli(`lint ${filePath}`);
    expect(output).toContain('naming/filename-casing');
    expect(output).toContain('CLAUDE.md');
  });

  it('does not produce naming issue for correctly-named CLAUDE.md', () => {
    const file = join(FIXTURES, 'full-project', 'CLAUDE.md');
    const output = runCli(`lint --format json ${file}`);
    const parsed = JSON.parse(output);

    const namingIssues = parsed.issues.filter(
      (i: { ruleId: string }) => i.ruleId === 'naming/filename-casing',
    );
    expect(namingIssues).toHaveLength(0);
  });

  it('still rejects README.md as unsupported', () => {
    const filePath = join(tmpDir, 'README.md');
    writeFileSync(filePath, '# README\n');
    const output = runCli(`lint ${filePath}`, true);
    expect(output).toContain('unsupported file type');
  });
});

describe('cci lint command — naming/filename-casing in directory mode', () => {
  it('flags miscased files when scanning miscased-files fixture', () => {
    const projectDir = join(FIXTURES, 'miscased-files');
    const output = runCli(`lint --format json --project-dir ${projectDir}`);
    const parsed = JSON.parse(output);

    const namingIssues = parsed.issues.filter(
      (i: { ruleId: string }) => i.ruleId === 'naming/filename-casing',
    );
    // Should find at least Claude.md and skill.md miscased
    expect(namingIssues.length).toBeGreaterThanOrEqual(2);
  });

  it('does not flag naming issues in a correctly-cased project', () => {
    const projectDir = join(FIXTURES, 'full-project');
    const output = runCli(`lint --format json --project-dir ${projectDir}`);
    const parsed = JSON.parse(output);

    const namingIssues = parsed.issues.filter(
      (i: { ruleId: string }) => i.ruleId === 'naming/filename-casing',
    );
    expect(namingIssues).toHaveLength(0);
  });
});

describe('cci lint command — directory mode (regression)', () => {
  it('still works with --project-dir', () => {
    const projectDir = join(FIXTURES, 'full-project');
    const output = runCli(`lint --project-dir ${projectDir}`);
    expect(output).toContain('ccinspect lint');
    // Should NOT contain single-file banner
    expect(output).not.toContain('Single-file mode');
  });

  it('still works with positional directory argument', () => {
    const projectDir = join(FIXTURES, 'full-project');
    const output = runCli(`lint ${projectDir}`);
    expect(output).toContain('ccinspect lint');
    expect(output).not.toContain('Single-file mode');
  });

  it('produces multiple categories in directory mode', () => {
    const projectDir = join(FIXTURES, 'full-project');
    const output = runCli(`lint --format json --project-dir ${projectDir}`);
    const parsed = JSON.parse(output);
    expect(parsed.singleFileMode).toBeUndefined();

    const categories = new Set(parsed.issues.map((i: { category: string }) => i.category));
    // Full-project should have issues from multiple categories
    expect(categories.size).toBeGreaterThanOrEqual(1);
  });
});
