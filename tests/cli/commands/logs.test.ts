import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { execSync } from 'child_process';
import { mkdtempSync, mkdirSync, cpSync, rmSync } from 'fs';
import { tmpdir } from 'os';

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures');
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

/**
 * Set up a fake ~/.claude/projects/<encoded>/ directory with mock transcripts.
 * We create a temp dir as "home", and a temp project dir. Then we encode the
 * project path and copy fixtures into the appropriate place.
 */
let fakeHome: string;
let fakeProjectDir: string;
let fakeTranscriptsDir: string;

beforeAll(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'ccinspect-logs-test-home-'));
  fakeProjectDir = mkdtempSync(join(tmpdir(), 'ccinspect-logs-test-proj-'));

  // Encode project path: replace / with -
  const encoded = fakeProjectDir.replace(/\//g, '-');
  fakeTranscriptsDir = join(fakeHome, '.claude', 'projects', encoded);
  mkdirSync(fakeTranscriptsDir, { recursive: true });

  // Copy golden-session.jsonl as a mock transcript
  cpSync(
    join(FIXTURES, 'mock-transcripts', 'golden-session.jsonl'),
    join(fakeTranscriptsDir, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890.jsonl'),
  );
});

afterAll(() => {
  rmSync(fakeHome, { recursive: true, force: true });
  rmSync(fakeProjectDir, { recursive: true, force: true });
});

describe('cci logs stats command', () => {
  // NOTE: The analyzeTranscripts function uses homedir() to find transcripts.
  // Since we can't easily mock homedir() in a CLI subprocess, we test the
  // command exists and handles the "no transcripts" case. For full integration,
  // we'd need HOME env override — which analyzeTranscripts/discoverTranscripts
  // don't currently support via env var.

  it('appears in cci --help output', () => {
    const output = runCli('--help');
    expect(output).toContain('logs');
  });

  it('logs stats appears in cci logs --help', () => {
    const output = runCli('logs --help');
    expect(output).toContain('stats');
    expect(output).toContain('session analytics');
  });

  it('logs stats --help shows options', () => {
    const output = runCli('logs stats --help');
    expect(output).toContain('--days');
    expect(output).toContain('--session');
  });

  it('produces terminal output for a project with no transcripts', () => {
    // Use a temp dir that has no transcripts
    const emptyDir = mkdtempSync(join(tmpdir(), 'ccinspect-empty-'));
    try {
      const output = runCli(`logs stats --project-dir ${emptyDir}`);
      expect(output).toContain('No transcript files found');
      expect(output).toContain('~/.claude/projects/');
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('produces JSON output for a project with no transcripts', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'ccinspect-empty-'));
    try {
      const output = runCli(`logs stats --format json --project-dir ${emptyDir}`);
      const parsed = JSON.parse(output);
      expect(parsed.dataQuality.sessionsAnalyzed).toBe(0);
      expect(parsed.sessions.total).toBe(0);
      expect(parsed.toolCalls.total).toBe(0);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
