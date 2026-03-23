import { describe, it, expect } from 'vitest';
import {
  attributeSessions,
  buildVersionBreakdown,
  countSupersededSessions,
  detectRetentionGap,
} from '../../src/core/version-attributor.js';
import type { HistoryEntry } from '../../src/types/history.js';
import type { AggregateStats } from '../../src/types/transcript.js';

// ---- Helpers ----

function makeEntry(
  version: number,
  timestamp: string,
  overrides?: Partial<HistoryEntry>,
): HistoryEntry {
  return {
    version,
    parentVersion: version > 1 ? version - 1 : 0,
    timestamp,
    source: 'git',
    contentHash: `hash-v${version}`,
    tokenCount: 100,
    filesChanged: 1,
    linesAdded: 5,
    linesRemoved: 2,
    summary: `Version ${version}`,
    ...overrides,
  };
}

function makeEmptyStats(overrides?: Partial<AggregateStats>): AggregateStats {
  return {
    sessionsAnalyzed: 0,
    sessionsExact: 0,
    sessionsPartial: 0,
    sessionsDamaged: 0,
    dateRange: { from: new Date('2026-03-01'), to: new Date('2026-03-20') },
    totalTurns: 0,
    totalToolCalls: 0,
    toolDistribution: new Map(),
    fileActivity: new Map(),
    delegations: [],
    skillActivations: [],
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      cache5mTokens: 0,
      cache1hTokens: 0,
      completeness: 'exact',
      sessionsWithData: 0,
      sessionsTotal: 0,
    },
    bashCommandTokens: new Set(),
    ...overrides,
  };
}

// ---- Tests ----

describe('attributeSessions', () => {
  it('returns empty array for no sessions', () => {
    const history = [makeEntry(1, '2026-03-01T10:00:00Z')];
    const result = attributeSessions(new Map(), history);
    expect(result).toEqual([]);
  });

  it('returns unattributed when no history', () => {
    const sessions = new Map([['s1', new Date('2026-03-10T10:00:00Z')]]);
    const result = attributeSessions(sessions, []);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      sessionId: 's1',
      configVersion: 0,
      inActiveLineage: false,
      confidence: 'unattributed',
    });
  });

  it('attributes pre-history sessions to v1 with estimated confidence', () => {
    const history = [
      makeEntry(1, '2026-03-10T10:00:00Z'),
      makeEntry(2, '2026-03-15T10:00:00Z'),
    ];
    const sessions = new Map([['s1', new Date('2026-03-05T10:00:00Z')]]);
    const result = attributeSessions(sessions, history);
    expect(result[0]).toEqual({
      sessionId: 's1',
      configVersion: 1,
      inActiveLineage: true,
      confidence: 'estimated',
    });
  });

  it('attributes session to latest version before session start', () => {
    const history = [
      makeEntry(1, '2026-03-01T10:00:00Z'),
      makeEntry(2, '2026-03-10T10:00:00Z'),
      makeEntry(3, '2026-03-20T10:00:00Z'),
    ];
    const sessions = new Map([
      ['s1', new Date('2026-03-05T10:00:00Z')],  // → v1
      ['s2', new Date('2026-03-12T10:00:00Z')],  // → v2
      ['s3', new Date('2026-03-25T10:00:00Z')],  // → v3
    ]);
    const result = attributeSessions(sessions, history);
    const bySession = new Map(result.map((r) => [r.sessionId, r]));

    expect(bySession.get('s1')!.configVersion).toBe(1);
    expect(bySession.get('s2')!.configVersion).toBe(2);
    expect(bySession.get('s3')!.configVersion).toBe(3);
    expect(bySession.get('s1')!.confidence).toBe('exact');
  });

  it('attributes session exactly at version timestamp to that version', () => {
    const history = [
      makeEntry(1, '2026-03-01T10:00:00Z'),
      makeEntry(2, '2026-03-10T10:00:00Z'),
    ];
    const sessions = new Map([
      ['s1', new Date('2026-03-10T10:00:00Z')], // exactly at v2 timestamp
    ]);
    const result = attributeSessions(sessions, history);
    expect(result[0].configVersion).toBe(2);
  });

  it('marks superseded versions correctly', () => {
    // v1 → v2 → v3 (restore from v1) → v4
    // Active lineage: v4 ← v3 ← v1 (v2 is superseded)
    const history = [
      makeEntry(1, '2026-03-01T10:00:00Z'),
      makeEntry(2, '2026-03-10T10:00:00Z'),
      makeEntry(3, '2026-03-15T10:00:00Z', { parentVersion: 1, restoredFrom: 1, source: 'restore' }),
      makeEntry(4, '2026-03-20T10:00:00Z'),
    ];
    const sessions = new Map([
      ['s1', new Date('2026-03-12T10:00:00Z')], // → v2 (superseded)
      ['s2', new Date('2026-03-22T10:00:00Z')], // → v4 (in lineage)
    ]);
    const result = attributeSessions(sessions, history);
    const bySession = new Map(result.map((r) => [r.sessionId, r]));

    expect(bySession.get('s1')!.configVersion).toBe(2);
    expect(bySession.get('s1')!.inActiveLineage).toBe(false);
    expect(bySession.get('s2')!.configVersion).toBe(4);
    expect(bySession.get('s2')!.inActiveLineage).toBe(true);
  });
});

