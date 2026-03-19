import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mineTranscriptConfigChanges } from '../../src/core/transcript-config-miner.js';

// Mock transcript-discovery to return our fixture directory
const mockDiscoverTranscripts = vi.fn();
vi.mock('../../src/utils/transcript-discovery.js', () => ({
  discoverTranscripts: (...args: unknown[]) => mockDiscoverTranscripts(...args),
  encodeProjectPath: (p: string) => p.replace(/[/.]/g, '-'),
}));

// Mock transcript-jsonl parser to return controlled results
const mockParseTranscriptFile = vi.fn();
vi.mock('../../src/parsers/transcript-jsonl.js', () => ({
  parseTranscriptFile: (...args: unknown[]) => mockParseTranscriptFile(...args),
}));

const TEST_DIR = join(tmpdir(), 'ccinspect-miner-test-' + Date.now());
const PROJECT_DIR = join(TEST_DIR, 'project');

describe('transcript-config-miner', () => {
  beforeEach(() => {
    mkdirSync(PROJECT_DIR, { recursive: true });
    mockDiscoverTranscripts.mockReset();
    mockParseTranscriptFile.mockReset();
  });

  afterEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // cleanup
    }
  });

  it('returns empty array when no transcripts found', async () => {
    mockDiscoverTranscripts.mockResolvedValue(null);

    const changes = await mineTranscriptConfigChanges(PROJECT_DIR, ['/some/CLAUDE.md']);
    expect(changes).toEqual([]);
  });

  it('returns empty array when no config paths provided', async () => {
    const changes = await mineTranscriptConfigChanges(PROJECT_DIR, []);
    expect(changes).toEqual([]);
  });

  it('extracts Write tool calls targeting config files', async () => {
    const configPath = join(PROJECT_DIR, 'CLAUDE.md');

    mockDiscoverTranscripts.mockResolvedValue({
      projectDir: '/tmp/transcripts',
      sessionFiles: [{
        sessionId: 'session-abc',
        filePath: '/tmp/transcripts/session-abc.jsonl',
        fileSize: 1000,
        lastModified: new Date('2026-03-15T10:00:00Z'),
      }],
      sessionsIndexPath: null,
    });

    mockParseTranscriptFile.mockResolvedValue({
      session: {
        sessionId: 'session-abc',
        startedAt: new Date('2026-03-15T10:00:00Z'),
        claudeCodeVersion: null,
        model: null,
        projectRoot: PROJECT_DIR,
        gitBranch: null,
      },
      toolCalls: [
        {
          toolName: 'Write',
          input: { file_path: configPath, content: '# My Project\nNew content' },
          callId: 'call-1',
          callerType: 'unknown',
          requestId: 'req-1',
          isSidechain: false,
        },
      ],
      toolResults: [],
      tasks: [],
      tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, completeness: 'exact', sessionsWithData: 1, sessionsTotal: 1 },
      messageTokens: [],
    });

    const changes = await mineTranscriptConfigChanges(PROJECT_DIR, [configPath]);

    expect(changes).toHaveLength(1);
    expect(changes[0].toolName).toBe('Write');
    expect(changes[0].content).toBe('# My Project\nNew content');
    expect(changes[0].changeType).toBe('overwrite');
    expect(changes[0].confidence).toBe('high');
    expect(changes[0].sessionId).toBe('session-abc');
  });

  it('extracts Edit tool calls targeting config files', async () => {
    const configPath = join(PROJECT_DIR, '.claude/settings.json');

    mockDiscoverTranscripts.mockResolvedValue({
      projectDir: '/tmp/transcripts',
      sessionFiles: [{
        sessionId: 'session-def',
        filePath: '/tmp/transcripts/session-def.jsonl',
        fileSize: 500,
        lastModified: new Date('2026-03-16T14:00:00Z'),
      }],
      sessionsIndexPath: null,
    });

    mockParseTranscriptFile.mockResolvedValue({
      session: {
        sessionId: 'session-def',
        startedAt: new Date('2026-03-16T14:00:00Z'),
        claudeCodeVersion: null,
        model: null,
        projectRoot: PROJECT_DIR,
        gitBranch: null,
      },
      toolCalls: [
        {
          toolName: 'Edit',
          input: {
            file_path: configPath,
            old_str: '"sandbox": false',
            new_str: '"sandbox": true',
          },
          callId: 'call-2',
          callerType: 'unknown',
          requestId: 'req-2',
          isSidechain: false,
        },
      ],
      toolResults: [],
      tasks: [],
      tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, completeness: 'exact', sessionsWithData: 1, sessionsTotal: 1 },
      messageTokens: [],
    });

    const changes = await mineTranscriptConfigChanges(PROJECT_DIR, [configPath]);

    expect(changes).toHaveLength(1);
    expect(changes[0].toolName).toBe('Edit');
    expect(changes[0].editPatch).toEqual({
      oldStr: '"sandbox": false',
      newStr: '"sandbox": true',
    });
    expect(changes[0].changeType).toBe('edit');
    expect(changes[0].confidence).toBe('high');
  });

  it('ignores tool calls to non-config files', async () => {
    const configPath = join(PROJECT_DIR, 'CLAUDE.md');

    mockDiscoverTranscripts.mockResolvedValue({
      projectDir: '/tmp/transcripts',
      sessionFiles: [{
        sessionId: 'session-ghi',
        filePath: '/tmp/transcripts/session-ghi.jsonl',
        fileSize: 500,
        lastModified: new Date('2026-03-16T15:00:00Z'),
      }],
      sessionsIndexPath: null,
    });

    mockParseTranscriptFile.mockResolvedValue({
      session: {
        sessionId: 'session-ghi',
        startedAt: new Date('2026-03-16T15:00:00Z'),
        claudeCodeVersion: null,
        model: null,
        projectRoot: PROJECT_DIR,
        gitBranch: null,
      },
      toolCalls: [
        {
          toolName: 'Write',
          input: { file_path: join(PROJECT_DIR, 'src/index.ts'), content: 'console.log("hello")' },
          callId: 'call-3',
          callerType: 'unknown',
          requestId: 'req-3',
          isSidechain: false,
        },
        {
          toolName: 'Edit',
          input: { file_path: join(PROJECT_DIR, 'package.json'), old_str: '"v1"', new_str: '"v2"' },
          callId: 'call-4',
          callerType: 'unknown',
          requestId: 'req-4',
          isSidechain: false,
        },
      ],
      toolResults: [],
      tasks: [],
      tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, completeness: 'exact', sessionsWithData: 1, sessionsTotal: 1 },
      messageTokens: [],
    });

    const changes = await mineTranscriptConfigChanges(PROJECT_DIR, [configPath]);
    expect(changes).toHaveLength(0);
  });

  it('ignores Bash tool calls (not supported for config mining)', async () => {
    const configPath = join(PROJECT_DIR, 'CLAUDE.md');

    mockDiscoverTranscripts.mockResolvedValue({
      projectDir: '/tmp/transcripts',
      sessionFiles: [{
        sessionId: 'session-jkl',
        filePath: '/tmp/transcripts/session-jkl.jsonl',
        fileSize: 500,
        lastModified: new Date('2026-03-16T16:00:00Z'),
      }],
      sessionsIndexPath: null,
    });

    mockParseTranscriptFile.mockResolvedValue({
      session: {
        sessionId: 'session-jkl',
        startedAt: new Date('2026-03-16T16:00:00Z'),
        claudeCodeVersion: null,
        model: null,
        projectRoot: PROJECT_DIR,
        gitBranch: null,
      },
      toolCalls: [
        {
          toolName: 'Bash',
          input: { command: `echo "new content" > ${configPath}` },
          callId: 'call-5',
          callerType: 'unknown',
          requestId: 'req-5',
          isSidechain: false,
        },
      ],
      toolResults: [],
      tasks: [],
      tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, completeness: 'exact', sessionsWithData: 1, sessionsTotal: 1 },
      messageTokens: [],
    });

    const changes = await mineTranscriptConfigChanges(PROJECT_DIR, [configPath]);
    expect(changes).toHaveLength(0);
  });

  it('filters sessions by since timestamp', async () => {
    const configPath = join(PROJECT_DIR, 'CLAUDE.md');

    mockDiscoverTranscripts.mockResolvedValue({
      projectDir: '/tmp/transcripts',
      sessionFiles: [
        {
          sessionId: 'session-new',
          filePath: '/tmp/transcripts/session-new.jsonl',
          fileSize: 500,
          lastModified: new Date('2026-03-18T10:00:00Z'),
        },
        {
          sessionId: 'session-old',
          filePath: '/tmp/transcripts/session-old.jsonl',
          fileSize: 500,
          lastModified: new Date('2026-03-10T10:00:00Z'),
        },
      ],
      sessionsIndexPath: null,
    });

    // Only set up the new session to return data
    mockParseTranscriptFile.mockImplementation(async (filePath: string) => {
      if (filePath.includes('session-new')) {
        return {
          session: {
            sessionId: 'session-new',
            startedAt: new Date('2026-03-18T10:00:00Z'),
            claudeCodeVersion: null,
            model: null,
            projectRoot: PROJECT_DIR,
            gitBranch: null,
          },
          toolCalls: [{
            toolName: 'Write',
            input: { file_path: configPath, content: '# New' },
            callId: 'call-new',
            callerType: 'unknown',
            requestId: 'req-new',
            isSidechain: false,
          }],
          toolResults: [],
          tasks: [],
          tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, completeness: 'exact', sessionsWithData: 1, sessionsTotal: 1 },
          messageTokens: [],
        };
      }
      return {
        session: {
          sessionId: 'session-old',
          startedAt: new Date('2026-03-10T10:00:00Z'),
          claudeCodeVersion: null,
          model: null,
          projectRoot: PROJECT_DIR,
          gitBranch: null,
        },
        toolCalls: [{
          toolName: 'Write',
          input: { file_path: configPath, content: '# Old' },
          callId: 'call-old',
          callerType: 'unknown',
          requestId: 'req-old',
          isSidechain: false,
        }],
        toolResults: [],
        tasks: [],
        tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, completeness: 'exact', sessionsWithData: 1, sessionsTotal: 1 },
        messageTokens: [],
      };
    });

    // Filter: only sessions after March 15
    const changes = await mineTranscriptConfigChanges(
      PROJECT_DIR,
      [configPath],
      '2026-03-15T00:00:00Z',
    );

    expect(changes).toHaveLength(1);
    expect(changes[0].sessionId).toBe('session-new');
  });

  it('handles parse failures gracefully', async () => {
    const configPath = join(PROJECT_DIR, 'CLAUDE.md');

    mockDiscoverTranscripts.mockResolvedValue({
      projectDir: '/tmp/transcripts',
      sessionFiles: [{
        sessionId: 'session-broken',
        filePath: '/tmp/transcripts/session-broken.jsonl',
        fileSize: 500,
        lastModified: new Date('2026-03-18T10:00:00Z'),
      }],
      sessionsIndexPath: null,
    });

    mockParseTranscriptFile.mockRejectedValue(new Error('Parse failed'));

    const changes = await mineTranscriptConfigChanges(PROJECT_DIR, [configPath]);
    expect(changes).toHaveLength(0);
  });

  it('returns changes sorted chronologically', async () => {
    const configPath = join(PROJECT_DIR, 'CLAUDE.md');

    mockDiscoverTranscripts.mockResolvedValue({
      projectDir: '/tmp/transcripts',
      sessionFiles: [
        {
          sessionId: 'session-b',
          filePath: '/tmp/transcripts/session-b.jsonl',
          fileSize: 500,
          lastModified: new Date('2026-03-18T10:00:00Z'),
        },
        {
          sessionId: 'session-a',
          filePath: '/tmp/transcripts/session-a.jsonl',
          fileSize: 500,
          lastModified: new Date('2026-03-16T10:00:00Z'),
        },
      ],
      sessionsIndexPath: null,
    });

    mockParseTranscriptFile.mockImplementation(async (filePath: string) => {
      const isB = filePath.includes('session-b');
      return {
        session: {
          sessionId: isB ? 'session-b' : 'session-a',
          startedAt: isB ? new Date('2026-03-18T10:00:00Z') : new Date('2026-03-16T10:00:00Z'),
          claudeCodeVersion: null,
          model: null,
          projectRoot: PROJECT_DIR,
          gitBranch: null,
        },
        toolCalls: [{
          toolName: 'Write' as const,
          input: { file_path: configPath, content: isB ? '# B' : '# A' },
          callId: isB ? 'call-b' : 'call-a',
          callerType: 'unknown',
          requestId: isB ? 'req-b' : 'req-a',
          isSidechain: false,
        }],
        toolResults: [],
        tasks: [],
        tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, completeness: 'exact', sessionsWithData: 1, sessionsTotal: 1 },
        messageTokens: [],
      };
    });

    const changes = await mineTranscriptConfigChanges(PROJECT_DIR, [configPath]);

    expect(changes).toHaveLength(2);
    // Should be oldest first
    expect(changes[0].sessionId).toBe('session-a');
    expect(changes[1].sessionId).toBe('session-b');
  });

  it('handles Write with file_text field variant', async () => {
    const configPath = join(PROJECT_DIR, 'CLAUDE.md');

    mockDiscoverTranscripts.mockResolvedValue({
      projectDir: '/tmp/transcripts',
      sessionFiles: [{
        sessionId: 'session-ft',
        filePath: '/tmp/transcripts/session-ft.jsonl',
        fileSize: 500,
        lastModified: new Date('2026-03-18T10:00:00Z'),
      }],
      sessionsIndexPath: null,
    });

    mockParseTranscriptFile.mockResolvedValue({
      session: {
        sessionId: 'session-ft',
        startedAt: new Date('2026-03-18T10:00:00Z'),
        claudeCodeVersion: null,
        model: null,
        projectRoot: PROJECT_DIR,
        gitBranch: null,
      },
      toolCalls: [{
        toolName: 'Write',
        input: { file_path: configPath, file_text: '# Alt field name' },
        callId: 'call-ft',
        callerType: 'unknown',
        requestId: 'req-ft',
        isSidechain: false,
      }],
      toolResults: [],
      tasks: [],
      tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, completeness: 'exact', sessionsWithData: 1, sessionsTotal: 1 },
      messageTokens: [],
    });

    const changes = await mineTranscriptConfigChanges(PROJECT_DIR, [configPath]);

    expect(changes).toHaveLength(1);
    expect(changes[0].content).toBe('# Alt field name');
  });
});
