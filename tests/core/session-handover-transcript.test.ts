import { describe, it, expect } from 'vitest';
import { renderHandover } from '../../src/core/session-handover-renderer.js';
import type {
  HandoverResult,
  TranscriptHandoverData,
  TranscriptTaskSummary,
} from '../../src/core/session-handover.js';
import { parseDuration, formatDuration } from '../../src/core/session-handover.js';
import type { UsageSummary } from '../../src/types/transcript.js';

// ---- Helpers ----

function makeBaseResult(overrides: Partial<HandoverResult> = {}): HandoverResult {
  return {
    timestamp: '2026-03-10T14:00:00.000Z',
    projectName: 'test-project',
    branch: 'main',
    completedWork: [],
    uncommittedChanges: [],
    testResult: null,
    typecheckResult: null,
    smellsResult: null,
    todos: [],
    suggestedPrompt: 'All quality gates passing.',
    ...overrides,
  };
}

function makeTask(overrides: Partial<TranscriptTaskSummary> = {}): TranscriptTaskSummary {
  return {
    outcome: 'success',
    description: 'Implement feature X',
    filesEdited: 3,
    toolCallCount: 12,
    ...overrides,
  };
}

function makeTokenUsage(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    inputTokens: 45200,
    outputTokens: 12800,
    cacheReadTokens: 35000,
    cacheCreationTokens: 10000,
    cache5mTokens: 0,
    cache1hTokens: 0,
    completeness: 'exact',
    sessionsWithData: 1,
    sessionsTotal: 1,
    ...overrides,
  };
}

function makeTranscriptData(overrides: Partial<TranscriptHandoverData> = {}): TranscriptHandoverData {
  return {
    sessionSummary: {
      sessionId: 'abc-123',
      durationMinutes: 47,
      model: 'claude-sonnet-4-5',
      turnCount: 3,
      toolCallCount: 45,
      compactionCount: 0,
    },
    tokenUsage: makeTokenUsage(),
    tasks: [makeTask()],
    toolUsage: [
      { name: 'Edit', count: 12 },
      { name: 'Read', count: 8 },
      { name: 'Bash', count: 5 },
    ],
    gitCorrelation: {
      claudeModified: ['src/core/scanner.ts'],
      manualEdits: ['CLAUDE.md'],
      reverted: [],
    },
    suggestedPrompt: 'The session completed successfully. Continue with the next planned task.',
    ...overrides,
  };
}

// ---- Tests ----