describe('buildVersionBreakdown', () => {
  it('returns empty array when no history', () => {
    const result = buildVersionBreakdown([], [], makeEmptyStats());
    expect(result).toEqual([]);
  });

  it('builds breakdown with session counts and delegation stats', () => {
    const history = [
      makeEntry(1, '2026-03-01T10:00:00Z'),
      makeEntry(2, '2026-03-10T10:00:00Z'),
    ];
    const attributions = [
      { sessionId: 's1', configVersion: 1, inActiveLineage: true, confidence: 'exact' as const },
      { sessionId: 's2', configVersion: 2, inActiveLineage: true, confidence: 'exact' as const },
      { sessionId: 's3', configVersion: 2, inActiveLineage: true, confidence: 'exact' as const },
    ];
    const stats = makeEmptyStats({
      delegations: [
        { agentName: 'researcher', count: 5, sessionIds: ['s2', 's3'], isEphemeralTeammate: false },
      ],
    });

    const result = buildVersionBreakdown(attributions, history, stats);
    expect(result).toHaveLength(2);
    // Sorted by version desc
    expect(result[0].version).toBe(2);
    expect(result[0].sessionCount).toBe(2);
    expect(result[0].topDelegations).toEqual([{ agent: 'researcher', count: 2 }]);
    expect(result[1].version).toBe(1);
    expect(result[1].sessionCount).toBe(1);
  });

  it('includes restore metadata', () => {
    const history = [
      makeEntry(1, '2026-03-01T10:00:00Z'),
      makeEntry(2, '2026-03-10T10:00:00Z', { parentVersion: 1, restoredFrom: 1, source: 'restore' }),
    ];
    const attributions = [
      { sessionId: 's1', configVersion: 2, inActiveLineage: true, confidence: 'exact' as const },
    ];
    const result = buildVersionBreakdown(attributions, history, makeEmptyStats());
    expect(result[0].restoredFrom).toBe(1);
  });
});

describe('countSupersededSessions', () => {
  it('returns 0 when all in lineage', () => {
    const attributions = [
      { sessionId: 's1', configVersion: 1, inActiveLineage: true, confidence: 'exact' as const },
      { sessionId: 's2', configVersion: 2, inActiveLineage: true, confidence: 'exact' as const },
    ];
    const result = countSupersededSessions(attributions);
    expect(result.count).toBe(0);
    expect(result.versions.size).toBe(0);
  });

  it('counts superseded sessions and versions', () => {
    const attributions = [
      { sessionId: 's1', configVersion: 2, inActiveLineage: false, confidence: 'exact' as const },
      { sessionId: 's2', configVersion: 2, inActiveLineage: false, confidence: 'exact' as const },
      { sessionId: 's3', configVersion: 3, inActiveLineage: true, confidence: 'exact' as const },
    ];
    const result = countSupersededSessions(attributions);
    expect(result.count).toBe(2);
    expect(result.versions).toEqual(new Set([2]));
  });

  it('ignores unattributed sessions (version 0)', () => {
    const attributions = [
      { sessionId: 's1', configVersion: 0, inActiveLineage: false, confidence: 'unattributed' as const },
    ];
    const result = countSupersededSessions(attributions);
    expect(result.count).toBe(0);
  });
});

describe('detectRetentionGap', () => {
  it('returns null when no history', () => {
    expect(detectRetentionGap([], makeEmptyStats())).toBeNull();
  });

  it('returns null when no gap', () => {
    const history = [makeEntry(1, '2026-03-10T10:00:00Z')];
    const stats = makeEmptyStats({
      sessionsAnalyzed: 5,
      dateRange: { from: new Date('2026-03-10T10:00:00Z'), to: new Date('2026-03-20T10:00:00Z') },
    });
    expect(detectRetentionGap(history, stats)).toBeNull();
  });

  it('detects gap when history predates oldest session by >7 days', () => {
    const history = [makeEntry(1, '2026-01-01T10:00:00Z')];
    const stats = makeEmptyStats({
      sessionsAnalyzed: 5,
      dateRange: { from: new Date('2026-03-10T10:00:00Z'), to: new Date('2026-03-20T10:00:00Z') },
    });
    const result = detectRetentionGap(history, stats);
    expect(result).not.toBeNull();
    expect(result).toContain('cleanupPeriodDays');
  });

  it('returns null when gap is less than 7 days', () => {
    const history = [makeEntry(1, '2026-03-05T10:00:00Z')];
    const stats = makeEmptyStats({
      sessionsAnalyzed: 5,
      dateRange: { from: new Date('2026-03-10T10:00:00Z'), to: new Date('2026-03-20T10:00:00Z') },
    });
    expect(detectRetentionGap(history, stats)).toBeNull();
  });
});
