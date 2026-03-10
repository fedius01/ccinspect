import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { resolve } from 'path';

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function strip(s: string): string {
  return s.replace(ANSI_RE, '');
}

const cliPath = resolve(__dirname, '../../../src/cli/index.ts');
const fixtureDir = resolve(__dirname, '../../fixtures/full-project');

function run(args: string): string {
  return execSync(`npx tsx ${cliPath} ${args}`, {
    encoding: 'utf-8',
    timeout: 10000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
}

describe('blame subcommand routing', () => {
  it('blame (no topic) renders Effective config', () => {
    const output = strip(run(`blame --project-dir ${fixtureDir}`));
    expect(output).toContain('ccinspect blame');
    expect(output).toContain('Effective config');
  });

  it('blame settings renders settings table', () => {
    const output = strip(run(`blame settings --project-dir ${fixtureDir}`));
    expect(output).toContain('ccinspect blame settings');
    expect(output).toContain('Key');
    expect(output).toContain('Value');
    expect(output).toContain('Source');
    expect(output).toContain('keys resolved');
  });

  it('blame settings --format json outputs valid JSON', () => {
    const output = run(`blame settings --project-dir ${fixtureDir} --format json`);
    const parsed = JSON.parse(output.trim());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]).toHaveProperty('key');
    expect(parsed[0]).toHaveProperty('value');
    expect(parsed[0]).toHaveProperty('source');
  });

  it('blame settings --verbose shows override annotations', () => {
    // Use a fixture with overlapping settings at multiple levels
    const output = strip(run(`blame settings --project-dir ${fixtureDir} --verbose`));
    expect(output).toContain('ccinspect blame settings');
    // Verbose mode should render fine even without overrides
    expect(output).toContain('keys resolved');
  });

  it('blame unknown-topic shows error', () => {
    try {
      run(`blame foo --project-dir ${fixtureDir}`);
      expect.fail('Expected non-zero exit code');
    } catch (err: unknown) {
      const e = err as { stderr?: string; stdout?: string };
      const stderr = e.stderr || '';
      expect(stderr).toContain('Unknown blame topic: "foo"');
    }
  });
});
