import { describe, it, expect } from 'vitest';
import { analyzeFileHeatmap } from '../../src/core/transcript-file-heatmap.js';
import type { AggregateStats, FileActivity } from '../../src/types/transcript.js';

function makeActivity(
  overrides: Partial<FileActivity> & { sessionIds?: string[] } = {},
): FileActivity {
  const sessions = new Set(overrides.sessionIds ?? ['s1']);
  return {
    readCount: 0,
    editCount: 0,
    writeCount: 0,
    bashCount: 0,
    sessions,
    ...overrides,
    // Restore sessions after spread since Set doesn't spread well
  };
}

function makeStats(
  files: Record<string, Partial<FileActivity> & { sessionIds?: string[] }>,
): AggregateStats {
  const fileActivity = new Map<string, FileActivity>();
  for (const [path, overrides] of Object.entries(files)) {
    fileActivity.set(path, makeActivity(overrides));
  }

  return {
    sessionsAnalyzed: 10,
    sessionsExact: 10,
    sessionsPartial: 0,
    sessionsDamaged: 0,
    dateRange: { from: new Date(), to: new Date() },
    totalTurns: 0,
    totalToolCalls: 0,
    toolDistribution: new Map(),
    fileActivity,
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
  };
}

describe('analyzeFileHeatmap', () => {
  describe('high-churn', () => {
    it('sorts by edit count descending', () => {
      const stats = makeStats({
        'src/a.ts': { editCount: 5, sessionIds: ['s1'] },
        'src/b.ts': { editCount: 20, sessionIds: ['s1', 's2'] },
        'src/c.ts': { editCount: 10, sessionIds: ['s1'] },
        'src/d.ts': { editCount: 1, sessionIds: ['s1'] },
        'src/e.ts': { editCount: 15, sessionIds: ['s1', 's2', 's3'] },
      });

      const report = analyzeFileHeatmap(stats);
      expect(report.highChurn.map((e) => e.filePath)).toEqual([
        'src/b.ts',
        'src/e.ts',
        'src/c.ts',
        'src/a.ts',
        'src/d.ts',
      ]);
    });

    it('calculates editsPerSession correctly', () => {
      const stats = makeStats({
        'src/a.ts': {
          editCount: 16,
          writeCount: 4,
          sessionIds: ['s1', 's2', 's3', 's4', 's5'],
        },
      });

      const report = analyzeFileHeatmap(stats);
      expect(report.highChurn[0].editsPerSession).toBe(4.0);
    });

    it('includes writeCount in total edits', () => {
      const stats = makeStats({
        'src/a.ts': { editCount: 5, writeCount: 3, sessionIds: ['s1'] },
      });

      const report = analyzeFileHeatmap(stats);
      // Sorted by editCount + writeCount = 8
      expect(report.highChurn[0].editCount).toBe(5);
      expect(report.highChurn[0].writeCount).toBe(3);
    });
  });

  describe('read-only references', () => {
    it('detects files read but never edited', () => {
      const stats = makeStats({
        'CLAUDE.md': { readCount: 50, sessionIds: ['s1', 's2', 's3'] },
        'src/types.ts': { readCount: 20, editCount: 0, sessionIds: ['s1'] },
        'src/edited.ts': { readCount: 10, editCount: 5, sessionIds: ['s1'] },
      });

      const report = analyzeFileHeatmap(stats);
      const refPaths = report.readOnlyReferences.map((e) => e.filePath);
      expect(refPaths).toContain('CLAUDE.md');
      expect(refPaths).toContain('src/types.ts');
      expect(refPaths).not.toContain('src/edited.ts');
    });

    it('excludes files with writes', () => {
      const stats = makeStats({
        'src/a.ts': { readCount: 10, writeCount: 1, sessionIds: ['s1'] },
      });

      const report = analyzeFileHeatmap(stats);
      expect(report.readOnlyReferences).toHaveLength(0);
    });

    it('sorts by read count descending', () => {
      const stats = makeStats({
        'docs/a.md': { readCount: 5, sessionIds: ['s1'] },
        'docs/b.md': { readCount: 30, sessionIds: ['s1', 's2'] },
        'docs/c.md': { readCount: 15, sessionIds: ['s1'] },
      });

      const report = analyzeFileHeatmap(stats);
      expect(report.readOnlyReferences.map((e) => e.filePath)).toEqual([
        'docs/b.md',
        'docs/c.md',
        'docs/a.md',
      ]);
    });
  });

  describe('edit-without-read', () => {
    it('detects files edited but never read', () => {
      const stats = makeStats({
        'src/new.ts': { editCount: 5, readCount: 0, sessionIds: ['s1', 's2'] },
        'src/normal.ts': { editCount: 5, readCount: 3, sessionIds: ['s1'] },
      });

      const report = analyzeFileHeatmap(stats);
      expect(report.editWithoutRead).toHaveLength(1);
      expect(report.editWithoutRead[0].filePath).toBe('src/new.ts');
    });

    it('includes write-only files', () => {
      const stats = makeStats({
        'src/generated.ts': { writeCount: 3, readCount: 0, sessionIds: ['s1'] },
      });

      const report = analyzeFileHeatmap(stats);
      expect(report.editWithoutRead).toHaveLength(1);
      expect(report.editWithoutRead[0].writeCount).toBe(3);
    });
  });

  describe('test correlation', () => {
    it('finds matching test files in same directory', () => {
      const stats = makeStats({
        'src/core/scanner.ts': { editCount: 5, sessionIds: ['s1'] },
        'src/core/scanner.test.ts': { editCount: 3, sessionIds: ['s1'] },
      });

      const report = analyzeFileHeatmap(stats);
      expect(report.testCorrelation.editedSourceFiles).toBe(1);
      expect(report.testCorrelation.withTestActivity).toBe(1);
      expect(report.testCorrelation.correlationPercent).toBe(100);
    });

    it('finds test files in tests/ directory mirror', () => {
      const stats = makeStats({
        'src/core/linter.ts': { editCount: 5, sessionIds: ['s1'] },
        'tests/core/linter.test.ts': { readCount: 2, sessionIds: ['s1'] },
      });

      const report = analyzeFileHeatmap(stats);
      expect(report.testCorrelation.withTestActivity).toBe(1);
    });

    it('reports files without test activity', () => {
      const stats = makeStats({
        'src/utils/helpers.ts': { editCount: 8, sessionIds: ['s1'] },
        'src/core/scanner.ts': { editCount: 3, sessionIds: ['s1'] },
      });

      const report = analyzeFileHeatmap(stats);
      expect(report.testCorrelation.withoutTestActivity).toBe(2);
      expect(report.testCorrelation.untestedFiles).toContain('src/utils/helpers.ts');
      expect(report.testCorrelation.untestedFiles).toContain('src/core/scanner.ts');
    });

    it('calculates correlation percentage', () => {
      const stats = makeStats({
        'src/a.ts': { editCount: 1, sessionIds: ['s1'] },
        'src/a.test.ts': { editCount: 1, sessionIds: ['s1'] },
        'src/b.ts': { editCount: 1, sessionIds: ['s1'] },
        'src/b.test.ts': { editCount: 1, sessionIds: ['s1'] },
        'src/c.ts': { editCount: 1, sessionIds: ['s1'] },
        'src/d.ts': { editCount: 1, sessionIds: ['s1'] },
        'src/e.ts': { editCount: 1, sessionIds: ['s1'] },
        'src/f.ts': { editCount: 1, sessionIds: ['s1'] },
        'src/g.ts': { editCount: 1, sessionIds: ['s1'] },
        'src/h.ts': { editCount: 1, sessionIds: ['s1'] },
      });

      const report = analyzeFileHeatmap(stats);
      // 8 source files (a-h .ts, excluding test files)
      // 2 have test files (a, b)
      expect(report.testCorrelation.editedSourceFiles).toBe(8);
      expect(report.testCorrelation.withTestActivity).toBe(2);
      expect(report.testCorrelation.correlationPercent).toBe(25);
    });

    it('excludes test files from source file count', () => {
      const stats = makeStats({
        'src/a.ts': { editCount: 1, sessionIds: ['s1'] },
        'src/a.test.ts': { editCount: 5, sessionIds: ['s1'] },
        'tests/b.test.ts': { editCount: 3, sessionIds: ['s1'] },
      });

      const report = analyzeFileHeatmap(stats);
      // Only src/a.ts is a "source file"; test files are excluded
      expect(report.testCorrelation.editedSourceFiles).toBe(1);
    });

    it('matches Python test_<name>.py conventions', () => {
      const stats = makeStats({
        'backend/app/services/pipeline.py': { editCount: 5, sessionIds: ['s1'] },
        'backend/tests/test_pipeline.py': { editCount: 3, sessionIds: ['s1'] },
      });

      const report = analyzeFileHeatmap(stats);
      expect(report.testCorrelation.withTestActivity).toBe(1);
      expect(report.testCorrelation.correlationPercent).toBe(100);
    });

    it('matches Python test files at project root tests/', () => {
      const stats = makeStats({
        'app/models/user.py': { editCount: 4, sessionIds: ['s1'] },
        'tests/test_user.py': { editCount: 2, sessionIds: ['s1'] },
      });

      const report = analyzeFileHeatmap(stats);
      expect(report.testCorrelation.withTestActivity).toBe(1);
    });

    it('fuzzy-matches test files across directory structures', () => {
      const stats = makeStats({
        'backend/app/services/nlp/pipeline.py': { editCount: 5, sessionIds: ['s1'] },
        'backend/tests/test_pipeline.py': { editCount: 3, sessionIds: ['s1'] },
      });

      const report = analyzeFileHeatmap(stats);
      expect(report.testCorrelation.withTestActivity).toBe(1);
    });
  });

  describe('exclusion patterns', () => {
    it('excludes node_modules files', () => {
      const stats = makeStats({
        'node_modules/chalk/index.js': { editCount: 100, sessionIds: ['s1'] },
        'src/real.ts': { editCount: 1, sessionIds: ['s1'] },
      });

      const report = analyzeFileHeatmap(stats);
      expect(report.highChurn).toHaveLength(1);
      expect(report.highChurn[0].filePath).toBe('src/real.ts');
    });

    it('excludes lock files', () => {
      const stats = makeStats({
        'package-lock.json': { editCount: 50, sessionIds: ['s1'] },
        'yarn.lock': { editCount: 30, sessionIds: ['s1'] },
        'src/real.ts': { editCount: 1, sessionIds: ['s1'] },
      });

      const report = analyzeFileHeatmap(stats);
      expect(report.highChurn).toHaveLength(1);
      expect(report.totalFilesTracked).toBe(1);
    });

    it('excludes Claude Code plan files from all categories', () => {
      const stats = makeStats({
        '~/.claude/plans/transient-sleeping-sun.md': {
          editCount: 20,
          readCount: 10,
          sessionIds: ['s1', 's2'],
        },
        '~/.claude/tasks/task-123.md': {
          editCount: 5,
          sessionIds: ['s1'],
        },
        '~/.claude/teams/inbox.json': {
          readCount: 15,
          sessionIds: ['s1'],
        },
        '~/.claude/inboxes/msg.json': {
          readCount: 3,
          sessionIds: ['s1'],
        },
        '.claude/settings.local.json': {
          readCount: 50,
          sessionIds: ['s1', 's2', 's3'],
        },
        'src/real.ts': { editCount: 1, sessionIds: ['s1'] },
      });

      const report = analyzeFileHeatmap(stats);
      expect(report.totalFilesTracked).toBe(1);
      expect(report.highChurn).toHaveLength(1);
      expect(report.highChurn[0].filePath).toBe('src/real.ts');
      expect(report.readOnlyReferences).toHaveLength(0);
    });

    it('keeps user-authored .claude/ config files', () => {
      const stats = makeStats({
        '.claude/rules/api-contracts.md': {
          readCount: 10,
          sessionIds: ['s1'],
        },
        '.claude/agents/reviewer.md': {
          readCount: 5,
          sessionIds: ['s1'],
        },
      });

      const report = analyzeFileHeatmap(stats);
      expect(report.totalFilesTracked).toBe(2);
      expect(report.readOnlyReferences).toHaveLength(2);
    });
  });

  describe('empty activity', () => {
    it('handles zero files gracefully', () => {
      const stats = makeStats({});

      const report = analyzeFileHeatmap(stats);
      expect(report.highChurn).toHaveLength(0);
      expect(report.readOnlyReferences).toHaveLength(0);
      expect(report.editWithoutRead).toHaveLength(0);
      expect(report.testCorrelation.editedSourceFiles).toBe(0);
      expect(report.testCorrelation.correlationPercent).toBe(0);
      expect(report.totalFilesTracked).toBe(0);
    });
  });

  describe('maxResults', () => {
    it('limits results per category', () => {
      const files: Record<string, Partial<FileActivity> & { sessionIds?: string[] }> = {};
      for (let i = 0; i < 20; i++) {
        files[`src/file${i}.ts`] = { editCount: 20 - i, sessionIds: ['s1'] };
      }
      const stats = makeStats(files);

      const report = analyzeFileHeatmap(stats, { maxResults: 5 });
      expect(report.highChurn).toHaveLength(5);
    });
  });

  describe('co-edit clusters', () => {
    it('returns null when too many files', () => {
      const files: Record<string, Partial<FileActivity> & { sessionIds?: string[] }> = {};
      for (let i = 0; i < 201; i++) {
        files[`src/file${i}.ts`] = { editCount: 1, sessionIds: ['s1'] };
      }
      const stats = makeStats(files);

      const report = analyzeFileHeatmap(stats, { clusterMaxFiles: 200 });
      expect(report.coEditClusters).toBeNull();
    });

    it('returns empty array when no clusters found', () => {
      const stats = makeStats({
        'src/a.ts': { editCount: 1, sessionIds: ['s1'] },
        'src/b.ts': { editCount: 1, sessionIds: ['s2'] },
      });

      const report = analyzeFileHeatmap(stats, { clusterThreshold: 3 });
      expect(report.coEditClusters).toEqual([]);
    });

    it('detects files edited in same sessions', () => {
      const sharedSessions = ['s1', 's2', 's3', 's4', 's5'];
      const stats = makeStats({
        'src/core/scanner.ts': { editCount: 10, sessionIds: sharedSessions },
        'src/types/inventory.ts': { editCount: 8, sessionIds: sharedSessions },
        'tests/core/scanner.test.ts': { editCount: 6, sessionIds: sharedSessions },
        'src/unrelated.ts': { editCount: 2, sessionIds: ['s99'] },
      });

      const report = analyzeFileHeatmap(stats, { clusterThreshold: 3 });
      expect(report.coEditClusters).not.toBeNull();
      expect(report.coEditClusters!.length).toBeGreaterThanOrEqual(1);
      const cluster = report.coEditClusters![0];
      expect(cluster.files).toContain('src/core/scanner.ts');
      expect(cluster.files).toContain('src/types/inventory.ts');
      expect(cluster.sharedSessions).toBeGreaterThanOrEqual(3);
    });

    it('scales cluster threshold with session count', () => {
      // 40 sessions → threshold = ceil(40 * 0.15) = 6
      const sessionIds = Array.from({ length: 40 }, (_, i) => `s${i}`);
      const sharedSessions = sessionIds.slice(0, 4); // Only 4 shared — below threshold of 6
      const stats = makeStats({
        'src/a.ts': { editCount: 10, sessionIds: sharedSessions },
        'src/b.ts': { editCount: 8, sessionIds: sharedSessions },
        'src/c.ts': { editCount: 6, sessionIds: sharedSessions },
      });
      stats.sessionsAnalyzed = 40;

      // Without explicit threshold, auto-scales to 6 → 4 shared sessions is below
      const report = analyzeFileHeatmap(stats);
      expect(report.coEditClusters).toEqual([]);
    });

    it('drops clusters exceeding 10 files', () => {
      // Create 12 files all sharing 5 sessions — forms one mega-cluster
      const sharedSessions = ['s1', 's2', 's3', 's4', 's5'];
      const files: Record<string, Partial<FileActivity> & { sessionIds?: string[] }> = {};
      for (let i = 0; i < 12; i++) {
        files[`src/file${i}.ts`] = { editCount: 5, sessionIds: sharedSessions };
      }
      const stats = makeStats(files);

      const report = analyzeFileHeatmap(stats, { clusterThreshold: 3 });
      // The single cluster of 12 files should be dropped (>10)
      expect(report.coEditClusters).toEqual([]);
    });
  });
});
