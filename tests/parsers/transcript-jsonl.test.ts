import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseTranscriptContent,
  parseTranscriptFile,
  type TranscriptParseResult,
} from '../../src/parsers/transcript-jsonl.js';

const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'mock-transcripts');

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8');
}

describe('parseTranscriptContent', () => {
  describe('golden session', () => {
    let result: TranscriptParseResult;

    beforeAll(() => {
      result = parseTranscriptContent(loadFixture('golden-session.jsonl'), 'golden-session.jsonl');
    });

    it('extracts session metadata', () => {
      expect(result.session.sessionId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(result.session.claudeCodeVersion).toBe('2.1.61');
      expect(result.session.model).toBe('claude-sonnet-4-5-20250514');
      expect(result.session.projectRoot).toBe('/Users/dev/my-project');
      expect(result.session.gitBranch).toBe('fix/xss-login');
    });

    it('skips infrastructure lines', () => {
      expect(result.session.skippedLineTypes).toContain('queue-operation');
      expect(result.session.skippedLineTypes).toContain('file-history-snapshot');
    });

    it('parses correct number of events by kind', () => {
      const kinds = result.session.events.map((e) => e.kind);
      expect(kinds.filter((k) => k === 'user_prompt')).toHaveLength(1);
      expect(kinds.filter((k) => k === 'tool_call')).toHaveLength(3); // Read, Edit, Bash
      expect(kinds.filter((k) => k === 'tool_result')).toHaveLength(3);
      expect(kinds.filter((k) => k === 'assistant_text')).toHaveLength(2);
    });

    it('extracts tool calls with correct fields', () => {
      expect(result.toolCalls).toHaveLength(3);

      const readCall = result.toolCalls[0];
      expect(readCall.toolName).toBe('Read');
      expect(readCall.callId).toBe('toolu_read_001');
      expect(readCall.input).toHaveProperty('file_path', '/Users/dev/my-project/src/auth/login.ts');
      expect(readCall.callerType).toBe('direct');
      expect(readCall.isSidechain).toBe(false);

      const editCall = result.toolCalls[1];
      expect(editCall.toolName).toBe('Edit');
      expect(editCall.callId).toBe('toolu_edit_001');

      const bashCall = result.toolCalls[2];
      expect(bashCall.toolName).toBe('Bash');
      expect(bashCall.callId).toBe('toolu_bash_001');
    });

    it('extracts tool results linked to correct callIds', () => {
      expect(result.toolResults).toHaveLength(3);
      expect(result.toolResults[0].callId).toBe('toolu_read_001');
      expect(result.toolResults[1].callId).toBe('toolu_edit_001');
      expect(result.toolResults[2].callId).toBe('toolu_bash_001');
    });

    it('tool results have success status', () => {
      for (const tr of result.toolResults) {
        expect(tr.status).toBe('success');
      }
    });

    it('aggregates token usage correctly', () => {
      expect(result.tokenUsage.completeness).toBe('exact');
      // Sum of all assistant message input_tokens: 1250 + 1300 + 1400 + 1500 + 1600 = 7050
      expect(result.tokenUsage.inputTokens).toBe(7050);
      // Sum of output_tokens: 32 + 45 + 78 + 40 + 42 = 237
      expect(result.tokenUsage.outputTokens).toBe(237);
      // cache_creation_input_tokens: 45000 + 0 + 0 + 0 + 0 = 45000
      expect(result.tokenUsage.cacheCreationTokens).toBe(45000);
      // cache_read_input_tokens: 12000 + 57000 + 57500 + 58000 + 59000 = 243500
      expect(result.tokenUsage.cacheReadTokens).toBe(243500);
    });

    it('has exact completeness', () => {
      expect(result.session.completeness).toBe('exact');
    });

    it('segments into one task attempt', () => {
      expect(result.tasks).toHaveLength(1);
      const task = result.tasks[0];
      expect(task.prompt).toContain('XSS vulnerability');
      expect(task.outcome).toBe('success');
      expect(task.toolCalls).toHaveLength(3);
      expect(task.toolResults).toHaveLength(3);
    });

    it('sets timestamps correctly', () => {
      expect(result.session.startedAt).toEqual(new Date('2026-03-09T10:00:02.000Z'));
      expect(result.session.endedAt).toEqual(new Date('2026-03-09T10:00:22.000Z'));
    });
  });

  describe('malformed lines', () => {
    let result: TranscriptParseResult;

    beforeAll(() => {
      result = parseTranscriptContent(loadFixture('malformed-lines.jsonl'), 'malformed-lines.jsonl');
    });

    it('generates warnings for bad JSON', () => {
      const badJsonWarning = result.session.parseWarnings.find((w) => w.reason === 'Malformed JSON');
      expect(badJsonWarning).toBeDefined();
      expect(badJsonWarning!.line).toBe(2);
    });

    it('generates warnings for missing type field', () => {
      const missingTypeWarning = result.session.parseWarnings.find((w) =>
        w.reason.includes('Missing or invalid "type" field'),
      );
      expect(missingTypeWarning).toBeDefined();
      expect(missingTypeWarning!.line).toBe(3);
    });

    it('generates warnings for unknown type', () => {
      const unknownTypeWarning = result.session.parseWarnings.find((w) =>
        w.reason.includes('Unknown line type'),
      );
      expect(unknownTypeWarning).toBeDefined();
      expect(unknownTypeWarning!.line).toBe(4);
    });

    it('does NOT generate warning for empty line', () => {
      const emptyLineWarning = result.session.parseWarnings.find((w) => w.line === 5);
      expect(emptyLineWarning).toBeUndefined();
    });

    it('still parses valid lines correctly', () => {
      expect(result.session.events).toHaveLength(2); // user prompt + assistant text
      expect(result.session.sessionId).toBe('b2c3d4e5-f6a7-8901-bcde-f23456789012');
    });

    it('has damaged completeness (3 bad lines vs 2 conversation lines)', () => {
      // 3 failures / (2 + 3) = 60% > 25% threshold
      expect(result.session.completeness).toBe('damaged');
    });
  });

  describe('truncated session', () => {
    let result: TranscriptParseResult;

    beforeAll(() => {
      result = parseTranscriptContent(loadFixture('truncated-session.jsonl'), 'truncated-session.jsonl');
    });

    it('last task is interrupted', () => {
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].outcome).toBe('interrupted');
    });

    it('session has endedAt from last line', () => {
      expect(result.session.endedAt).toEqual(new Date('2026-03-09T12:00:06.000Z'));
    });

    it('has exact completeness (all lines parsed)', () => {
      expect(result.session.completeness).toBe('exact');
    });
  });

  describe('sidechain/delegation', () => {
    let result: TranscriptParseResult;

    beforeAll(() => {
      result = parseTranscriptContent(loadFixture('sidechain-session.jsonl'), 'sidechain-session.jsonl');
    });

    it('has sidechain events', () => {
      const sidechainEvents = result.session.events.filter((e) => e.isSidechain);
      expect(sidechainEvents.length).toBeGreaterThan(0);
    });

    it('extracts Task tool call with agent name', () => {
      const taskCall = result.toolCalls.find((tc) => tc.toolName === 'Task');
      expect(taskCall).toBeDefined();
      expect(taskCall!.input).toHaveProperty('agent', 'security-reviewer');
      expect(taskCall!.isSidechain).toBe(false);
    });

    it('sidechain tool calls are marked as sidechain', () => {
      const sidechainCalls = result.toolCalls.filter((tc) => tc.isSidechain);
      expect(sidechainCalls.length).toBeGreaterThan(0);
      expect(sidechainCalls[0].toolName).toBe('Read');
    });

    it('main chain events are not sidechain', () => {
      const mainEvents = result.session.events.filter((e) => !e.isSidechain);
      expect(mainEvents.length).toBeGreaterThan(0);
      // First and last events should be in the main chain
      expect(result.session.events[0].isSidechain).toBe(false);
    });

    it('has correct session metadata', () => {
      expect(result.session.sessionId).toBe('d4e5f6a7-b8c9-0123-defa-456789012345');
    });
  });

  describe('permission denied', () => {
    let result: TranscriptParseResult;

    beforeAll(() => {
      result = parseTranscriptContent(loadFixture('permission-denied.jsonl'), 'permission-denied.jsonl');
    });

    it('detects denied tool result', () => {
      const deniedResult = result.toolResults.find((tr) => tr.status === 'denied');
      expect(deniedResult).toBeDefined();
      expect(deniedResult!.callId).toBe('toolu_bash_040');
      expect(deniedResult!.errorKind).toBe('permission_denied');
    });

    it('task outcome reflects denial', () => {
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].outcome).toBe('failed');
    });
  });

  describe('no token metadata', () => {
    let result: TranscriptParseResult;

    beforeAll(() => {
      result = parseTranscriptContent(loadFixture('no-token-metadata.jsonl'), 'no-token-metadata.jsonl');
    });

    it('token usage completeness is estimated', () => {
      expect(result.tokenUsage.completeness).toBe('estimated');
    });

    it('all token counts are zero', () => {
      expect(result.tokenUsage.inputTokens).toBe(0);
      expect(result.tokenUsage.outputTokens).toBe(0);
      expect(result.tokenUsage.cacheCreationTokens).toBe(0);
      expect(result.tokenUsage.cacheReadTokens).toBe(0);
    });

    it('session still parses correctly', () => {
      expect(result.session.events.length).toBeGreaterThan(0);
      expect(result.session.sessionId).toBe('f6a7b8c9-d0e1-2345-fabc-678901234567');
    });
  });

  describe('content as string', () => {
    let result: TranscriptParseResult;

    beforeAll(() => {
      result = parseTranscriptContent(loadFixture('content-as-string.jsonl'), 'content-as-string.jsonl');
    });

    it('extracts user prompt text from string content', () => {
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].prompt).toBe('Fix the bug in auth.ts');
    });

    it('no parse warnings for string content', () => {
      expect(result.session.parseWarnings).toHaveLength(0);
    });

    it('correctly classifies events', () => {
      const kinds = result.session.events.map((e) => e.kind);
      expect(kinds).toContain('user_prompt');
      expect(kinds).toContain('assistant_text');
      expect(kinds).toContain('tool_call');
    });
  });

  describe('write-blindness data', () => {
    let result: TranscriptParseResult;

    beforeAll(() => {
      result = parseTranscriptContent(loadFixture('write-blindness.jsonl'), 'write-blindness.jsonl');
    });

    it('extracts Edit on Button.tsx (no preceding Read)', () => {
      const editCalls = result.toolCalls.filter((tc) => tc.toolName === 'Edit');
      expect(editCalls.length).toBe(2);
      const buttonEdit = editCalls.find(
        (tc) => (tc.input as Record<string, string>).file_path?.includes('Button.tsx'),
      );
      expect(buttonEdit).toBeDefined();
    });

    it('extracts Read on Header.tsx (preceding its Edit)', () => {
      const readCalls = result.toolCalls.filter((tc) => tc.toolName === 'Read');
      expect(readCalls).toHaveLength(1);
      expect((readCalls[0].input as Record<string, string>).file_path).toContain('Header.tsx');
    });

    it('can identify files Read vs Edited from tool call inputs', () => {
      const readFiles = result.toolCalls
        .filter((tc) => tc.toolName === 'Read')
        .map((tc) => (tc.input as Record<string, string>).file_path);
      const editFiles = result.toolCalls
        .filter((tc) => tc.toolName === 'Edit')
        .map((tc) => (tc.input as Record<string, string>).file_path);

      expect(readFiles).toContain('/Users/dev/app/src/components/Header.tsx');
      expect(readFiles).not.toContain('/Users/dev/app/src/components/Button.tsx');
      expect(editFiles).toContain('/Users/dev/app/src/components/Button.tsx');
      expect(editFiles).toContain('/Users/dev/app/src/components/Header.tsx');
    });
  });

  describe('error in last call', () => {
    let result: TranscriptParseResult;

    beforeAll(() => {
      result = parseTranscriptContent(loadFixture('error-in-last-call.jsonl'), 'error-in-last-call.jsonl');
    });

    it('has two tasks (two user prompts)', () => {
      expect(result.tasks).toHaveLength(2);
    });

    it('first task has error tool result', () => {
      const firstTask = result.tasks[0];
      const errorResult = firstTask.toolResults.find((tr) => tr.status === 'error');
      expect(errorResult).toBeDefined();
    });

    it('second task is interrupted (no completion)', () => {
      expect(result.tasks[1].outcome).toBe('interrupted');
      expect(result.tasks[1].prompt).toContain('Fix the failing test');
    });

    it('error content is accessible from tool result', () => {
      const errorResults = result.toolResults.filter((tr) => tr.status === 'error');
      expect(errorResults.length).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('empty string produces damaged session', () => {
      const result = parseTranscriptContent('', 'empty.jsonl');
      expect(result.session.events).toHaveLength(0);
      expect(result.session.completeness).toBe('damaged');
      expect(result.tasks).toHaveLength(0);
    });

    it('single user prompt with no response is interrupted', () => {
      const line = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
        uuid: 'u999',
        parentUuid: null,
        isSidechain: false,
        sessionId: 'sess-999',
        version: '2.1.61',
        cwd: '/tmp',
        gitBranch: 'main',
        timestamp: '2026-03-09T20:00:00.000Z',
      });

      const result = parseTranscriptContent(line, 'single.jsonl');
      expect(result.session.events).toHaveLength(1);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].outcome).toBe('interrupted');
      expect(result.tasks[0].prompt).toBe('Hello');
    });

    it('only infrastructure lines produces damaged session', () => {
      const content = [
        '{"type":"queue-operation","operation":"enqueue","sessionId":"s1","timestamp":"2026-03-09T10:00:00.000Z"}',
        '{"type":"file-history-snapshot","files":[],"sessionId":"s1","timestamp":"2026-03-09T10:00:01.000Z"}',
      ].join('\n');

      const result = parseTranscriptContent(content, 'infra-only.jsonl');
      expect(result.session.events).toHaveLength(0);
      expect(result.session.completeness).toBe('damaged');
      expect(result.session.skippedLineTypes).toContain('queue-operation');
      expect(result.session.skippedLineTypes).toContain('file-history-snapshot');
    });

    it('mixed text and tool_use in one assistant message classifies as tool_call', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          model: 'claude-sonnet-4-5-20250514',
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me read that file.' },
            { type: 'tool_use', id: 'toolu_mix', name: 'Read', input: { file_path: '/tmp/f.ts' }, caller: { type: 'direct' } },
          ],
          stop_reason: 'tool_use',
        },
        uuid: 'a-mix',
        parentUuid: null,
        isSidechain: false,
        sessionId: 'sess-mix',
        version: '2.1.61',
        cwd: '/tmp',
        gitBranch: 'main',
        timestamp: '2026-03-09T21:00:00.000Z',
        requestId: 'req_mix',
      });

      const result = parseTranscriptContent(line, 'mixed.jsonl');
      expect(result.session.events[0].kind).toBe('tool_call');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].toolName).toBe('Read');
    });
  });
});

