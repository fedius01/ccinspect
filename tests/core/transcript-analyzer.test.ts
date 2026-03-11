import { describe, it, expect } from 'vitest';
import { aggregateParseResults } from '../../src/core/transcript-analyzer.js';
import type { TranscriptParseResult } from '../../src/parsers/transcript-jsonl.js';
import type { ToolCall, ToolResult, TaskAttempt, UsageSummary, TranscriptSession } from '../../src/types/transcript.js';

// ---- Helpers to build mock data ----

function makeSession(overrides: Partial<TranscriptSession> = {}): TranscriptSession {
  return {
    sessionId: 'sess-001',
    claudeCodeVersion: '2.1.61',
    model: 'claude-sonnet-4-5-20250514',
    projectRoot: '/Users/dev/my-project',
    gitBranch: 'main',
    startedAt: new Date('2026-03-09T10:00:00Z'),
    endedAt: new Date('2026-03-09T10:30:00Z'),
    sourceFile: '/home/.claude/projects/-Users-dev-my-project/sess-001.jsonl',
    events: [],
    parseWarnings: [],
    completeness: 'exact',
    skippedLineTypes: [],
    ...overrides,
  };
}

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolName: 'Read',
    input: { file_path: '/Users/dev/my-project/src/foo.ts' },
    callId: 'toolu_default',
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
    prompt: 'Fix the bug in foo.ts',
    startedAt: new Date('2026-03-09T10:00:02Z'),
    endedAt: new Date('2026-03-09T10:05:00Z'),
    toolCalls: [],
    toolResults: [],
    outcome: 'success',
    ...overrides,
  };
}

