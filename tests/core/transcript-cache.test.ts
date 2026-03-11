import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir, chmod } from 'fs/promises';
import { join } from 'path';
import { tmpdir, platform } from 'os';
import type { TranscriptParseResult } from '../../src/parsers/transcript-jsonl.js';
import type { TranscriptSession, UsageSummary } from '../../src/types/transcript.js';
import {
  readCache,
  writeCache,
  deleteCache,
  clearCache,
  getCacheDir,
  getCachePath,
  CACHE_VERSION,
} from '../../src/core/transcript-cache.js';

// ---- Helpers ----

function createMockParseResult(overrides?: Partial<TranscriptSession>): TranscriptParseResult {
  const now = new Date('2026-03-10T12:00:00Z');
  const later = new Date('2026-03-10T13:00:00Z');

  const session: TranscriptSession = {
    sessionId: 'test-session-001',
    claudeCodeVersion: '2.1.70',
    model: 'claude-sonnet-4-5-20250514',
    projectRoot: '/Users/dev/my-project',
    gitBranch: 'main',
    startedAt: now,
    endedAt: later,
    sourceFile: '/home/user/.claude/projects/-Users-dev-my-project/test-session-001.jsonl',
    events: [],
    parseWarnings: [{ line: 5, reason: 'Unknown line type: "debug"' }],
    completeness: 'partial',
    skippedLineTypes: ['system'],
    ...overrides,
  };

  const tokenUsage: UsageSummary = {
    inputTokens: 45000,
    outputTokens: 12000,
    cacheReadTokens: 30000,
    cacheCreationTokens: 5000,
    cache5mTokens: 2000,
    cache1hTokens: 1000,
    completeness: 'exact',
    sessionsWithData: 1,
    sessionsTotal: 1,
  };

  return {
    session,
    toolCalls: [
      {
        toolName: 'Read',
        input: { file_path: '/Users/dev/my-project/src/index.ts' },
        callId: 'toolu_001',
        callerType: 'human_turn_router',
        requestId: 'req_001',
        isSidechain: false,
      },
      {
        toolName: 'Edit',
        input: { file_path: '/Users/dev/my-project/src/index.ts', old_string: 'foo', new_string: 'bar' },
        callId: 'toolu_002',
        callerType: 'human_turn_router',
        requestId: 'req_001',
        isSidechain: false,
      },
      {
        toolName: 'Task',
        input: { agent: 'researcher', prompt: 'Find docs' },
        callId: 'toolu_003',
        callerType: 'human_turn_router',
        requestId: 'req_002',
        isSidechain: false,
        agentContext: 'researcher',
      },
    ],
    toolResults: [
      {
        callId: 'toolu_001',
        sourceToolAssistantUUID: 'uuid-001',
        status: 'success',
        toolUseResult: {},
      },
      {
        callId: 'toolu_002',
        sourceToolAssistantUUID: 'uuid-001',
        status: 'success',
        toolUseResult: {},
      },
      {
        callId: 'toolu_003',
        sourceToolAssistantUUID: 'uuid-002',
        status: 'error',
        errorKind: 'tool_error',
        toolUseResult: { error: 'Agent not found' },
      },
    ],
    tasks: [
      {
        prompt: 'Fix the bug in index.ts',
        startedAt: now,
        endedAt: later,
        toolCalls: [],
        toolResults: [],
        outcome: 'success',
      },
    ],
    tokenUsage,
  };
}

// ---- Tests ----