describe('parseTranscriptFile', () => {
  it('reads golden-session.jsonl from disk with same results', async () => {
    const filePath = join(FIXTURES_DIR, 'golden-session.jsonl');
    const fileResult = await parseTranscriptFile(filePath);
    const contentResult = parseTranscriptContent(loadFixture('golden-session.jsonl'), filePath);

    expect(fileResult.session.sessionId).toBe(contentResult.session.sessionId);
    expect(fileResult.session.events).toHaveLength(contentResult.session.events.length);
    expect(fileResult.toolCalls).toHaveLength(contentResult.toolCalls.length);
    expect(fileResult.toolResults).toHaveLength(contentResult.toolResults.length);
    expect(fileResult.tasks).toHaveLength(contentResult.tasks.length);
    expect(fileResult.session.completeness).toBe(contentResult.session.completeness);
    expect(fileResult.tokenUsage.inputTokens).toBe(contentResult.tokenUsage.inputTokens);
  });

  describe('teamName extraction', () => {
    it('extracts team_name from Task tool calls', () => {
      const content = [
        JSON.stringify({ type: 'user', uuid: 'u1', sessionId: 's1', timestamp: '2026-03-09T10:00:00Z', message: { role: 'user', content: [{ type: 'text', text: 'Build the feature' }] } }),
        JSON.stringify({ type: 'assistant', uuid: 'a1', timestamp: '2026-03-09T10:00:01Z', message: { role: 'assistant', model: 'claude-sonnet-4-5-20250514', content: [{ type: 'tool_use', id: 'toolu_task_001', name: 'Task', input: { prompt: 'implement backend', team_name: 'feature-auth', name: 'backend-agent' } }], usage: { input_tokens: 100, output_tokens: 50 } } }),
      ].join('\n');

      const result = parseTranscriptContent(content, 'test.jsonl');

      const taskCall = result.toolCalls.find((tc) => tc.toolName === 'Task');
      expect(taskCall).toBeDefined();
      expect(taskCall!.teamName).toBe('feature-auth');
    });

    it('does not set teamName on regular Task tool calls', () => {
      const content = [
        JSON.stringify({ type: 'user', uuid: 'u1', sessionId: 's1', timestamp: '2026-03-09T10:00:00Z', message: { role: 'user', content: [{ type: 'text', text: 'Research something' }] } }),
        JSON.stringify({ type: 'assistant', uuid: 'a1', timestamp: '2026-03-09T10:00:01Z', message: { role: 'assistant', model: 'claude-sonnet-4-5-20250514', content: [{ type: 'tool_use', id: 'toolu_task_002', name: 'Task', input: { prompt: 'research', subagent_type: 'general-purpose' } }], usage: { input_tokens: 100, output_tokens: 50 } } }),
      ].join('\n');

      const result = parseTranscriptContent(content, 'test.jsonl');

      const taskCall = result.toolCalls.find((tc) => tc.toolName === 'Task');
      expect(taskCall).toBeDefined();
      expect(taskCall!.teamName).toBeUndefined();
    });

    it('does not set teamName on non-Task tool calls', () => {
      const content = [
        JSON.stringify({ type: 'user', uuid: 'u1', sessionId: 's1', timestamp: '2026-03-09T10:00:00Z', message: { role: 'user', content: [{ type: 'text', text: 'Read a file' }] } }),
        JSON.stringify({ type: 'assistant', uuid: 'a1', timestamp: '2026-03-09T10:00:01Z', message: { role: 'assistant', model: 'claude-sonnet-4-5-20250514', content: [{ type: 'tool_use', id: 'toolu_read_001', name: 'Read', input: { file_path: '/src/foo.ts' } }], usage: { input_tokens: 100, output_tokens: 50 } } }),
      ].join('\n');

      const result = parseTranscriptContent(content, 'test.jsonl');

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].teamName).toBeUndefined();
    });
  });
});
