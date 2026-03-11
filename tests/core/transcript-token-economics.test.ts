import { describe, it, expect } from 'vitest';
import { analyzeTokenEconomics } from '../../src/core/transcript-analyzer.js';
import type { TranscriptParseResult } from '../../src/parsers/transcript-jsonl.js';
import { parseTranscriptFile } from '../../src/parsers/transcript-jsonl.js';
import { join } from 'path';
import type {
  TranscriptSession,
  UsageSummary,
  MessageTokenSnapshot,
} from '../../src/types/transcript.js';

// ---- Helpers ----

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

function makeMessageToken(overrides: Partial<MessageTokenSnapshot> = {}): MessageTokenSnapshot {
  return {
    timestamp: new Date('2026-03-09T10:00:05Z'),
    inputTokens: 1500,
    outputTokens: 30,
    cacheCreationTokens: 45000,
    cacheReadTokens: 0,
    model: 'claude-sonnet-4-5-20250514',
    ...overrides,
  };
}

function makeResult(overrides: Partial<TranscriptParseResult> = {}): TranscriptParseResult {
  return {
    session: makeSession(),
    toolCalls: [],
    toolResults: [],
    tasks: [],
    tokenUsage: makeUsage(),
    messageTokens: [makeMessageToken()],
    ...overrides,
  };
}

// ---- Tests ----

