import type { HistoryEntry, VersionAttribution, VersionUtilizationEntry } from '../types/history.js';
import type { AggregateStats, DelegationRecord } from '../types/transcript.js';
import { computeLineage } from './history-reconstructor.js';

/**
 * Attribute transcript sessions to config versions from the history timeline.
 *
 * For each session, finds the latest version with timestamp ≤ session start.
 * Sessions before v1 are attributed to v1 with confidence 'estimated'.
 * When no history exists, all sessions get confidence 'unattributed'.
 */
export function attributeSessions(
  sessionStartDates: Map<string, Date>,
  history: HistoryEntry[],
): VersionAttribution[] {
  if (sessionStartDates.size === 0) return [];

  // No history → all unattributed
  if (history.length === 0) {
    return [...sessionStartDates.entries()].map(([sessionId]) => ({
      sessionId,
      configVersion: 0,
      inActiveLineage: false,
      confidence: 'unattributed' as const,
    }));
  }

  const lineage = computeLineage(history);

  // Sort entries by timestamp for binary search
  const sorted = [...history].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const results: VersionAttribution[] = [];

  for (const [sessionId, sessionStart] of sessionStartDates) {
    const sessionMs = sessionStart.getTime();
    const firstVersionMs = new Date(sorted[0].timestamp).getTime();

    if (sessionMs < firstVersionMs) {
      // Pre-history session → attribute to v1
      results.push({
        sessionId,
        configVersion: sorted[0].version,
        inActiveLineage: lineage.has(sorted[0].version),
        confidence: 'estimated',
      });
      continue;
    }

    // Binary search for latest version with timestamp ≤ sessionStart
    let lo = 0;
    let hi = sorted.length - 1;
    let best = 0;

    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const midMs = new Date(sorted[mid].timestamp).getTime();
      if (midMs <= sessionMs) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    const version = sorted[best];
    results.push({
      sessionId,
      configVersion: version.version,
      inActiveLineage: lineage.has(version.version),
      confidence: 'exact',
    });
  }

  return results;
}

/**
 * Build a per-version utilization breakdown from attributed sessions.
 *
 * Groups sessions by their attributed version and computes delegation
 * counts per version. Entries are ordered by version number descending.
 */
export function buildVersionBreakdown(
  attributions: VersionAttribution[],
  history: HistoryEntry[],
  stats: AggregateStats,
): VersionUtilizationEntry[] {
  if (history.length === 0 || attributions.length === 0) return [];

  const lineage = computeLineage(history);

  // Group attributions by version
  const versionSessions = new Map<number, string[]>();
  for (const attr of attributions) {
    if (attr.configVersion === 0) continue;
    const existing = versionSessions.get(attr.configVersion) ?? [];
    existing.push(attr.sessionId);
    versionSessions.set(attr.configVersion, existing);
  }

  // Sort history by version for time range computation
  const sortedByVersion = [...history].sort((a, b) => a.version - b.version);

  const entries: VersionUtilizationEntry[] = [];

  for (const entry of sortedByVersion) {
    const sessions = versionSessions.get(entry.version) ?? [];

    // Compute active range: from this version's timestamp to next version's timestamp
    const idx = sortedByVersion.indexOf(entry);
    const nextEntry = idx < sortedByVersion.length - 1 ? sortedByVersion[idx + 1] : null;
    const activeFrom = entry.timestamp;
    const activeTo = nextEntry ? nextEntry.timestamp : null;

    // Compute active days
    const fromMs = new Date(activeFrom).getTime();
    const toMs = activeTo ? new Date(activeTo).getTime() : Date.now();
    const activeDays = Math.max(1, Math.round((toMs - fromMs) / (1000 * 60 * 60 * 24)));

    // Compute top delegations for sessions in this version
    const topDelegations = computeTopDelegations(sessions, stats.delegations);

    entries.push({
      version: entry.version,
      inActiveLineage: lineage.has(entry.version),
      source: entry.source,
      timestamp: entry.timestamp,
      ...(entry.restoredFrom !== undefined ? { restoredFrom: entry.restoredFrom } : {}),
      activeFrom,
      activeTo,
      sessionCount: sessions.length,
      activeDays,
      topDelegations,
    });
  }

  // Return sorted by version descending (newest first)
  return entries.sort((a, b) => b.version - a.version);
}

/**
 * Count superseded sessions (not in active lineage) for summary display.
 */
export function countSupersededSessions(attributions: VersionAttribution[]): {
  count: number;
  versions: Set<number>;
} {
  const versions = new Set<number>();
  let count = 0;
  for (const attr of attributions) {
    if (!attr.inActiveLineage && attr.configVersion > 0) {
      count++;
      versions.add(attr.configVersion);
    }
  }
  return { count, versions };
}

/**
 * Detect if transcript retention may have caused data loss.
 *
 * Returns a warning message if the history goes back further than
 * the oldest available session, suggesting data has been cleaned up.
 */
export function detectRetentionGap(
  history: HistoryEntry[],
  stats: AggregateStats,
): string | null {
  if (history.length === 0 || stats.sessionsAnalyzed === 0) return null;

  const oldestVersion = new Date(history[0].timestamp);
  const oldestSession = stats.dateRange.from;

  // If oldest version predates oldest session by more than 7 days,
  // sessions were likely cleaned up
  const gapDays = (oldestSession.getTime() - oldestVersion.getTime()) / (1000 * 60 * 60 * 24);

  if (gapDays > 7) {
    const totalDays = Math.round(
      (Date.now() - oldestVersion.getTime()) / (1000 * 60 * 60 * 24),
    );
    const availableDays = Math.round(
      (Date.now() - oldestSession.getTime()) / (1000 * 60 * 60 * 24),
    );
    return (
      `Config history spans ${totalDays} days but transcripts only cover ${availableDays} days. ` +
      `Set cleanupPeriodDays to 99999 in ~/.claude/settings.json for full coverage.`
    );
  }

  return null;
}

// ---- Helpers ----

function computeTopDelegations(
  sessionIds: string[],
  allDelegations: DelegationRecord[],
): Array<{ agent: string; count: number }> {
  if (sessionIds.length === 0 || allDelegations.length === 0) return [];

  const sessionSet = new Set(sessionIds);
  const counts = new Map<string, number>();

  for (const del of allDelegations) {
    // Count sessions that overlap with this version's sessions
    const overlap = del.sessionIds.filter((s) => sessionSet.has(s)).length;
    if (overlap > 0) {
      counts.set(del.agentName, (counts.get(del.agentName) ?? 0) + overlap);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([agent, count]) => ({ agent, count }));
}
