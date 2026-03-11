import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

const CLI_ENTRY = join(import.meta.dirname, '..', '..', '..', 'src', 'cli', 'index.ts');
const TSX = 'npx tsx';

function runCli(args: string, expectFail = false): string {
  try {
    return execSync(`${TSX} ${CLI_ENTRY} ${args}`, {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
  } catch (err) {
    if (expectFail) {
      const e = err as { stdout?: string; stderr?: string };
      return (e.stdout || '') + (e.stderr || '');
    }
    throw err;
  }
}

describe('cci session-recover command', () => {
  it('appears in cci --help output', () => {
    const output = runCli('--help');
    expect(output).toContain('session-recover');
  });

  it('session-recover --help shows description and options', () => {
    const output = runCli('session-recover --help');
    expect(output).toContain('recovery prompt');
    expect(output).toContain('--session');
    expect(output).toContain('--latest');
  });

  it('produces terminal output for project with no transcripts', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'ccinspect-recover-empty-'));
    try {
      const output = runCli(`session-recover --project-dir ${emptyDir}`);
      expect(output).toContain('No transcript files found');
      expect(output).toContain('~/.claude/projects/');
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('produces JSON output for project with no transcripts', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'ccinspect-recover-empty-'));
    try {
      const output = runCli(`session-recover --format json --project-dir ${emptyDir}`);
      const parsed = JSON.parse(output);
      expect(parsed.error).toContain('No transcript files found');
      expect(parsed.sessionId).toBeNull();
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe('session-recover module exports', () => {
  it('exports registerSessionRecoverCommand function', async () => {
    const mod = await import('../../../src/cli/commands/session-recover.js');
    expect(typeof mod.registerSessionRecoverCommand).toBe('function');
  });
});