function makeUsage(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    inputTokens: 5000,
    outputTokens: 1200,
    cacheReadTokens: 3000,
    cacheCreationTokens: 1000,
    cache5mTokens: 0,
    cache1hTokens: 1000,
    completeness: 'exact',
    sessionsWithData: 1,
    sessionsTotal: 1,
    ...overrides,
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

describe('aggregateParseResults', () => {
  it('returns empty stats for empty input', () => {
    const stats = aggregateParseResults([]);

    expect(stats.sessionsAnalyzed).toBe(0);
    expect(stats.sessionsExact).toBe(0);
    expect(stats.totalTurns).toBe(0);
    expect(stats.totalToolCalls).toBe(0);
    expect(stats.toolDistribution.size).toBe(0);
    expect(stats.fileActivity.size).toBe(0);
    expect(stats.delegations).toHaveLength(0);
    expect(stats.skillActivations).toHaveLength(0);
    expect(stats.tokenUsage.inputTokens).toBe(0);
  });

  it('aggregates a single session correctly', () => {
    const result = makeParseResult({
      session: makeSession({ completeness: 'exact' }),
      toolCalls: [
        makeToolCall({ toolName: 'Read', input: { file_path: '/Users/dev/my-project/src/foo.ts' } }),
        makeToolCall({ toolName: 'Edit', input: { file_path: '/Users/dev/my-project/src/foo.ts' } }),
        makeToolCall({ toolName: 'Bash', input: { command: 'npm test' } }),
      ],
      tasks: [makeTask(), makeTask({ prompt: 'Add tests' })],
      tokenUsage: makeUsage({ inputTokens: 5000, outputTokens: 1200 }),
    });

    const stats = aggregateParseResults([result], '/Users/dev/my-project');

    expect(stats.sessionsAnalyzed).toBe(1);
    expect(stats.sessionsExact).toBe(1);
    expect(stats.totalTurns).toBe(2);
    expect(stats.totalToolCalls).toBe(3);

    // Tool distribution
    expect(stats.toolDistribution.get('Read')).toBe(1);
    expect(stats.toolDistribution.get('Edit')).toBe(1);
    expect(stats.toolDistribution.get('Bash')).toBe(1);

    // File activity — paths normalized relative to project root
    const fooActivity = stats.fileActivity.get('src/foo.ts');
    expect(fooActivity).toBeDefined();
    expect(fooActivity!.readCount).toBe(1);
    expect(fooActivity!.editCount).toBe(1);
    expect(fooActivity!.sessions.size).toBe(1);

    // Token usage
    expect(stats.tokenUsage.inputTokens).toBe(5000);
    expect(stats.tokenUsage.outputTokens).toBe(1200);
    expect(stats.tokenUsage.completeness).toBe('exact');
  });

  it('aggregates multiple sessions correctly', () => {
    const result1 = makeParseResult({
      session: makeSession({
        sessionId: 'sess-001',
        completeness: 'exact',
        startedAt: new Date('2026-03-08T10:00:00Z'),
        endedAt: new Date('2026-03-08T10:30:00Z'),
      }),
      toolCalls: [
        makeToolCall({ toolName: 'Read', input: { file_path: '/proj/src/a.ts' } }),
        makeToolCall({ toolName: 'Edit', input: { file_path: '/proj/src/a.ts' } }),
      ],
      tasks: [makeTask()],
      tokenUsage: makeUsage({ inputTokens: 3000, outputTokens: 800 }),
    });

    const result2 = makeParseResult({
      session: makeSession({
        sessionId: 'sess-002',
        completeness: 'partial',
        startedAt: new Date('2026-03-09T14:00:00Z'),
        endedAt: new Date('2026-03-09T15:00:00Z'),
      }),
      toolCalls: [
        makeToolCall({ toolName: 'Read', input: { file_path: '/proj/src/a.ts' } }),
        makeToolCall({ toolName: 'Write', input: { file_path: '/proj/src/b.ts' } }),
        makeToolCall({ toolName: 'Edit', input: { file_path: '/proj/src/b.ts' } }),
      ],
      tasks: [makeTask(), makeTask({ prompt: 'Refactor b.ts' })],
      tokenUsage: makeUsage({ inputTokens: 4000, outputTokens: 1000 }),
    });

    const result3 = makeParseResult({
      session: makeSession({
        sessionId: 'sess-003',
        completeness: 'damaged',
        startedAt: new Date('2026-03-10T09:00:00Z'),
        endedAt: new Date('2026-03-10T09:10:00Z'),
      }),
      toolCalls: [],
      tasks: [],
      tokenUsage: makeUsage({ sessionsWithData: 0, inputTokens: 0, outputTokens: 0 }),
    });

    const stats = aggregateParseResults([result1, result2, result3], '/proj');

    expect(stats.sessionsAnalyzed).toBe(3);
    expect(stats.sessionsExact).toBe(1);
    expect(stats.sessionsPartial).toBe(1);
    expect(stats.sessionsDamaged).toBe(1);

    // Date range spans all sessions
    expect(stats.dateRange.from).toEqual(new Date('2026-03-08T10:00:00Z'));
    expect(stats.dateRange.to).toEqual(new Date('2026-03-10T09:10:00Z'));

    // Turns sum: 1 + 2 + 0 = 3
    expect(stats.totalTurns).toBe(3);

    // Tool calls sum: 2 + 3 + 0 = 5
    expect(stats.totalToolCalls).toBe(5);
    expect(stats.toolDistribution.get('Read')).toBe(2);
    expect(stats.toolDistribution.get('Edit')).toBe(2);
    expect(stats.toolDistribution.get('Write')).toBe(1);

    // File activity merges across sessions
    const aActivity = stats.fileActivity.get('src/a.ts');
    expect(aActivity).toBeDefined();
    expect(aActivity!.readCount).toBe(2);
    expect(aActivity!.editCount).toBe(1);
    expect(aActivity!.sessions.size).toBe(2);

    const bActivity = stats.fileActivity.get('src/b.ts');
    expect(bActivity).toBeDefined();
    expect(bActivity!.writeCount).toBe(1);
    expect(bActivity!.editCount).toBe(1);
    expect(bActivity!.sessions.size).toBe(1);

    // Token usage sums (sess-003 had no token data)
    expect(stats.tokenUsage.inputTokens).toBe(7000);
    expect(stats.tokenUsage.outputTokens).toBe(1800);
    expect(stats.tokenUsage.completeness).toBe('estimated'); // not all sessions had data
    expect(stats.tokenUsage.sessionsWithData).toBe(2);
    expect(stats.tokenUsage.sessionsTotal).toBe(3);
  });

  it('extracts delegation records from Task tool calls', () => {
    const result = makeParseResult({
      session: makeSession({ sessionId: 'sess-001' }),
      toolCalls: [
        makeToolCall({
          toolName: 'Task',
          input: { name: 'researcher', description: 'Find docs', prompt: 'search for API docs' },
        }),
        makeToolCall({
          toolName: 'Task',
          input: { name: 'researcher', description: 'Find more', prompt: 'search for examples' },
        }),
        makeToolCall({
          toolName: 'Agent',
          input: { name: 'test-runner', prompt: 'run all tests' },
        }),
      ],
      tasks: [makeTask()],
    });

    const stats = aggregateParseResults([result]);

    expect(stats.delegations).toHaveLength(2);

    const researcher = stats.delegations.find((d) => d.agentName === 'researcher');
    expect(researcher).toBeDefined();
    expect(researcher!.count).toBe(2);
    expect(researcher!.sessionIds).toContain('sess-001');

    const testRunner = stats.delegations.find((d) => d.agentName === 'test-runner');
    expect(testRunner).toBeDefined();
    expect(testRunner!.count).toBe(1);
  });

  it('extracts skill activations from Skill tool and /command prompts', () => {
    const result = makeParseResult({
      session: makeSession({ sessionId: 'sess-001' }),
      toolCalls: [
        makeToolCall({ toolName: 'Skill', input: { skill: 'commit' } }),
        makeToolCall({ toolName: 'Skill', input: { skill: 'commit' } }),
        makeToolCall({ toolName: 'Skill', input: { skill: 'review-pr' } }),
      ],
      tasks: [
        makeTask({ prompt: '/deploy to staging' }),
        makeTask({ prompt: 'Fix the bug' }), // Not a skill command
      ],
    });

    const stats = aggregateParseResults([result]);

    expect(stats.skillActivations).toHaveLength(3);

    const commit = stats.skillActivations.find((s) => s.skillName === 'commit');
    expect(commit).toBeDefined();
    expect(commit!.explicitCount).toBe(2);

    const deploy = stats.skillActivations.find((s) => s.skillName === 'deploy');
    expect(deploy).toBeDefined();
    expect(deploy!.explicitCount).toBe(1);
  });

  it('handles token usage with partial metadata', () => {
    const withTokens = makeParseResult({
      session: makeSession({ sessionId: 'sess-001' }),
      tokenUsage: makeUsage({ inputTokens: 10000, outputTokens: 2000, sessionsWithData: 1 }),
    });

    const withoutTokens = makeParseResult({
      session: makeSession({ sessionId: 'sess-002' }),
      tokenUsage: makeUsage({ inputTokens: 0, outputTokens: 0, sessionsWithData: 0 }),
    });

    const stats = aggregateParseResults([withTokens, withoutTokens]);

    expect(stats.tokenUsage.completeness).toBe('estimated');
    expect(stats.tokenUsage.sessionsWithData).toBe(1);
    expect(stats.tokenUsage.sessionsTotal).toBe(2);
    expect(stats.tokenUsage.inputTokens).toBe(10000);
    expect(stats.tokenUsage.outputTokens).toBe(2000);
  });

  it('computes tool distribution correctly', () => {
    const result = makeParseResult({
      toolCalls: [
        makeToolCall({ toolName: 'Edit' }),
        makeToolCall({ toolName: 'Edit' }),
        makeToolCall({ toolName: 'Edit' }),
        makeToolCall({ toolName: 'Read' }),
        makeToolCall({ toolName: 'Read' }),
        makeToolCall({ toolName: 'Bash' }),
      ],
    });

    const stats = aggregateParseResults([result]);

    expect(stats.totalToolCalls).toBe(6);
    expect(stats.toolDistribution.get('Edit')).toBe(3);
    expect(stats.toolDistribution.get('Read')).toBe(2);
    expect(stats.toolDistribution.get('Bash')).toBe(1);
  });

  it('normalizes file paths relative to project root', () => {
    const result = makeParseResult({
      toolCalls: [
        makeToolCall({ toolName: 'Read', input: { file_path: '/proj/src/deep/file.ts' } }),
        makeToolCall({ toolName: 'Edit', input: { file_path: '/proj/src/deep/file.ts' } }),
        makeToolCall({ toolName: 'Read', input: { file_path: '/other/path/external.ts' } }),
      ],
    });

    const stats = aggregateParseResults([result], '/proj');

    // Project-relative path
    expect(stats.fileActivity.has('src/deep/file.ts')).toBe(true);
    // External path stays absolute
    expect(stats.fileActivity.has('/other/path/external.ts')).toBe(true);
  });

  it('sorts delegations by count descending', () => {
    const result = makeParseResult({
      toolCalls: [
        makeToolCall({ toolName: 'Task', input: { name: 'alpha' } }),
        makeToolCall({ toolName: 'Task', input: { name: 'beta' } }),
        makeToolCall({ toolName: 'Task', input: { name: 'beta' } }),
        makeToolCall({ toolName: 'Task', input: { name: 'beta' } }),
        makeToolCall({ toolName: 'Task', input: { name: 'alpha' } }),
      ],
    });

    const stats = aggregateParseResults([result]);

    expect(stats.delegations[0].agentName).toBe('beta');
    expect(stats.delegations[0].count).toBe(3);
    expect(stats.delegations[1].agentName).toBe('alpha');
    expect(stats.delegations[1].count).toBe(2);
  });

  it('handles delegation via subagent_type field', () => {
    const result = makeParseResult({
      toolCalls: [
        makeToolCall({ toolName: 'Agent', input: { subagent_type: 'Explore', prompt: 'find files' } }),
      ],
    });

    const stats = aggregateParseResults([result]);

    expect(stats.delegations).toHaveLength(1);
    expect(stats.delegations[0].agentName).toBe('Explore');
  });

  it('handles delegation via description fallback', () => {
    const result = makeParseResult({
      toolCalls: [
        makeToolCall({ toolName: 'Task', input: { description: 'Run security audit' } }),
      ],
    });

    const stats = aggregateParseResults([result]);
    expect(stats.delegations).toHaveLength(1);
    expect(stats.delegations[0].agentName).toBe('Run security audit');
  });

  it('merges delegations across sessions', () => {
    const result1 = makeParseResult({
      session: makeSession({ sessionId: 'sess-001' }),
      toolCalls: [makeToolCall({ toolName: 'Task', input: { name: 'researcher' } })],
    });

    const result2 = makeParseResult({
      session: makeSession({ sessionId: 'sess-002' }),
      toolCalls: [
        makeToolCall({ toolName: 'Task', input: { name: 'researcher' } }),
        makeToolCall({ toolName: 'Task', input: { name: 'researcher' } }),
      ],
    });

    const stats = aggregateParseResults([result1, result2]);

    expect(stats.delegations).toHaveLength(1);
    expect(stats.delegations[0].count).toBe(3);
    expect(stats.delegations[0].sessionIds).toHaveLength(2);
  });

  it('aggregates cache tokens', () => {
    const result = makeParseResult({
      tokenUsage: makeUsage({
        cacheReadTokens: 50000,
        cacheCreationTokens: 10000,
        cache5mTokens: 500,
        cache1hTokens: 9500,
      }),
    });

    const stats = aggregateParseResults([result]);

    expect(stats.tokenUsage.cacheReadTokens).toBe(50000);
    expect(stats.tokenUsage.cacheCreationTokens).toBe(10000);
    expect(stats.tokenUsage.cache5mTokens).toBe(500);
    expect(stats.tokenUsage.cache1hTokens).toBe(9500);
  });

  describe('ephemeral teammate classification', () => {
    it('marks delegation as ephemeral when Task call has teamName', () => {
      const result = makeParseResult({
        session: makeSession({ sessionId: 'sess-team' }),
        toolCalls: [
          makeToolCall({
            toolName: 'Task',
            input: { prompt: 'implement backend', name: 'backend-agent', team_name: 'feature-auth' },
            callId: 'toolu_task_001',
            teamName: 'feature-auth',
          }),
        ],
      });

      const stats = aggregateParseResults([result]);

      expect(stats.delegations).toHaveLength(1);
      expect(stats.delegations[0].agentName).toBe('backend-agent');
      expect(stats.delegations[0].isEphemeralTeammate).toBe(true);
    });

    it('marks delegation as non-ephemeral when Task call has no teamName', () => {
      const result = makeParseResult({
        session: makeSession({ sessionId: 'sess-regular' }),
        toolCalls: [
          makeToolCall({
            toolName: 'Task',
            input: { prompt: 'research something', subagent_type: 'general-purpose' },
            callId: 'toolu_task_002',
          }),
        ],
      });

      const stats = aggregateParseResults([result]);

      expect(stats.delegations).toHaveLength(1);
      expect(stats.delegations[0].isEphemeralTeammate).toBe(false);
    });

    it('uses Teammate tool fallback: single-session + team session → ephemeral', () => {
      const result = makeParseResult({
        session: makeSession({ sessionId: 'sess-team-2' }),
        toolCalls: [
          // Teammate tool call marks this as a team session
          makeToolCall({
            toolName: 'Teammate',
            input: { action: 'spawnTeam' },
            callId: 'toolu_teammate_001',
          }),
          // Task without teamName but in a team session
          makeToolCall({
            toolName: 'Task',
            input: { prompt: 'do work', name: 'worker-agent' },
            callId: 'toolu_task_003',
          }),
        ],
      });

      const stats = aggregateParseResults([result]);

      const workerDelegation = stats.delegations.find((d) => d.agentName === 'worker-agent');
      expect(workerDelegation).toBeDefined();
      expect(workerDelegation!.isEphemeralTeammate).toBe(true);
    });

    it('multi-session delegation without teamName is not ephemeral', () => {
      const result1 = makeParseResult({
        session: makeSession({ sessionId: 'sess-1' }),
        toolCalls: [
          makeToolCall({
            toolName: 'Teammate',
            input: { action: 'spawnTeam' },
            callId: 'toolu_teammate_001',
          }),
          makeToolCall({
            toolName: 'Task',
            input: { prompt: 'do work', name: 'persistent-agent' },
            callId: 'toolu_task_004',
          }),
        ],
      });
      const result2 = makeParseResult({
        session: makeSession({ sessionId: 'sess-2' }),
        toolCalls: [
          makeToolCall({
            toolName: 'Task',
            input: { prompt: 'more work', name: 'persistent-agent' },
            callId: 'toolu_task_005',
          }),
        ],
      });

      const stats = aggregateParseResults([result1, result2]);

      const delegation = stats.delegations.find((d) => d.agentName === 'persistent-agent');
      expect(delegation).toBeDefined();
      expect(delegation!.sessionIds).toHaveLength(2);
      // Multi-session without teamName → not ephemeral (even though one session had Teammate)
      expect(delegation!.isEphemeralTeammate).toBe(false);
    });
  });
});
