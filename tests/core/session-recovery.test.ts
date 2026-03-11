import { describe, it, expect } from 'vitest';
import { assessRecovery, cleanPromptText, normalizePathsInText } from '../../src/core/session-recovery.js';
import type { TranscriptParseResult } from '../../src/parsers/transcript-jsonl.js';
import type {
  TranscriptSession,
  TaskAttempt,
  ToolCall,
  ToolResult,
  UsageSummary,
} from '../../src/types/transcript.js';

// ---- Helpers to build mock data ----

function makeSession(overrides: Partial<TranscriptSession> = {}): TranscriptSession {
  return {
    sessionId: 'abc12345-6789-0123-4567-890123456789',
    claudeCodeVersion: '2.1.61',
    model: 'claude-sonnet-4-5-20250514',
    projectRoot: '/Users/dev/project',
    gitBranch: 'main',
    startedAt: new Date('2026-03-09T14:00:00.000Z'),
    endedAt: new Date('2026-03-09T14:47:00.000Z'),
    sourceFile: '/tmp/test.jsonl',
    events: [],
    parseWarnings: [],
    completeness: 'exact',
    skippedLineTypes: [],
    ...overrides,
  };
}

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolName: 'Bash',
    input: { command: 'npm test' },
    callId: 'toolu_001',
    callerType: 'direct',
    requestId: 'req_001',
    isSidechain: false,
    ...overrides,
  };
}

function makeToolResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    callId: 'toolu_001',
    sourceToolAssistantUUID: 'a001',
    status: 'success',
    toolUseResult: {},
    ...overrides,
  };
}

function makeTask(overrides: Partial<TaskAttempt> = {}): TaskAttempt {
  return {
    prompt: 'Fix the bug in login.ts',
    startedAt: new Date('2026-03-09T14:30:00.000Z'),
    endedAt: new Date('2026-03-09T14:35:00.000Z'),
    toolCalls: [],
    toolResults: [],
    outcome: 'success',
    ...overrides,
  };
}

function makeUsage(): UsageSummary {
  return {
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cache5mTokens: 0,
    cache1hTokens: 0,
    completeness: 'exact',
    sessionsWithData: 1,
    sessionsTotal: 1,
  };
}

function makeParseResult(overrides: Partial<TranscriptParseResult> = {}): TranscriptParseResult {
  return {
    session: makeSession(),
    toolCalls: [],
    toolResults: [],
    tasks: [makeTask()],
    tokenUsage: makeUsage(),
    ...overrides,
  };
}

// ---- Tests ----