describe('transcript-cache', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ccinspect-cache-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('getCacheDir', () => {
    it('returns override dir when provided', () => {
      expect(getCacheDir('/custom/cache')).toBe('/custom/cache');
    });

    it('returns default path when no override', () => {
      const dir = getCacheDir();
      expect(dir).toContain('.ccinspect');
      expect(dir).toContain('cache');
      expect(dir).toContain('transcripts');
    });
  });

  describe('getCachePath', () => {
    it('returns session-specific JSON path', () => {
      const path = getCachePath('abc-123', '/cache');
      expect(path).toBe('/cache/abc-123.json');
    });
  });

  describe('write and read cycle', () => {
    it('round-trips a parse result through cache', async () => {
      const sessionId = 'test-session-001';
      const filePath = '/path/to/session.jsonl';
      const fileSize = 12345;
      const fileMtime = 1710000000000;
      const parseResult = createMockParseResult();

      await writeCache(sessionId, filePath, fileSize, fileMtime, parseResult, tempDir);
      const entry = await readCache(sessionId, filePath, fileSize, fileMtime, tempDir);

      expect(entry).not.toBeNull();
      expect(entry!.sessionId).toBe('test-session-001');
      expect(entry!.claudeCodeVersion).toBe('2.1.70');
      expect(entry!.model).toBe('claude-sonnet-4-5-20250514');
      expect(entry!.projectRoot).toBe('/Users/dev/my-project');
      expect(entry!.gitBranch).toBe('main');
      expect(entry!.completeness).toBe('partial');
      expect(entry!.parseWarningsCount).toBe(1);
      expect(entry!.skippedLineTypes).toEqual(['system']);

      // Date fields are ISO strings
      expect(typeof entry!.startedAt).toBe('string');
      expect(typeof entry!.endedAt).toBe('string');
      expect(typeof entry!.cachedAt).toBe('string');
      expect(entry!.startedAt).toBe('2026-03-10T12:00:00.000Z');
      expect(entry!.endedAt).toBe('2026-03-10T13:00:00.000Z');

      // Tool calls preserved
      expect(entry!.toolCalls).toHaveLength(3);
      expect(entry!.toolCalls[0].toolName).toBe('Read');
      expect(entry!.toolCalls[2].agentContext).toBe('researcher');

      // Tool results preserved
      expect(entry!.toolResults).toHaveLength(3);
      expect(entry!.toolResults[2].status).toBe('error');
      expect(entry!.toolResults[2].errorKind).toBe('tool_error');

      // Tasks preserved
      expect(entry!.tasks).toHaveLength(1);
      expect(entry!.tasks[0].prompt).toBe('Fix the bug in index.ts');
      expect(entry!.tasks[0].outcome).toBe('success');
      expect(typeof entry!.tasks[0].startedAt).toBe('string');

      // Token usage preserved
      expect(entry!.tokenUsage.inputTokens).toBe(45000);
      expect(entry!.tokenUsage.outputTokens).toBe(12000);
      expect(entry!.tokenUsage.cacheReadTokens).toBe(30000);
      expect(entry!.tokenUsage.completeness).toBe('exact');
    });

    it('handles session with null endedAt', async () => {
      const parseResult = createMockParseResult({ endedAt: null });

      await writeCache('s1', '/path', 100, 1000, parseResult, tempDir);
      const entry = await readCache('s1', '/path', 100, 1000, tempDir);

      expect(entry).not.toBeNull();
      expect(entry!.endedAt).toBeNull();
    });
  });

  describe('cache miss — no file', () => {
    it('returns null for uncached session', async () => {
      const entry = await readCache('nonexistent', '/path', 100, 1000, tempDir);
      expect(entry).toBeNull();
    });
  });

  describe('cache miss — stale (size changed)', () => {
    it('returns null when file size differs', async () => {
      const parseResult = createMockParseResult();
      await writeCache('s1', '/path', 1000, 5000, parseResult, tempDir);

      const entry = await readCache('s1', '/path', 2000, 5000, tempDir);
      expect(entry).toBeNull();
    });
  });

  describe('cache miss — stale (mtime changed)', () => {
    it('returns null when mtime differs', async () => {
      const parseResult = createMockParseResult();
      await writeCache('s1', '/path', 1000, 5000, parseResult, tempDir);

      const entry = await readCache('s1', '/path', 1000, 6000, tempDir);
      expect(entry).toBeNull();
    });
  });

  describe('cache miss — stale (path changed)', () => {
    it('returns null when file path differs', async () => {
      const parseResult = createMockParseResult();
      await writeCache('s1', '/old/path/session.jsonl', 1000, 5000, parseResult, tempDir);

      const entry = await readCache('s1', '/new/path/session.jsonl', 1000, 5000, tempDir);
      expect(entry).toBeNull();
    });
  });

  describe('corrupted cache file', () => {
    it('returns null for garbage JSON', async () => {
      const cachePath = getCachePath('corrupted', tempDir);
      await mkdir(tempDir, { recursive: true });
      await writeFile(cachePath, 'this is not json {{{', 'utf-8');

      const entry = await readCache('corrupted', '/path', 100, 1000, tempDir);
      expect(entry).toBeNull();
    });

    it('returns null for empty file', async () => {
      const cachePath = getCachePath('empty', tempDir);
      await mkdir(tempDir, { recursive: true });
      await writeFile(cachePath, '', 'utf-8');

      const entry = await readCache('empty', '/path', 100, 1000, tempDir);
      expect(entry).toBeNull();
    });
  });

  describe('deleteCache', () => {
    it('removes a cached entry', async () => {
      const parseResult = createMockParseResult();
      await writeCache('s1', '/path', 100, 1000, parseResult, tempDir);

      // Verify it exists
      const before = await readCache('s1', '/path', 100, 1000, tempDir);
      expect(before).not.toBeNull();

      await deleteCache('s1', tempDir);

      const after = await readCache('s1', '/path', 100, 1000, tempDir);
      expect(after).toBeNull();
    });

    it('does not throw for nonexistent entry', async () => {
      await expect(deleteCache('nonexistent', tempDir)).resolves.toBeUndefined();
    });
  });

  describe('clearCache', () => {
    it('removes all cached entries', async () => {
      const parseResult = createMockParseResult();
      await writeCache('s1', '/path1', 100, 1000, parseResult, tempDir);
      await writeCache('s2', '/path2', 200, 2000, parseResult, tempDir);
      await writeCache('s3', '/path3', 300, 3000, parseResult, tempDir);

      await clearCache(tempDir);

      expect(await readCache('s1', '/path1', 100, 1000, tempDir)).toBeNull();
      expect(await readCache('s2', '/path2', 200, 2000, tempDir)).toBeNull();
      expect(await readCache('s3', '/path3', 300, 3000, tempDir)).toBeNull();
    });

    it('does not throw for nonexistent directory', async () => {
      await expect(clearCache(join(tempDir, 'nonexistent'))).resolves.toBeUndefined();
    });
  });

  describe('cache dir auto-creation', () => {
    it('creates nested directories on first write', async () => {
      const nestedDir = join(tempDir, 'a', 'b', 'c');
      const parseResult = createMockParseResult();

      await writeCache('s1', '/path', 100, 1000, parseResult, nestedDir);

      const entry = await readCache('s1', '/path', 100, 1000, nestedDir);
      expect(entry).not.toBeNull();
    });
  });

  describe('write failure is non-fatal', () => {
    // Only run on non-Windows (chmod doesn't work the same on Windows)
    const itUnix = platform() === 'win32' ? it.skip : it;

    itUnix('does not throw on read-only directory', async () => {
      const readOnlyDir = join(tempDir, 'readonly');
      await mkdir(readOnlyDir, { recursive: true });
      await chmod(readOnlyDir, 0o444);

      const parseResult = createMockParseResult();

      // Should not throw
      await expect(
        writeCache('s1', '/path', 100, 1000, parseResult, readOnlyDir),
      ).resolves.toBeUndefined();

      // Restore permissions for cleanup
      await chmod(readOnlyDir, 0o755);
    });
  });

  describe('cache version validation', () => {
    it('rejects cache entry without cacheVersion field (pre-v2 format)', async () => {
      const parseResult = createMockParseResult();
      await writeCache('s1', '/path', 100, 1000, parseResult, tempDir);

      // Read the raw JSON and strip cacheVersion to simulate old format
      const cachePath = getCachePath('s1', tempDir);
      const raw = await readFile(cachePath, 'utf-8');
      const parsed = JSON.parse(raw);
      delete parsed.cacheVersion;
      await writeFile(cachePath, JSON.stringify(parsed), 'utf-8');

      const entry = await readCache('s1', '/path', 100, 1000, tempDir);
      expect(entry).toBeNull();
    });

    it('rejects cache entry with wrong cacheVersion', async () => {
      const parseResult = createMockParseResult();
      await writeCache('s1', '/path', 100, 1000, parseResult, tempDir);

      // Read the raw JSON and set a different version
      const cachePath = getCachePath('s1', tempDir);
      const raw = await readFile(cachePath, 'utf-8');
      const parsed = JSON.parse(raw);
      parsed.cacheVersion = CACHE_VERSION - 1;
      await writeFile(cachePath, JSON.stringify(parsed), 'utf-8');

      const entry = await readCache('s1', '/path', 100, 1000, tempDir);
      expect(entry).toBeNull();
    });

    it('accepts cache entry with correct cacheVersion', async () => {
      const parseResult = createMockParseResult();
      await writeCache('s1', '/path', 100, 1000, parseResult, tempDir);

      const entry = await readCache('s1', '/path', 100, 1000, tempDir);
      expect(entry).not.toBeNull();
      expect(entry!.cacheVersion).toBe(CACHE_VERSION);
    });
  });

  describe('serialization correctness', () => {
    it('does not store raw events array', async () => {
      const parseResult = createMockParseResult();
      // Add some events to the session
      parseResult.session.events = [
        {
          kind: 'user_prompt',
          timestamp: new Date(),
          uuid: 'ev-1',
          parentUuid: null,
          isSidechain: false,
          rawType: 'user',
        },
      ];

      await writeCache('s1', '/path', 100, 1000, parseResult, tempDir);

      // Read the raw JSON to verify events are not stored
      const cachePath = getCachePath('s1', tempDir);
      const raw = await readFile(cachePath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      expect(parsed).not.toHaveProperty('events');
      // Session events should not be in the cache
      expect(raw).not.toContain('"events"');
    });

    it('preserves optional agentContext when present', async () => {
      const parseResult = createMockParseResult();

      await writeCache('s1', '/path', 100, 1000, parseResult, tempDir);
      const entry = await readCache('s1', '/path', 100, 1000, tempDir);

      const taskCall = entry!.toolCalls.find((tc) => tc.toolName === 'Task');
      expect(taskCall?.agentContext).toBe('researcher');

      // Non-agent calls should not have agentContext
      const readCall = entry!.toolCalls.find((tc) => tc.toolName === 'Read');
      expect(readCall).not.toHaveProperty('agentContext');
    });

    it('preserves optional errorKind when present', async () => {
      const parseResult = createMockParseResult();

      await writeCache('s1', '/path', 100, 1000, parseResult, tempDir);
      const entry = await readCache('s1', '/path', 100, 1000, tempDir);

      const errorResult = entry!.toolResults.find((tr) => tr.status === 'error');
      expect(errorResult?.errorKind).toBe('tool_error');

      const successResult = entry!.toolResults.find((tr) => tr.status === 'success');
      expect(successResult).not.toHaveProperty('errorKind');
    });

    it('serializes task endedAt as string when present', async () => {
      const parseResult = createMockParseResult();

      await writeCache('s1', '/path', 100, 1000, parseResult, tempDir);
      const entry = await readCache('s1', '/path', 100, 1000, tempDir);

      expect(typeof entry!.tasks[0].startedAt).toBe('string');
      expect(typeof entry!.tasks[0].endedAt).toBe('string');
    });

    it('omits task endedAt when undefined', async () => {
      const parseResult = createMockParseResult();
      parseResult.tasks[0].endedAt = undefined;

      await writeCache('s1', '/path', 100, 1000, parseResult, tempDir);
      const entry = await readCache('s1', '/path', 100, 1000, tempDir);

      expect(entry!.tasks[0]).not.toHaveProperty('endedAt');
    });
  });
});
