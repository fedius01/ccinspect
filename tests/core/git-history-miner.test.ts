import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as child_process from 'child_process';
import { mineGitHistory, extractConfigPaths } from '../../src/core/git-history-miner.js';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

const mockedExecSync = vi.mocked(child_process.execSync);

const SEP = '---CCI_COMMIT_SEP---';

// The format is: SEP + HEADER\nfile1\nfile2\n
// When split by SEP, each block starts with the header line followed by file names.
function makeLogOutput(...commits: Array<{ hash: string; date: string; author: string; msg: string; files: string[] }>): string {
  return commits.map((c) => {
    const header = `${SEP}${c.hash}|${c.date}|${c.author}|${c.msg}`;
    const fileLines = c.files.length > 0 ? '\n' + c.files.join('\n') : '';
    return header + fileLines;
  }).join('\n') + '\n';
}

describe('mineGitHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array for no config paths', () => {
    const result = mineGitHistory('/project', []);
    expect(result).toEqual([]);
    expect(mockedExecSync).not.toHaveBeenCalled();
  });

  it('returns empty array when git fails', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('not a git repo');
    });
    const result = mineGitHistory('/project', ['CLAUDE.md']);
    expect(result).toEqual([]);
  });

  it('returns empty array for empty git output', () => {
    mockedExecSync.mockReturnValue('');
    const result = mineGitHistory('/project', ['CLAUDE.md']);
    expect(result).toEqual([]);
  });

  it('parses a single commit with one file', () => {
    const logOutput = makeLogOutput({
      hash: 'abc1234', date: '2026-03-01T10:00:00+00:00', author: 'John Doe',
      msg: 'Initial config', files: ['CLAUDE.md'],
    });
    const fileContent = '# Project\nSome instructions';

    mockedExecSync
      .mockReturnValueOnce(logOutput) // git log
      .mockReturnValueOnce(fileContent) // git show abc1234:CLAUDE.md
      .mockImplementationOnce(() => { throw new Error('not found'); }); // parent check

    const result = mineGitHistory('/project', ['CLAUDE.md']);

    expect(result).toHaveLength(1);
    expect(result[0].commitHash).toBe('abc1234');
    expect(result[0].author).toBe('John Doe');
    expect(result[0].commitMessage).toBe('Initial config');
    expect(result[0].timestamp).toBe('2026-03-01T10:00:00+00:00');
    expect(result[0].files).toHaveLength(1);
    expect(result[0].files[0].path).toBe('CLAUDE.md');
    expect(result[0].files[0].content).toBe(fileContent);
    expect(result[0].files[0].status).toBe('added');
  });

  it('parses multiple commits', () => {
    const logOutput = makeLogOutput(
      { hash: 'abc1111', date: '2026-03-01T10:00:00+00:00', author: 'Alice', msg: 'First commit', files: ['CLAUDE.md'] },
      { hash: 'abc2222', date: '2026-03-02T10:00:00+00:00', author: 'Bob', msg: 'Second commit', files: ['CLAUDE.md'] },
    );

    mockedExecSync
      .mockReturnValueOnce(logOutput) // git log
      .mockReturnValueOnce('content v1') // git show abc1111:CLAUDE.md
      .mockImplementationOnce(() => { throw new Error(); }) // parent check (added)
      .mockReturnValueOnce('content v2') // git show abc2222:CLAUDE.md
      .mockReturnValueOnce('content v1'); // parent exists (modified)

    const result = mineGitHistory('/project', ['CLAUDE.md']);

    expect(result).toHaveLength(2);
    expect(result[0].commitHash).toBe('abc1111');
    expect(result[0].files[0].status).toBe('added');
    expect(result[1].commitHash).toBe('abc2222');
    expect(result[1].files[0].status).toBe('modified');
  });

  it('handles deleted file in commit', () => {
    const logOutput = makeLogOutput({
      hash: 'abc3333', date: '2026-03-03T10:00:00+00:00', author: 'Charlie',
      msg: 'Remove config', files: ['CLAUDE.md'],
    });

    mockedExecSync
      .mockReturnValueOnce(logOutput) // git log
      .mockImplementationOnce(() => { throw new Error(); }); // git show fails = deleted

    const result = mineGitHistory('/project', ['CLAUDE.md']);

    expect(result).toHaveLength(1);
    expect(result[0].files).toHaveLength(1);
    expect(result[0].files[0].status).toBe('deleted');
    expect(result[0].files[0].content).toBeNull();
  });

  it('handles commit message containing pipe character', () => {
    const logOutput = makeLogOutput({
      hash: 'abc4444', date: '2026-03-04T10:00:00+00:00', author: 'Dave',
      msg: 'feat: add X | also Y', files: ['CLAUDE.md'],
    });

    mockedExecSync
      .mockReturnValueOnce(logOutput)
      .mockReturnValueOnce('content')
      .mockImplementationOnce(() => { throw new Error(); });

    const result = mineGitHistory('/project', ['CLAUDE.md']);
    expect(result[0].commitMessage).toBe('feat: add X | also Y');
  });

  it('uses since parameter for incremental update', () => {
    mockedExecSync.mockReturnValue('');

    mineGitHistory('/project', ['CLAUDE.md'], 'abc0000');

    const cmd = mockedExecSync.mock.calls[0][0] as string;
    expect(cmd).toContain('abc0000..HEAD');
  });

  it('handles commit with no relevant files', () => {
    const logOutput = makeLogOutput({
      hash: 'abc5555', date: '2026-03-05T10:00:00+00:00', author: 'Eve',
      msg: 'No config changes', files: [],
    });

    mockedExecSync.mockReturnValueOnce(logOutput);

    const result = mineGitHistory('/project', ['CLAUDE.md']);
    // Commit has no changed paths matching config, so files array is empty
    expect(result).toHaveLength(1);
    expect(result[0].files).toHaveLength(0);
  });
});

describe('extractConfigPaths', () => {
  it('extracts paths relative to git root', () => {
    const paths = extractConfigPaths('/project', [
      '/project/CLAUDE.md',
      '/project/.claude/settings.json',
    ], false);
    expect(paths).toEqual(['CLAUDE.md', '.claude/settings.json']);
  });

  it('excludes paths outside git root', () => {
    const paths = extractConfigPaths('/project', [
      '/project/CLAUDE.md',
      '/home/user/.claude/settings.json',
    ], false);
    expect(paths).toEqual(['CLAUDE.md']);
  });

  it('deduplicates paths', () => {
    const paths = extractConfigPaths('/project', [
      '/project/CLAUDE.md',
      '/project/CLAUDE.md',
    ], false);
    expect(paths).toEqual(['CLAUDE.md']);
  });

  it('returns empty for no matching paths', () => {
    const paths = extractConfigPaths('/project', [
      '/other/CLAUDE.md',
    ], false);
    expect(paths).toEqual([]);
  });
});