describe('analyzeTokenEconomics', () => {
  it('returns empty report for empty input', () => {
    const report = analyzeTokenEconomics([], 2000);

    expect(report.sessionsWithTokenData).toBe(0);
    expect(report.sessionsTotal).toBe(0);
    expect(report.totalEstimatedCost).toBe(0);
    expect(report.avgCostPerSession).toBe(0);
    expect(report.overallCacheEfficiency).toBe(0);
    expect(report.sessionSnapshots).toHaveLength(0);
    expect(report.totalCompactions).toBe(0);
  });

  describe('startup cost comparison', () => {
    it('calculates startup delta when actual > estimated', () => {
      const result = makeResult({
        messageTokens: [
          makeMessageToken({
            inputTokens: 1500,
            cacheReadTokens: 500,
            cacheCreationTokens: 45000,
          }),
          makeMessageToken({
            timestamp: new Date('2026-03-09T10:01:00Z'),
            inputTokens: 1600,
            cacheReadTokens: 46000,
            cacheCreationTokens: 0,
          }),
        ],
      });

      // First message total = 1500 + 500 + 45000 = 47000
      const report = analyzeTokenEconomics([result], 2000);

      expect(report.estimatedStartupTokens).toBe(2000);
      expect(report.actualFirstMessageTokens).toBe(47000);
      expect(report.startupDelta).toBe(45000);
      expect(report.startupDeltaPercent).toBe(2250);
    });

    it('averages across multiple sessions', () => {
      const r1 = makeResult({
        session: makeSession({ sessionId: 'sess-001' }),
        messageTokens: [
          makeMessageToken({
            inputTokens: 1000,
            cacheReadTokens: 0,
            cacheCreationTokens: 2000,
          }),
        ],
      });
      const r2 = makeResult({
        session: makeSession({ sessionId: 'sess-002' }),
        messageTokens: [
          makeMessageToken({
            inputTokens: 1000,
            cacheReadTokens: 0,
            cacheCreationTokens: 4000,
          }),
        ],
      });

      // avg first message = (3000 + 5000) / 2 = 4000
      const report = analyzeTokenEconomics([r1, r2], 2000);

      expect(report.actualFirstMessageTokens).toBe(4000);
      expect(report.startupDelta).toBe(2000);
      expect(report.startupDeltaPercent).toBe(100);
    });

    it('handles zero estimated startup tokens', () => {
      const result = makeResult();
      const report = analyzeTokenEconomics([result], 0);

      expect(report.startupDeltaPercent).toBe(0);
    });
  });

  describe('cost estimation', () => {
    it('estimates cost for sonnet model', () => {
      const result = makeResult({
        messageTokens: [
          makeMessageToken({
            inputTokens: 100000,
            outputTokens: 20000,
            cacheCreationTokens: 50000,
            cacheReadTokens: 200000,
            model: 'claude-sonnet-4-5-20250514',
          }),
        ],
      });

      const report = analyzeTokenEconomics([result], 0);

      // sonnet: input $3/M, output $15/M, cacheWrite $3.75/M, cacheRead $0.30/M
      // cost = (100000/1M * 3) + (20000/1M * 15) + (50000/1M * 3.75) + (200000/1M * 0.30)
      //      = 0.3 + 0.3 + 0.1875 + 0.06 = 0.8475
      expect(report.totalEstimatedCost).toBeCloseTo(0.8475, 2);
      expect(report.avgCostPerSession).toBeCloseTo(0.8475, 2);
    });

    it('estimates cost for haiku model', () => {
      const result = makeResult({
        session: makeSession({ model: 'claude-haiku-4-5-20251001' }),
        messageTokens: [
          makeMessageToken({
            inputTokens: 100000,
            outputTokens: 20000,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            model: 'claude-haiku-4-5-20251001',
          }),
        ],
      });

      const report = analyzeTokenEconomics([result], 0);

      // haiku: input $0.80/M, output $4/M
      // cost = (100000/1M * 0.80) + (20000/1M * 4) = 0.08 + 0.08 = 0.16
      expect(report.totalEstimatedCost).toBeCloseTo(0.16, 2);
    });

    it('handles mixed models across sessions', () => {
      const r1 = makeResult({
        session: makeSession({ sessionId: 'sess-1', model: 'claude-sonnet-4-5-20250514' }),
        messageTokens: [
          makeMessageToken({
            inputTokens: 10000,
            outputTokens: 5000,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            model: 'claude-sonnet-4-5-20250514',
          }),
        ],
      });
      const r2 = makeResult({
        session: makeSession({ sessionId: 'sess-2', model: 'claude-haiku-4-5-20251001' }),
        messageTokens: [
          makeMessageToken({
            inputTokens: 10000,
            outputTokens: 5000,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            model: 'claude-haiku-4-5-20251001',
          }),
        ],
      });

      const report = analyzeTokenEconomics([r1, r2], 0);

      expect(report.costByModel.size).toBe(2);
      expect(report.costByModel.has('claude-sonnet-4-5-20250514')).toBe(true);
      expect(report.costByModel.has('claude-haiku-4-5-20251001')).toBe(true);
      // Sonnet should cost more than haiku for same token counts
      const sonnetCost = report.costByModel.get('claude-sonnet-4-5-20250514')!;
      const haikuCost = report.costByModel.get('claude-haiku-4-5-20251001')!;
      expect(sonnetCost).toBeGreaterThan(haikuCost);
    });
  });

  describe('cache TTL attribution', () => {
    it('classifies short gap as config change', () => {
      const result = makeResult({
        messageTokens: [
          makeMessageToken({
            timestamp: new Date('2026-03-09T10:00:00Z'),
            cacheCreationTokens: 45000,
            cacheReadTokens: 0,
          }),
          makeMessageToken({
            timestamp: new Date('2026-03-09T10:02:00Z'),
            cacheCreationTokens: 500,
            cacheReadTokens: 44500,
          }),
        ],
      });

      const report = analyzeTokenEconomics([result], 0);
      const miss = report.cacheMissBreakdown;

      // First message: always "new content" (configChange)
      // Second message: 2 min gap, configChange
      expect(miss.ttlTimeoutCount).toBe(0);
      expect(miss.configChangeCount).toBe(2);
      expect(miss.configChangeTokens).toBe(45500);
    });

    it('classifies long gap (>5 min) as TTL timeout', () => {
      const result = makeResult({
        messageTokens: [
          makeMessageToken({
            timestamp: new Date('2026-03-09T10:00:00Z'),
            cacheCreationTokens: 45000,
            cacheReadTokens: 0,
          }),
          makeMessageToken({
            timestamp: new Date('2026-03-09T10:08:00Z'),
            cacheCreationTokens: 44000,
            cacheReadTokens: 2000,
          }),
        ],
      });

      const report = analyzeTokenEconomics([result], 0);
      const miss = report.cacheMissBreakdown;

      // First message: configChange (startup)
      // Second message: 8 min gap → TTL timeout
      expect(miss.ttlTimeoutCount).toBe(1);
      expect(miss.ttlTimeoutTokens).toBe(44000);
      expect(miss.configChangeCount).toBe(1);
      expect(miss.configChangeTokens).toBe(45000);
    });

    it('does not count messages with zero cache creation', () => {
      const result = makeResult({
        messageTokens: [
          makeMessageToken({
            timestamp: new Date('2026-03-09T10:00:00Z'),
            cacheCreationTokens: 45000,
            cacheReadTokens: 0,
          }),
          makeMessageToken({
            timestamp: new Date('2026-03-09T10:10:00Z'),
            cacheCreationTokens: 0,
            cacheReadTokens: 45000,
          }),
        ],
      });

      const report = analyzeTokenEconomics([result], 0);
      const miss = report.cacheMissBreakdown;

      // Second message has 0 cache creation → not counted
      expect(miss.ttlTimeoutCount).toBe(0);
      expect(miss.configChangeCount).toBe(1); // only first message
    });
  });

  describe('cache efficiency', () => {
    it('calculates overall cache efficiency', () => {
      const result = makeResult({
        messageTokens: [
          makeMessageToken({ cacheReadTokens: 80000, cacheCreationTokens: 20000 }),
        ],
      });

      const report = analyzeTokenEconomics([result], 0);

      // 80000 / (80000 + 20000) = 80%
      expect(report.overallCacheEfficiency).toBe(80);
    });

    it('returns 0 when no cache activity', () => {
      const result = makeResult({
        messageTokens: [
          makeMessageToken({ cacheReadTokens: 0, cacheCreationTokens: 0 }),
        ],
      });

      const report = analyzeTokenEconomics([result], 0);
      expect(report.overallCacheEfficiency).toBe(0);
    });
  });

  describe('session snapshots', () => {
    it('produces sorted snapshots by date', () => {
      const r1 = makeResult({
        session: makeSession({
          sessionId: 'sess-b',
          startedAt: new Date('2026-03-10T10:00:00Z'),
        }),
        messageTokens: [
          makeMessageToken({ timestamp: new Date('2026-03-10T10:00:00Z') }),
        ],
      });
      const r2 = makeResult({
        session: makeSession({
          sessionId: 'sess-a',
          startedAt: new Date('2026-03-09T10:00:00Z'),
        }),
        messageTokens: [
          makeMessageToken({ timestamp: new Date('2026-03-09T10:00:00Z') }),
        ],
      });

      // Pass in reverse order
      const report = analyzeTokenEconomics([r1, r2], 0);

      expect(report.sessionSnapshots).toHaveLength(2);
      expect(report.sessionSnapshots[0].sessionId).toBe('sess-a');
      expect(report.sessionSnapshots[1].sessionId).toBe('sess-b');
    });

    it('includes correct token totals per snapshot', () => {
      const result = makeResult({
        messageTokens: [
          makeMessageToken({
            inputTokens: 1000,
            outputTokens: 500,
            cacheReadTokens: 3000,
            cacheCreationTokens: 2000,
          }),
          makeMessageToken({
            timestamp: new Date('2026-03-09T10:01:00Z'),
            inputTokens: 1500,
            outputTokens: 600,
            cacheReadTokens: 5000,
            cacheCreationTokens: 0,
          }),
        ],
      });

      const report = analyzeTokenEconomics([result], 0);

      expect(report.sessionSnapshots).toHaveLength(1);
      const snap = report.sessionSnapshots[0];
      expect(snap.newInputTokens).toBe(2500);      // 1000 + 1500
      expect(snap.totalOutput).toBe(1100);          // 500 + 600
      expect(snap.cacheReadTokens).toBe(8000);      // 3000 + 5000
      expect(snap.cacheCreationTokens).toBe(2000);
      expect(snap.totalInput).toBe(12500);           // 2500 + 8000 + 2000
    });
  });

  describe('no token metadata', () => {
    it('handles sessions with no message tokens gracefully', () => {
      const result = makeResult({
        messageTokens: [],
        tokenUsage: makeUsage({ sessionsWithData: 0 }),
      });

      const report = analyzeTokenEconomics([result], 2000);

      expect(report.sessionsWithTokenData).toBe(0);
      expect(report.sessionsTotal).toBe(1);
      expect(report.totalEstimatedCost).toBe(0);
      expect(report.avgCostPerSession).toBe(0);
      expect(report.actualFirstMessageTokens).toBe(0);
      expect(report.sessionSnapshots).toHaveLength(0);
    });
  });

  describe('compaction tracking', () => {
    it('counts compaction events from system events', () => {
      const result = makeResult({
        session: makeSession({
          events: [
            {
              kind: 'system',
              timestamp: new Date('2026-03-09T10:15:00Z'),
              uuid: 'sys-001',
              parentUuid: null,
              isSidechain: false,
              rawType: 'system',
            },
            {
              kind: 'system',
              timestamp: new Date('2026-03-09T10:25:00Z'),
              uuid: 'sys-002',
              parentUuid: null,
              isSidechain: false,
              rawType: 'system',
            },
          ],
        }),
        messageTokens: [makeMessageToken()],
      });

      const report = analyzeTokenEconomics([result], 0);

      expect(report.totalCompactions).toBe(2);
      expect(report.sessionsWithCompaction).toBe(1);
    });

    it('returns 0 compactions when no system events', () => {
      const result = makeResult({
        session: makeSession({ events: [] }),
        messageTokens: [makeMessageToken()],
      });

      const report = analyzeTokenEconomics([result], 0);

      expect(report.totalCompactions).toBe(0);
      expect(report.sessionsWithCompaction).toBe(0);
    });
  });

  describe('cache-gap-session fixture', () => {
    it('correctly attributes TTL timeouts from fixture', async () => {
      const fixturePath = join(
        __dirname,
        '../../tests/fixtures/mock-transcripts/cache-gap-session.jsonl',
      );
      const result = await parseTranscriptFile(fixturePath);
      const report = analyzeTokenEconomics([result], 2000);

      // Fixture has 4 assistant messages:
      // a001: T=10:00:05 cache_creation=45000 (startup → configChange)
      // a002: T=10:02:05 cache_creation=500, 2 min gap (configChange)
      // a003: T=10:10:05 cache_creation=44000, 8 min gap (TTL timeout)
      // a004: T=10:12:05 cache_creation=0 (not counted)
      expect(report.cacheMissBreakdown.ttlTimeoutCount).toBe(1);
      expect(report.cacheMissBreakdown.ttlTimeoutTokens).toBe(44000);
      expect(report.cacheMissBreakdown.configChangeCount).toBe(2);
      expect(report.cacheMissBreakdown.configChangeTokens).toBe(45500);

      // First message total = 1500 + 0 + 45000 = 46500
      expect(report.actualFirstMessageTokens).toBe(46500);

      // Cache efficiency: reads / (reads + creation)
      // reads = 0 + 44500 + 2000 + 46000 = 92500
      // creation = 45000 + 500 + 44000 + 0 = 89500
      // efficiency = 92500 / (92500 + 89500) = 50.8%
      expect(report.overallCacheEfficiency).toBe(51);

      expect(report.sessionsWithTokenData).toBe(1);
      expect(report.sessionSnapshots).toHaveLength(1);
    });
  });
});