describe('assessRecovery', () => {
  it('returns complete status for successful last task', () => {
    const result = makeParseResult({
      tasks: [makeTask({ outcome: 'success' })],
    });

    const assessment = assessRecovery(result);

    expect(assessment.status).toBe('complete');
    expect(assessment.sessionId).toBe('abc12345-6789-0123-4567-890123456789');
    expect(assessment.recoveryPrompt).toContain('completed successfully');
  });

  it('returns incomplete status for interrupted last task', () => {
    const result = makeParseResult({
      tasks: [makeTask({ outcome: 'interrupted', endedAt: undefined })],
    });

    const assessment = assessRecovery(result);

    expect(assessment.status).toBe('incomplete');
    expect(assessment.lastTask).not.toBeNull();
    expect(assessment.lastTask!.prompt).toBe('Fix the bug in login.ts');
    expect(assessment.recoveryPrompt).toContain('session ended before');
  });

  it('returns failed status with error info when last task failed', () => {
    const tc = makeToolCall({ callId: 'toolu_fail', toolName: 'Bash', input: { command: 'npm test' } });
    const tr = makeToolResult({
      callId: 'toolu_fail',
      status: 'error',
      errorKind: 'tool_error',
      toolUseResult: { stderr: 'FAIL src/auth/login.test.ts\nExpected sanitizeHtml to be called' },
    });

    const task = makeTask({
      outcome: 'failed',
      toolCalls: [tc],
      toolResults: [tr],
    });

    const result = makeParseResult({
      tasks: [task],
      toolCalls: [tc],
      toolResults: [tr],
    });

    const assessment = assessRecovery(result);

    expect(assessment.status).toBe('failed');
    expect(assessment.lastError).not.toBeNull();
    expect(assessment.lastError!.toolName).toBe('Bash');
    expect(assessment.lastError!.command).toBe('npm test');
    expect(assessment.lastError!.errorMessage).toContain('FAIL src/auth/login.test.ts');
    expect(assessment.recoveryPrompt).toContain('npm test');
    expect(assessment.recoveryPrompt).toContain('FAIL');
  });

  it('returns damaged status for corrupted session', () => {
    const result = makeParseResult({
      session: makeSession({ completeness: 'damaged' }),
      tasks: [],
    });

    const assessment = assessRecovery(result);

    expect(assessment.status).toBe('damaged');
    expect(assessment.recoveryPrompt).toContain('damaged');
  });

  it('extracts last checkpoint from successful tool result — test pass', () => {
    const tcSuccess = makeToolCall({ callId: 'toolu_pass', toolName: 'Bash', input: { command: 'npm test' } });
    const trSuccess = makeToolResult({ callId: 'toolu_pass', status: 'success' });
    const tcFail = makeToolCall({ callId: 'toolu_fail', toolName: 'Bash', input: { command: 'npm run build' } });
    const trFail = makeToolResult({ callId: 'toolu_fail', status: 'error', toolUseResult: { stderr: 'build error' } });

    const task = makeTask({
      outcome: 'failed',
      toolCalls: [tcSuccess, tcFail],
      toolResults: [trSuccess, trFail],
    });

    const result = makeParseResult({
      tasks: [task],
      toolCalls: [tcSuccess, tcFail],
    });

    const assessment = assessRecovery(result);

    expect(assessment.lastCheckpoint).not.toBeNull();
    expect(assessment.lastCheckpoint!.description).toContain('Tests passed');
    expect(assessment.lastCheckpoint!.toolName).toBe('Bash');
  });

  it('extracts last checkpoint from Write tool call', () => {
    const tc = makeToolCall({
      callId: 'toolu_write',
      toolName: 'Write',
      input: { file_path: '/Users/dev/project/src/app.ts' },
    });
    const tr = makeToolResult({ callId: 'toolu_write', status: 'success' });

    const task = makeTask({
      outcome: 'incomplete',
      toolCalls: [tc],
      toolResults: [tr],
    });

    const result = makeParseResult({
      tasks: [task],
      toolCalls: [tc],
    });

    const assessment = assessRecovery(result);

    expect(assessment.lastCheckpoint).not.toBeNull();
    expect(assessment.lastCheckpoint!.description).toContain('app.ts');
  });

  it('extracts modified files from Edit/Write tool calls', () => {
    const tc1 = makeToolCall({
      callId: 'toolu_e1',
      toolName: 'Edit',
      input: { file_path: '/Users/dev/project/src/auth/login.ts' },
    });
    const tc2 = makeToolCall({
      callId: 'toolu_e2',
      toolName: 'Edit',
      input: { file_path: '/Users/dev/project/src/auth/sanitize.ts' },
    });
    const tc3 = makeToolCall({
      callId: 'toolu_w1',
      toolName: 'Write',
      input: { file_path: '/Users/dev/project/src/auth/utils.ts' },
    });

    const task = makeTask({
      outcome: 'interrupted',
      toolCalls: [tc1, tc2, tc3],
    });

    const result = makeParseResult({ tasks: [task] });

    const assessment = assessRecovery(result, '/Users/dev/project');

    expect(assessment.lastTask).not.toBeNull();
    expect(assessment.lastTask!.filesModified).toContain('src/auth/login.ts');
    expect(assessment.lastTask!.filesModified).toContain('src/auth/sanitize.ts');
    expect(assessment.lastTask!.filesModified).toContain('src/auth/utils.ts');
    expect(assessment.lastTask!.filesModified).toHaveLength(3);
  });

  it('extracts read files from Read tool calls', () => {
    const tc = makeToolCall({
      callId: 'toolu_r1',
      toolName: 'Read',
      input: { file_path: '/Users/dev/project/src/auth/login.test.ts' },
    });

    const task = makeTask({
      outcome: 'success',
      toolCalls: [tc],
    });

    const result = makeParseResult({ tasks: [task] });

    const assessment = assessRecovery(result, '/Users/dev/project');

    expect(assessment.lastTask!.filesRead).toContain('src/auth/login.test.ts');
  });

  it('handles empty session (no tasks) gracefully', () => {
    const result = makeParseResult({ tasks: [] });

    const assessment = assessRecovery(result);

    expect(assessment.status).toBe('complete');
    expect(assessment.lastTask).toBeNull();
    expect(assessment.lastCheckpoint).toBeNull();
    expect(assessment.lastError).toBeNull();
    expect(assessment.recoveryPrompt).toBeDefined();
  });

  it('normalizes file paths to project-relative', () => {
    const tc = makeToolCall({
      callId: 'toolu_e1',
      toolName: 'Edit',
      input: { file_path: '/Users/dev/project/src/index.ts' },
    });

    const task = makeTask({ outcome: 'success', toolCalls: [tc] });
    const result = makeParseResult({ tasks: [task] });

    const assessment = assessRecovery(result, '/Users/dev/project');

    expect(assessment.lastTask!.filesModified).toContain('src/index.ts');
    // Recovery prompt should also use relative paths
    expect(assessment.recoveryPrompt).not.toContain('/Users/dev/project/');
  });

  it('truncates long error messages to 300 chars', () => {
    const longError = 'E'.repeat(500);
    const tc = makeToolCall({ callId: 'toolu_err' });
    const tr = makeToolResult({
      callId: 'toolu_err',
      status: 'error',
      toolUseResult: { stderr: longError },
    });

    const task = makeTask({
      outcome: 'failed',
      toolCalls: [tc],
      toolResults: [tr],
    });

    const result = makeParseResult({
      tasks: [task],
      toolCalls: [tc],
    });

    const assessment = assessRecovery(result);

    expect(assessment.lastError).not.toBeNull();
    // 300 chars + "…"
    expect(assessment.lastError!.errorMessage.length).toBeLessThanOrEqual(301);
  });

  it('uses partial outcome as incomplete status', () => {
    const result = makeParseResult({
      tasks: [makeTask({ outcome: 'partial' })],
    });

    const assessment = assessRecovery(result);

    expect(assessment.status).toBe('incomplete');
  });

  it('uses unknown outcome as incomplete status', () => {
    const result = makeParseResult({
      tasks: [makeTask({ outcome: 'unknown' })],
    });

    const assessment = assessRecovery(result);

    expect(assessment.status).toBe('incomplete');
  });

  it('recovery prompt includes file list when files were modified', () => {
    const tc = makeToolCall({
      callId: 'toolu_e1',
      toolName: 'Edit',
      input: { file_path: 'src/app.ts' },
    });

    const task = makeTask({
      outcome: 'incomplete',
      toolCalls: [tc],
    });

    const result = makeParseResult({ tasks: [task] });

    const assessment = assessRecovery(result);

    expect(assessment.recoveryPrompt).toContain('src/app.ts');
    expect(assessment.recoveryPrompt).toContain('Files modified');
  });

  it('deduplicates file paths when same file is edited multiple times', () => {
    const tc1 = makeToolCall({
      callId: 'toolu_e1',
      toolName: 'Edit',
      input: { file_path: '/Users/dev/project/src/app.ts' },
    });
    const tc2 = makeToolCall({
      callId: 'toolu_e2',
      toolName: 'Edit',
      input: { file_path: '/Users/dev/project/src/app.ts' },
    });

    const task = makeTask({
      outcome: 'success',
      toolCalls: [tc1, tc2],
    });

    const result = makeParseResult({ tasks: [task] });

    const assessment = assessRecovery(result, '/Users/dev/project');

    expect(assessment.lastTask!.filesModified).toHaveLength(1);
    expect(assessment.lastTask!.filesModified[0]).toBe('src/app.ts');
  });

  it('checkpoint for git commit', () => {
    const tc = makeToolCall({
      callId: 'toolu_gc',
      toolName: 'Bash',
      input: { command: 'git commit -m "fix: login bug"' },
    });
    const tr = makeToolResult({ callId: 'toolu_gc', status: 'success' });

    const task = makeTask({
      outcome: 'success',
      toolCalls: [tc],
      toolResults: [tr],
    });

    const result = makeParseResult({ tasks: [task], toolCalls: [tc] });

    const assessment = assessRecovery(result);

    expect(assessment.lastCheckpoint!.description).toContain('Git commit');
  });

  it('checkpoint for build success', () => {
    const tc = makeToolCall({
      callId: 'toolu_build',
      toolName: 'Bash',
      input: { command: 'npm run build' },
    });
    const tr = makeToolResult({ callId: 'toolu_build', status: 'success' });

    const task = makeTask({
      outcome: 'success',
      toolCalls: [tc],
      toolResults: [tr],
    });

    const result = makeParseResult({ tasks: [task], toolCalls: [tc] });

    const assessment = assessRecovery(result);

    expect(assessment.lastCheckpoint!.description).toContain('Build succeeded');
  });

  it('handles denied tool result in error extraction', () => {
    const tc = makeToolCall({
      callId: 'toolu_denied',
      toolName: 'Bash',
      input: { command: 'rm -rf /' },
    });
    const tr = makeToolResult({
      callId: 'toolu_denied',
      status: 'denied',
      errorKind: 'permission_denied',
      toolUseResult: { error: 'Permission denied by user' },
    });

    const task = makeTask({
      outcome: 'failed',
      toolCalls: [tc],
      toolResults: [tr],
    });

    const result = makeParseResult({
      tasks: [task],
      toolCalls: [tc],
    });

    const assessment = assessRecovery(result);

    expect(assessment.status).toBe('failed');
    expect(assessment.lastError).not.toBeNull();
    expect(assessment.lastError!.errorMessage).toContain('Permission denied');
  });

  it('strips <ide_opened_file> tags from last task prompt', () => {
    const task = makeTask({
      outcome: 'success',
      prompt: '<ide_opened_file>The user opened the file /Users/dev/project/CLAUDE.md in the IDE.</ide_opened_file> Fix the linting errors',
    });

    const result = makeParseResult({ tasks: [task] });
    const assessment = assessRecovery(result);

    expect(assessment.lastTask!.prompt).toBe('Fix the linting errors');
    expect(assessment.lastTask!.prompt).not.toContain('ide_opened_file');
    expect(assessment.recoveryPrompt).not.toContain('ide_opened_file');
  });

  it('uses fallback when prompt is only an IDE tag', () => {
    const task = makeTask({
      outcome: 'success',
      prompt: '<ide_opened_file>The user opened the file /Users/dev/project/CLAUDE.md in the IDE.</ide_opened_file>',
    });

    const result = makeParseResult({ tasks: [task] });
    const assessment = assessRecovery(result);

    expect(assessment.lastTask!.prompt).toBe('(IDE-initiated session)');
  });

  it('normalizes absolute project paths in prompt text', () => {
    const task = makeTask({
      outcome: 'incomplete',
      prompt: 'Fix the bug in /Users/dev/project/src/auth/login.ts and update /Users/dev/project/src/auth/utils.ts',
    });

    const result = makeParseResult({ tasks: [task] });
    const assessment = assessRecovery(result, '/Users/dev/project');

    expect(assessment.lastTask!.prompt).toBe('Fix the bug in src/auth/login.ts and update src/auth/utils.ts');
    expect(assessment.lastTask!.prompt).not.toContain('/Users/dev/project/');
    expect(assessment.recoveryPrompt).not.toContain('/Users/dev/project/');
  });
});

