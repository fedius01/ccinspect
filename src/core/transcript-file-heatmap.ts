import { extname, basename, dirname, join } from 'path';
import type {
  AggregateStats,
  FileActivity,
  FileHeatmapReport,
  FileHeatmapEntry,
  FileCluster,
} from '../types/transcript.js';

/** Patterns to exclude from all heatmap analyses. */
const EXCLUDE_PATTERNS = [
  /node_modules\//,
  /\.git\//,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /bun\.lockb$/,
  /\.lock$/,
  // Claude Code internal files — not user-relevant activity
  /[/\\]\.claude[/\\]plans[/\\]/,
  /[/\\]\.claude[/\\]tasks[/\\]/,
  /[/\\]\.claude[/\\]teams[/\\]/,
  /[/\\]\.claude[/\\]inboxes[/\\]/,
  /\.claude[/\\]settings\.local\.json$/,
];

function isExcluded(filePath: string): boolean {
  return EXCLUDE_PATTERNS.some((p) => p.test(filePath));
}

interface FileHeatmapOptions {
  /** Max entries per category (default: 10). */
  maxResults?: number;
  /** Minimum shared sessions for co-edit clustering (default: 3). */
  clusterThreshold?: number;
  /** Max edited files before skipping clustering (default: 200). */
  clusterMaxFiles?: number;
}

/**
 * Analyze file activity patterns from aggregate stats.
 * Pure function — no filesystem access.
 */
export function analyzeFileHeatmap(
  stats: AggregateStats,
  options?: FileHeatmapOptions,
): FileHeatmapReport {
  const maxResults = options?.maxResults ?? 10;
  // Scale cluster threshold with session count: max(3, ceil(sessions * 0.15))
  const clusterThreshold =
    options?.clusterThreshold ??
    Math.max(3, Math.ceil(stats.sessionsAnalyzed * 0.15));
  const clusterMaxFiles = options?.clusterMaxFiles ?? 200;

  // Convert to array, filtering excluded patterns
  const entries: Array<{ filePath: string; activity: FileActivity }> = [];
  for (const [filePath, activity] of stats.fileActivity) {
    if (!isExcluded(filePath)) {
      entries.push({ filePath, activity });
    }
  }

  const highChurn = computeHighChurn(entries, maxResults);
  const readOnlyReferences = computeReadOnlyReferences(entries, maxResults);
  const editWithoutRead = computeEditWithoutRead(entries, maxResults);
  const testCorrelation = computeTestCorrelation(entries, maxResults);
  const coEditClusters = computeCoEditClusters(
    entries,
    clusterThreshold,
    clusterMaxFiles,
  );

  return {
    highChurn,
    readOnlyReferences,
    editWithoutRead,
    testCorrelation,
    coEditClusters,
    totalFilesTracked: entries.length,
  };
}

function computeHighChurn(
  entries: Array<{ filePath: string; activity: FileActivity }>,
  maxResults: number,
): FileHeatmapEntry[] {
  return entries
    .filter((e) => e.activity.editCount + e.activity.writeCount > 0)
    .sort(
      (a, b) =>
        b.activity.editCount +
        b.activity.writeCount -
        (a.activity.editCount + a.activity.writeCount),
    )
    .slice(0, maxResults)
    .map((e) => {
      const totalEdits = e.activity.editCount + e.activity.writeCount;
      const sessionCount = e.activity.sessions.size;
      return {
        filePath: e.filePath,
        readCount: e.activity.readCount,
        editCount: e.activity.editCount,
        writeCount: e.activity.writeCount,
        sessionCount,
        editsPerSession:
          sessionCount > 0
            ? Math.round((totalEdits / sessionCount) * 10) / 10
            : 0,
      };
    });
}

function computeReadOnlyReferences(
  entries: Array<{ filePath: string; activity: FileActivity }>,
  maxResults: number,
): FileHeatmapEntry[] {
  return entries
    .filter(
      (e) =>
        e.activity.readCount > 0 &&
        e.activity.editCount === 0 &&
        e.activity.writeCount === 0,
    )
    .sort((a, b) => b.activity.readCount - a.activity.readCount)
    .slice(0, maxResults)
    .map((e) => ({
      filePath: e.filePath,
      readCount: e.activity.readCount,
      editCount: 0,
      writeCount: 0,
      sessionCount: e.activity.sessions.size,
    }));
}

