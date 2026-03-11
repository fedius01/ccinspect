import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import {
  encodeProjectPath,
  getTranscriptsBaseDir,
  discoverTranscripts,
  listAllProjectDirs,
} from '../../src/utils/transcript-discovery.js';

let testCounter = 0;
function uniqueTempDir(): string {
  testCounter++;
  return join(tmpdir(), `ccinspect-test-${Date.now()}-${testCounter}-${randomBytes(4).toString('hex')}`);
}

describe('encodeProjectPath', () => {
  it('encodes absolute Unix path with leading dash', () => {
    expect(encodeProjectPath('/Users/dev/my-project')).toBe('-Users-dev-my-project');
  });

  it('encodes home directory path', () => {
    expect(encodeProjectPath('/home/user/code')).toBe('-home-user-code');
  });

  it('preserves trailing slash as trailing dash', () => {
    expect(encodeProjectPath('/Users/dev/project/')).toBe('-Users-dev-project-');
  });

  it('encodes real project path', () => {
    expect(encodeProjectPath('/Users/maksim.fediushkin/ClaudeProjects/ccci')).toBe(
      '-Users-maksim-fediushkin-ClaudeProjects-ccci',
    );
  });

  it('handles single slash (root)', () => {
    expect(encodeProjectPath('/')).toBe('-');
  });

  it('handles path with no slashes', () => {
    expect(encodeProjectPath('relative-path')).toBe('relative-path');
  });
});

describe('getTranscriptsBaseDir', () => {
  it('returns custom home when provided', () => {
    expect(getTranscriptsBaseDir('/tmp/fakehome')).toBe('/tmp/fakehome/.claude/projects');
  });
});

describe('discoverTranscripts', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = uniqueTempDir();
    mkdirSync(tempHome, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  function createProjectDir(projectRoot: string): string {
    const encoded = encodeProjectPath(projectRoot);
    const dir = join(tempHome, '.claude', 'projects', encoded);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  it('discovers session files sorted by mtime descending', async () => {
    const dir = createProjectDir('/Users/dev/project');

    // Create 3 session files with distinct mtimes
    const ids = ['aaaa-1111', 'bbbb-2222', 'cccc-3333'];
    const now = Date.now();
    for (let i = 0; i < ids.length; i++) {
      const filePath = join(dir, `${ids[i]}.jsonl`);
      writeFileSync(filePath, '{}');
      // Oldest first in file creation, so sort should reverse
      const mtime = new Date(now - (ids.length - i) * 10000);
      utimesSync(filePath, mtime, mtime);
    }

    const result = await discoverTranscripts('/Users/dev/project', tempHome);

    expect(result).not.toBeNull();
    expect(result!.sessionFiles).toHaveLength(3);
    // Newest first
    expect(result!.sessionFiles[0].sessionId).toBe('cccc-3333');
    expect(result!.sessionFiles[1].sessionId).toBe('bbbb-2222');
    expect(result!.sessionFiles[2].sessionId).toBe('aaaa-1111');
  });

  it('populates SessionFileInfo fields correctly', async () => {
    const dir = createProjectDir('/Users/dev/project');
    const content = '{"type":"system"}\n{"type":"user"}\n';
    writeFileSync(join(dir, 'test-uuid.jsonl'), content);

    const result = await discoverTranscripts('/Users/dev/project', tempHome);

    expect(result).not.toBeNull();
    const file = result!.sessionFiles[0];
    expect(file.sessionId).toBe('test-uuid');
    expect(file.filePath).toBe(join(dir, 'test-uuid.jsonl'));
    expect(file.fileSize).toBe(Buffer.byteLength(content));
    expect(file.lastModified).toBeInstanceOf(Date);
  });

  it('detects sessions-index.json when present', async () => {
    const dir = createProjectDir('/Users/dev/project');
    writeFileSync(join(dir, 'session-1.jsonl'), '{}');
    writeFileSync(join(dir, 'sessions-index.json'), '{}');

    const result = await discoverTranscripts('/Users/dev/project', tempHome);

    expect(result).not.toBeNull();
    expect(result!.sessionsIndexPath).toBe(join(dir, 'sessions-index.json'));
  });

  it('sets sessionsIndexPath to null when no index file', async () => {
    const dir = createProjectDir('/Users/dev/project');
    writeFileSync(join(dir, 'session-1.jsonl'), '{}');

    const result = await discoverTranscripts('/Users/dev/project', tempHome);

    expect(result).not.toBeNull();
    expect(result!.sessionsIndexPath).toBeNull();
  });

  it('returns null when project directory does not exist', async () => {
    // Ensure base dir exists but encoded project dir does not
    mkdirSync(join(tempHome, '.claude', 'projects'), { recursive: true });

    const result = await discoverTranscripts('/nonexistent/project', tempHome);

    expect(result).toBeNull();
  });

  it('returns null when ~/.claude/projects/ does not exist', async () => {
    // tempHome has no .claude directory at all
    const result = await discoverTranscripts('/Users/dev/project', tempHome);

    expect(result).toBeNull();
  });

  it('returns empty sessionFiles for empty directory', async () => {
    createProjectDir('/Users/dev/project');

    const result = await discoverTranscripts('/Users/dev/project', tempHome);

    expect(result).not.toBeNull();
    expect(result!.sessionFiles).toHaveLength(0);
  });

  it('ignores non-jsonl files', async () => {
    const dir = createProjectDir('/Users/dev/project');
    writeFileSync(join(dir, 'session-1.jsonl'), '{}');
    writeFileSync(join(dir, 'sessions-index.json'), '{}');
    writeFileSync(join(dir, 'notes.txt'), 'hello');
    writeFileSync(join(dir, 'data.json'), '{}');

    const result = await discoverTranscripts('/Users/dev/project', tempHome);

    expect(result).not.toBeNull();
    expect(result!.sessionFiles).toHaveLength(1);
    expect(result!.sessionFiles[0].sessionId).toBe('session-1');
  });

  it('sets projectDir to the encoded project directory', async () => {
    createProjectDir('/Users/dev/project');

    const result = await discoverTranscripts('/Users/dev/project', tempHome);

    expect(result).not.toBeNull();
    expect(result!.projectDir).toBe(
      join(tempHome, '.claude', 'projects', '-Users-dev-project'),
    );
  });
});

describe('listAllProjectDirs', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = uniqueTempDir();
    mkdirSync(tempHome, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('returns all subdirectories under projects/', async () => {
    const base = join(tempHome, '.claude', 'projects');
    mkdirSync(join(base, '-Users-dev-project-a'), { recursive: true });
    mkdirSync(join(base, '-Users-dev-project-b'), { recursive: true });
    mkdirSync(join(base, '-home-user-code'), { recursive: true });

    const dirs = await listAllProjectDirs(tempHome);

    expect(dirs).toHaveLength(3);
    expect(dirs).toContain(join(base, '-Users-dev-project-a'));
    expect(dirs).toContain(join(base, '-Users-dev-project-b'));
    expect(dirs).toContain(join(base, '-home-user-code'));
  });

  it('returns empty array when projects/ does not exist', async () => {
    const dirs = await listAllProjectDirs(tempHome);
    expect(dirs).toEqual([]);
  });

  it('ignores files in the projects directory', async () => {
    const base = join(tempHome, '.claude', 'projects');
    mkdirSync(base, { recursive: true });
    mkdirSync(join(base, '-Users-dev-project'), { recursive: true });
    writeFileSync(join(base, 'stray-file.txt'), 'hello');

    const dirs = await listAllProjectDirs(tempHome);

    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe(join(base, '-Users-dev-project'));
  });
});