describe('cleanPromptText', () => {
  it('strips <ide_opened_file> tags', () => {
    const input = '<ide_opened_file>The user opened file.ts</ide_opened_file> Do the task';
    expect(cleanPromptText(input)).toBe('Do the task');
  });

  it('strips <ide_selection> tags', () => {
    const input = '<ide_selection>some selected code</ide_selection> Refactor this';
    expect(cleanPromptText(input)).toBe('Refactor this');
  });

  it('strips multiple tags', () => {
    const input = '<ide_opened_file>file.ts</ide_opened_file> <ide_selection>code</ide_selection> Fix it';
    expect(cleanPromptText(input)).toBe('Fix it');
  });

  it('returns fallback when only tags remain', () => {
    const input = '<ide_opened_file>The user opened file.ts</ide_opened_file>';
    expect(cleanPromptText(input)).toBe('(IDE-initiated session)');
  });

  it('returns unchanged text when no tags present', () => {
    expect(cleanPromptText('Fix the bug')).toBe('Fix the bug');
  });

  it('returns fallback for empty string', () => {
    expect(cleanPromptText('')).toBe('(IDE-initiated session)');
  });
});

describe('normalizePathsInText', () => {
  it('replaces project root prefix with relative path', () => {
    const text = 'Edit /Users/dev/project/src/app.ts';
    expect(normalizePathsInText(text, '/Users/dev/project')).toBe('Edit src/app.ts');
  });

  it('replaces home directory with ~/', () => {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (home) {
      const text = `Check ${home}/some/file.ts`;
      expect(normalizePathsInText(text)).toContain('~/some/file.ts');
    }
  });

  it('returns unchanged text when no paths match', () => {
    expect(normalizePathsInText('Fix the bug', '/Users/dev/project')).toBe('Fix the bug');
  });

  it('handles multiple paths in same text', () => {
    const text = 'Compare /proj/a.ts and /proj/b.ts';
    expect(normalizePathsInText(text, '/proj')).toBe('Compare a.ts and b.ts');
  });
});