function computeEditWithoutRead(
  entries: Array<{ filePath: string; activity: FileActivity }>,
  maxResults: number,
): FileHeatmapEntry[] {
  return entries
    .filter(
      (e) =>
        (e.activity.editCount > 0 || e.activity.writeCount > 0) &&
        e.activity.readCount === 0,
    )
    .sort(
      (a, b) =>
        b.activity.editCount +
        b.activity.writeCount -
        (a.activity.editCount + a.activity.writeCount),
    )
    .slice(0, maxResults)
    .map((e) => ({
      filePath: e.filePath,
      readCount: 0,
      editCount: e.activity.editCount,
      writeCount: e.activity.writeCount,
      sessionCount: e.activity.sessions.size,
    }));
}

/** Common test file naming conventions. */
function findTestFile(
  filePath: string,
  allFiles: Set<string>,
): string | null {
  const ext = extname(filePath);
  const base = basename(filePath, ext);
  const dir = dirname(filePath);

  const candidates = [
    // Same directory: foo.test.ts, foo.spec.ts
    join(dir, `${base}.test${ext}`),
    join(dir, `${base}.spec${ext}`),
    // __tests__ subdirectory
    join(dir, '__tests__', `${base}${ext}`),
    join(dir, '__tests__', `${base}.test${ext}`),
    // tests/ mirror of src/
    filePath.replace(/^src\//, 'tests/').replace(ext, `.test${ext}`),
    filePath.replace(/^src\//, 'test/').replace(ext, `.test${ext}`),
    // Python conventions: test_<name>.py in same dir
    join(dir, `test_${base}${ext}`),
    join(dir, `${base}_test${ext}`),
    // Python: tests/ directory at project or package root
    `tests/test_${base}${ext}`,
  ];

  // Add Python tests/ directory relative to package roots (e.g., backend/tests/)
  const parts = dir.split('/');
  for (let i = 0; i < parts.length; i++) {
    const root = parts.slice(0, i + 1).join('/');
    candidates.push(join(root, 'tests', `test_${base}${ext}`));
  }

  const exact = candidates.find((c) => allFiles.has(c));
  if (exact) return exact;

  // Fuzzy fallback: check if any file in the activity map matches test_<base> or <base>.test
  const testPatterns = [
    new RegExp(`(^|/)test_${escapeRegex(base)}\\${ext}$`),
    new RegExp(`(^|/)${escapeRegex(base)}\\.test\\${ext}$`),
    new RegExp(`(^|/)${escapeRegex(base)}\\.spec\\${ext}$`),
    new RegExp(`(^|/)${escapeRegex(base)}_test\\${ext}$`),
  ];

  for (const file of allFiles) {
    if (testPatterns.some((p) => p.test(file))) {
      return file;
    }
  }

  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Test file patterns to exclude from "source files" consideration. */
const TEST_FILE_PATTERN =
  /\.(test|spec)\.[^.]+$|__tests__\/|^tests?\/|test_[^/]+$|_test\.[^.]+$/;

function isTestFile(filePath: string): boolean {
  return TEST_FILE_PATTERN.test(filePath);
}

/** Source code extensions worth tracking for test correlation. */
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.cs',
  '.cpp',
  '.c',
  '.h',
]);

function isSourceFile(filePath: string): boolean {
  return SOURCE_EXTENSIONS.has(extname(filePath));
}

function computeTestCorrelation(
  entries: Array<{ filePath: string; activity: FileActivity }>,
  maxUntestedResults: number,
): FileHeatmapReport['testCorrelation'] {
  // Build set of all files with any edit activity
  const allFiles = new Set(entries.map((e) => e.filePath));
  // Files with any activity at all (read or edit)
  const filesWithActivity = new Set(
    entries
      .filter(
        (e) =>
          e.activity.readCount > 0 ||
          e.activity.editCount > 0 ||
          e.activity.writeCount > 0,
      )
      .map((e) => e.filePath),
  );

  // Source files that were edited
  const editedSourceFiles = entries.filter(
    (e) =>
      (e.activity.editCount > 0 || e.activity.writeCount > 0) &&
      isSourceFile(e.filePath) &&
      !isTestFile(e.filePath),
  );

  let withTestActivity = 0;
  let withoutTestActivity = 0;
  const untestedFiles: string[] = [];

  for (const entry of editedSourceFiles) {
    const testFile = findTestFile(entry.filePath, allFiles);
    if (testFile && filesWithActivity.has(testFile)) {
      withTestActivity++;
    } else {
      withoutTestActivity++;
      untestedFiles.push(entry.filePath);
    }
  }

  // Sort untested by edit count descending, take top N
  const sortedUntested = untestedFiles
    .map((fp) => {
      const act = entries.find((e) => e.filePath === fp)?.activity;
      return { fp, edits: (act?.editCount ?? 0) + (act?.writeCount ?? 0) };
    })
    .sort((a, b) => b.edits - a.edits)
    .slice(0, maxUntestedResults)
    .map((e) => e.fp);

  const total = editedSourceFiles.length;
  return {
    editedSourceFiles: total,
    withTestActivity,
    withoutTestActivity,
    correlationPercent: total > 0 ? Math.round((withTestActivity / total) * 100) : 0,
    untestedFiles: sortedUntested,
  };
}

function computeCoEditClusters(
  entries: Array<{ filePath: string; activity: FileActivity }>,
  minSharedSessions: number,
  maxFiles: number,
): FileCluster[] | null {
  // Only consider files with edits
  const editedEntries = entries.filter(
    (e) => e.activity.editCount > 0 || e.activity.writeCount > 0,
  );

  if (editedEntries.length > maxFiles) {
    return null; // Too many files for O(n²) analysis
  }

  if (editedEntries.length < 2) {
    return [];
  }

  // Build adjacency: pairs of files with >= minSharedSessions overlap
  const pairs: Array<{ a: string; b: string; shared: number }> = [];
  for (let i = 0; i < editedEntries.length; i++) {
    for (let j = i + 1; j < editedEntries.length; j++) {
      const sessA = editedEntries[i].activity.sessions;
      const sessB = editedEntries[j].activity.sessions;
      let shared = 0;
      for (const s of sessA) {
        if (sessB.has(s)) shared++;
      }
      if (shared >= minSharedSessions) {
        pairs.push({
          a: editedEntries[i].filePath,
          b: editedEntries[j].filePath,
          shared,
        });
      }
    }
  }

  if (pairs.length === 0) return [];

  // Simple greedy clustering: group files connected by strong pairs
  const clusters: FileCluster[] = [];
  const assigned = new Set<string>();

  // Sort pairs by shared sessions descending
  pairs.sort((a, b) => b.shared - a.shared);

  for (const pair of pairs) {
    if (assigned.has(pair.a) && assigned.has(pair.b)) continue;

    // Find or create cluster
    const existingCluster = clusters.find(
      (c) => c.files.includes(pair.a) || c.files.includes(pair.b),
    );

    if (existingCluster) {
      if (!existingCluster.files.includes(pair.a)) {
        existingCluster.files.push(pair.a);
        assigned.add(pair.a);
      }
      if (!existingCluster.files.includes(pair.b)) {
        existingCluster.files.push(pair.b);
        assigned.add(pair.b);
      }
      // Update to minimum shared sessions in cluster
      existingCluster.sharedSessions = Math.min(
        existingCluster.sharedSessions,
        pair.shared,
      );
    } else {
      clusters.push({
        files: [pair.a, pair.b],
        sharedSessions: pair.shared,
      });
      assigned.add(pair.a);
      assigned.add(pair.b);
    }
  }

  // Filter: only keep clusters with 3+ files, drop clusters >10 files (too broad)
  return clusters
    .filter((c) => c.files.length >= 3 && c.files.length <= 10)
    .sort((a, b) => b.sharedSessions - a.sharedSessions);
}