describe('session-handover-transcript', () => {
  describe('backward compatibility — without --transcript', () => {
    it('renders identically when no transcriptData is present', () => {
      const result = makeBaseResult();
      const md = renderHandover(result);

      expect(md).toContain('# Session Status');
      expect(md).toContain('## Completed Work');
      expect(md).not.toContain('## Session Summary');
      expect(md).not.toContain('## Tasks Attempted');
      expect(md).not.toContain('## Tool Usage');
      expect(md).not.toContain('## Git Correlation');
    });
  });

  describe('session summary section', () => {
    it('renders duration, model, turns, and tool calls', () => {
      const result = makeBaseResult({
        transcriptData: makeTranscriptData(),
      });
      const md = renderHandover(result);

      expect(md).toContain('## Session Summary');
      expect(md).toContain('47 min');
      expect(md).toContain('claude-sonnet-4-5');
      expect(md).toContain('3 turns');
      expect(md).toContain('45 tool calls');
    });

    it('renders token usage when available', () => {
      const result = makeBaseResult({
        transcriptData: makeTranscriptData(),
      });
      const md = renderHandover(result);

      expect(md).toContain('~45.2K input');
      expect(md).toContain('~12.8K output');
    });

    it('omits token line when no token data', () => {
      const result = makeBaseResult({
        transcriptData: makeTranscriptData({ tokenUsage: null }),
      });
      const md = renderHandover(result);

      expect(md).toContain('## Session Summary');
      expect(md).not.toContain('Tokens:');
    });

    it('renders compaction count', () => {
      const result = makeBaseResult({
        transcriptData: makeTranscriptData({
          sessionSummary: {
            sessionId: 'abc-123',
            durationMinutes: 47,
            model: 'claude-sonnet-4-5',
            turnCount: 3,
            toolCallCount: 45,
            compactionCount: 2,
          },
        }),
      });
      const md = renderHandover(result);

      expect(md).toContain('Context compactions: 2');
    });

    it('handles unknown model', () => {
      const result = makeBaseResult({
        transcriptData: makeTranscriptData({
          sessionSummary: {
            sessionId: 'abc-123',
            durationMinutes: 5,
            model: null,
            turnCount: 1,
            toolCallCount: 3,
            compactionCount: 0,
          },
        }),
      });
      const md = renderHandover(result);

      expect(md).toContain('Model: unknown');
    });

    it('uses singular for 1 turn and 1 tool call', () => {
      const result = makeBaseResult({
        transcriptData: makeTranscriptData({
          sessionSummary: {
            sessionId: 'abc-123',
            durationMinutes: 2,
            model: 'claude-sonnet-4-5',
            turnCount: 1,
            toolCallCount: 1,
            compactionCount: 0,
          },
        }),
      });
      const md = renderHandover(result);

      expect(md).toContain('1 turn');
      expect(md).toContain('1 tool call');
      expect(md).not.toContain('1 turns');
      expect(md).not.toContain('1 tool calls');
    });
  });

  describe('task narrative', () => {
    it('renders tasks with outcome icons', () => {
      const result = makeBaseResult({
        transcriptData: makeTranscriptData({
          tasks: [
            makeTask({ outcome: 'success', description: 'Implement auth module' }),
            makeTask({ outcome: 'failed', description: 'Fix XSS vulnerability' }),
            makeTask({ outcome: 'interrupted', description: 'Add rate limiting' }),
          ],
        }),
      });
      const md = renderHandover(result);

      expect(md).toContain('## Tasks Attempted');
      expect(md).toContain('\u2705 Implement auth module');
      expect(md).toContain('\u274c Fix XSS vulnerability');
      expect(md).toContain('\u23f8\ufe0f Add rate limiting');
    });

    it('renders file count and tool call count per task', () => {
      const result = makeBaseResult({
        transcriptData: makeTranscriptData({
          tasks: [makeTask({ filesEdited: 4, toolCallCount: 23 })],
        }),
      });
      const md = renderHandover(result);

      expect(md).toContain('4 files edited, 23 tool calls');
    });

    it('renders singular for 1 file', () => {
      const result = makeBaseResult({
        transcriptData: makeTranscriptData({
          tasks: [makeTask({ filesEdited: 1, toolCallCount: 5 })],
        }),
      });
      const md = renderHandover(result);

      expect(md).toContain('1 file edited');
      expect(md).not.toContain('1 files');
    });

    it('renders no files edited', () => {
      const result = makeBaseResult({
        transcriptData: makeTranscriptData({
          tasks: [makeTask({ filesEdited: 0, toolCallCount: 3 })],
        }),
      });
      const md = renderHandover(result);

      expect(md).toContain('no files edited');
    });

    it('omits tasks section when no tasks', () => {
      const result = makeBaseResult({
        transcriptData: makeTranscriptData({ tasks: [] }),
      });
      const md = renderHandover(result);

      expect(md).not.toContain('## Tasks Attempted');
    });
  });

  describe('tool usage', () => {
    it('renders tool usage as inline list', () => {
      const result = makeBaseResult({
        transcriptData: makeTranscriptData(),
      });
      const md = renderHandover(result);

      expect(md).toContain('## Tool Usage');
      expect(md).toContain('Edit: 12');
      expect(md).toContain('Read: 8');
      expect(md).toContain('Bash: 5');
    });

    it('omits tool usage when empty', () => {
      const result = makeBaseResult({
        transcriptData: makeTranscriptData({ toolUsage: [] }),
      });
      const md = renderHandover(result);

      expect(md).not.toContain('## Tool Usage');
    });
  });

  describe('git correlation', () => {
    it('renders Claude-modified, manual edits, and reverted', () => {
      const result = makeBaseResult({
        transcriptData: makeTranscriptData({
          gitCorrelation: {
            claudeModified: ['src/core/scanner.ts', 'src/core/linter.ts'],
            manualEdits: ['CLAUDE.md'],
            reverted: ['src/temp.ts'],
          },
        }),
      });
      const md = renderHandover(result);

      expect(md).toContain('## Git Correlation');
      expect(md).toContain('Claude-modified:  src/core/scanner.ts, src/core/linter.ts');
      expect(md).toContain('Manual edits:     CLAUDE.md');
      expect(md).toContain('Reverted:         src/temp.ts');
    });

    it('shows (none) for empty categories when others have data', () => {
      const result = makeBaseResult({
        transcriptData: makeTranscriptData({
          gitCorrelation: {
            claudeModified: ['src/core/scanner.ts'],
            manualEdits: [],
            reverted: [],
          },
        }),
      });
      const md = renderHandover(result);

      expect(md).toContain('Claude-modified:  src/core/scanner.ts');
      expect(md).toContain('Manual edits:     (none)');
      expect(md).toContain('Reverted:         (none)');
    });

    it('omits git correlation when all empty', () => {
      const result = makeBaseResult({
        transcriptData: makeTranscriptData({
          gitCorrelation: {
            claudeModified: [],
            manualEdits: [],
            reverted: [],
          },
        }),
      });
      const md = renderHandover(result);

      expect(md).not.toContain('## Git Correlation');
    });
  });

  describe('suggested next prompt', () => {
    it('uses transcript-derived prompt when available', () => {
      const result = makeBaseResult({
        suggestedPrompt: 'All quality gates passing.',
        transcriptData: makeTranscriptData({
          suggestedPrompt: 'Continue the interrupted task: "Fix login bug"',
        }),
      });
      const md = renderHandover(result);

      expect(md).toContain('> Continue the interrupted task: "Fix login bug"');
      // The git-based prompt should NOT be used
      expect(md).not.toContain('> All quality gates passing.');
    });
  });

  describe('section ordering', () => {
    it('places transcript sections before git/test sections', () => {
      const result = makeBaseResult({
        completedWork: [{ status: 'modified', path: 'src/foo.ts', staged: false }],
        testResult: { passed: true, summary: '10 passing', raw: '' },
        transcriptData: makeTranscriptData(),
      });
      const md = renderHandover(result);

      const sessionSummaryIdx = md.indexOf('## Session Summary');
      const completedWorkIdx = md.indexOf('## Completed Work');
      const qualityGatesIdx = md.indexOf('## Quality Gates');

      expect(sessionSummaryIdx).toBeGreaterThan(-1);
      expect(completedWorkIdx).toBeGreaterThan(-1);
      expect(sessionSummaryIdx).toBeLessThan(completedWorkIdx);
      if (qualityGatesIdx > -1) {
        expect(sessionSummaryIdx).toBeLessThan(qualityGatesIdx);
      }
    });

    it('includes separator between transcript and git sections', () => {
      const result = makeBaseResult({
        transcriptData: makeTranscriptData(),
      });
      const md = renderHandover(result);

      expect(md).toContain('---');
    });
  });

  describe('no transcripts found — graceful fallback', () => {
    it('renders normal output without transcript sections', () => {
      // This simulates the case where collectTranscriptData returns null
      const result = makeBaseResult({
        // transcriptData is undefined
        completedWork: [{ status: 'modified', path: 'src/foo.ts', staged: false }],
      });
      const md = renderHandover(result);

      expect(md).toContain('## Completed Work');
      expect(md).not.toContain('## Session Summary');
    });
  });
});

describe('parseDuration', () => {
  it('parses hours', () => {
    expect(parseDuration('2h')).toBe(2 * 60 * 60 * 1000);
    expect(parseDuration('1h')).toBe(60 * 60 * 1000);
  });

  it('parses minutes', () => {
    expect(parseDuration('30m')).toBe(30 * 60 * 1000);
    expect(parseDuration('5m')).toBe(5 * 60 * 1000);
  });

  it('returns null for invalid input', () => {
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('2d')).toBeNull();
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('h')).toBeNull();
  });
});

describe('formatDuration', () => {
  it('formats sub-minute', () => {
    expect(formatDuration(0.5)).toBe('< 1 min');
  });

  it('formats minutes', () => {
    expect(formatDuration(5)).toBe('5 min');
    expect(formatDuration(47)).toBe('47 min');
  });

  it('formats hours', () => {
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(120)).toBe('2h');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(83)).toBe('1h 23min');
    expect(formatDuration(150)).toBe('2h 30min');
  });
});
