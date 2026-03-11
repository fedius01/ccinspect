import { resolve } from 'path';
import type {
  AggregateStats,
  UsageSummary,
  FileActivity,
  DelegationRecord,
  SkillActivationRecord,
  SessionFileInfo,
  TokenEconomicsReport,
  SessionTokenSnapshot,
  CacheMissBreakdown,
  MessageTokenSnapshot,
} from '../types/transcript.js';
import type { TranscriptParseResult } from '../parsers/transcript-jsonl.js';
import { parseTranscriptFile } from '../parsers/transcript-jsonl.js';
import { discoverTranscripts } from '../utils/transcript-discovery.js';
import { readCache, writeCache } from './transcript-cache.js';
import type { CacheEntry } from './transcript-cache.js';

// Built-in tool names that are NOT skills
const BUILTIN_TOOLS = new Set([
  'Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep',
  'Task', 'Agent', 'TodoRead', 'TodoWrite',
  'WebSearch', 'WebFetch', 'AskUser',
  'LS', 'NotebookEdit', 'NotebookRead',
  'Skill', 'ExitPlanMode', 'EnterPlanMode',
]);

export interface AnalyzerOptions {
  /** Filter sessions to last N days (default: 30). */
  days?: number;
  /** Analyze a single specific session. */
  sessionId?: string;
  /** Current project root for discovery. */
  projectRoot: string;
}

/**
 * Load and aggregate transcript data for a project.
 *
 * Pipeline: discover sessions → filter by date → for each session:
 *   try cache → if miss, parse file → write cache → collect results
 * Then aggregate across all sessions.
 */
export async function analyzeTranscripts(
  options: AnalyzerOptions,
): Promise<AggregateStats> {
  const projectRoot = resolve(options.projectRoot);
  const days = options.days ?? 30;

  const discovery = await discoverTranscripts(projectRoot);
  if (!discovery || discovery.sessionFiles.length === 0) {
    return createEmptyStats();
  }

  // Filter sessions
  let files = discovery.sessionFiles;
  if (options.sessionId) {
    files = files.filter((f) => f.sessionId === options.sessionId);
  } else {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    files = files.filter((f) => f.lastModified >= cutoff);
  }

  if (files.length === 0) {
    return createEmptyStats();
  }

  // Parse each session (with caching)
  const results: TranscriptParseResult[] = [];
  for (const file of files) {
    const result = await loadSession(file);
    if (result) results.push(result);
  }

  return aggregateParseResults(results, projectRoot);
}

/**
 * Same as analyzeTranscripts but also returns the raw parse results
 * (needed for token economics per-message analysis).
 */
export async function analyzeTranscriptsWithResults(
  options: AnalyzerOptions,
): Promise<{ stats: AggregateStats; parseResults: TranscriptParseResult[] }> {
  const projectRoot = resolve(options.projectRoot);
  const days = options.days ?? 30;

  const discovery = await discoverTranscripts(projectRoot);
  if (!discovery || discovery.sessionFiles.length === 0) {
    return { stats: createEmptyStats(), parseResults: [] };
  }

  let files = discovery.sessionFiles;
  if (options.sessionId) {
    files = files.filter((f) => f.sessionId === options.sessionId);
  } else {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    files = files.filter((f) => f.lastModified >= cutoff);
  }

  if (files.length === 0) {
    return { stats: createEmptyStats(), parseResults: [] };
  }

  const results: TranscriptParseResult[] = [];
  for (const file of files) {
    const result = await loadSession(file);
    if (result) results.push(result);
  }

  return {
    stats: aggregateParseResults(results, projectRoot),
    parseResults: results,
  };
}

/**
 * Load a session from cache or parse fresh.
 */
async function loadSession(file: SessionFileInfo): Promise<TranscriptParseResult | null> {
  const mtime = file.lastModified.getTime();

  // Try cache
  const cached = await readCache(file.sessionId, file.filePath, file.fileSize, mtime);
  if (cached) {
    return cacheEntryToParseResult(cached);
  }

  // Parse fresh
  try {
    const result = await parseTranscriptFile(file.filePath);
    // Write to cache (best-effort)
    await writeCache(file.sessionId, file.filePath, file.fileSize, mtime, result);
    return result;
  } catch {
    return null;
  }
}

/**
 * Convert a CacheEntry back to a TranscriptParseResult.
 * Reconstructs Date objects from ISO strings. Only includes the fields
 * needed for aggregation (no events, no parseWarnings).
 */
function cacheEntryToParseResult(entry: CacheEntry): TranscriptParseResult {
  return {
    session: {
      sessionId: entry.sessionId,
      claudeCodeVersion: entry.claudeCodeVersion,
      model: entry.model,
      projectRoot: entry.projectRoot,
      gitBranch: entry.gitBranch,
      startedAt: new Date(entry.startedAt),
      endedAt: entry.endedAt ? new Date(entry.endedAt) : null,
      sourceFile: entry.filePath,
      events: [],
      parseWarnings: [],
      completeness: entry.completeness,
      skippedLineTypes: entry.skippedLineTypes,
    },
    toolCalls: entry.toolCalls,
    toolResults: entry.toolResults,
    tasks: entry.tasks.map((t) => ({
      prompt: t.prompt,
      startedAt: new Date(t.startedAt),
      endedAt: t.endedAt ? new Date(t.endedAt) : undefined,
      toolCalls: t.toolCalls,
      toolResults: t.toolResults,
      outcome: t.outcome,
    })),
    tokenUsage: entry.tokenUsage,
    messageTokens: (entry.messageTokens ?? []).map((mt) => ({
      timestamp: new Date(mt.timestamp),
      inputTokens: mt.inputTokens,
      outputTokens: mt.outputTokens,
      cacheCreationTokens: mt.cacheCreationTokens,
      cacheReadTokens: mt.cacheReadTokens,
      model: mt.model,
    })),
  };
}

/**
 * Pure aggregation function: takes parsed results and produces aggregate stats.
 * No filesystem or cache access — fully testable.
 */
export function aggregateParseResults(
  results: TranscriptParseResult[],
  projectRoot?: string,
): AggregateStats {
  if (results.length === 0) {
    return createEmptyStats();
  }

  let sessionsExact = 0;
  let sessionsPartial = 0;
  let sessionsDamaged = 0;
  let totalTurns = 0;
  let totalToolCalls = 0;

  const toolDistribution = new Map<string, number>();
  const fileActivity = new Map<string, FileActivity>();
  const delegationMap = new Map<string, { count: number; sessionIds: Set<string>; hasTeamName: boolean }>();
  /** Sessions that contained Teammate tool calls (Agent Teams indicator). */
  const teamSessions = new Set<string>();
  const skillMap = new Map<string, { explicit: number; auto: number; sessionIds: Set<string> }>();
  const bashCommandTokens = new Set<string>();

  // Token aggregation
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;
  let totalCache5m = 0;
  let totalCache1h = 0;
  let sessionsWithTokenData = 0;

  let earliestDate: Date | null = null;
  let latestDate: Date | null = null;

  for (const result of results) {
    const sid = result.session.sessionId;

    // Completeness
    switch (result.session.completeness) {
      case 'exact': sessionsExact++; break;
      case 'partial': sessionsPartial++; break;
      case 'damaged': sessionsDamaged++; break;
    }

    // Date range — skip epoch dates (damaged sessions with no timestamps)
    const startMs = result.session.startedAt.getTime();
    if (startMs > 0) {
      if (!earliestDate || result.session.startedAt < earliestDate) {
        earliestDate = result.session.startedAt;
      }
    }
    const endDate = result.session.endedAt ?? result.session.startedAt;
    const endMs = endDate.getTime();
    if (endMs > 0 && (!latestDate || endDate > latestDate)) {
      latestDate = endDate;
    }

    // Count user prompts as turns
    totalTurns += result.tasks.length;

    // Tool calls
    totalToolCalls += result.toolCalls.length;
    for (const tc of result.toolCalls) {
      toolDistribution.set(tc.toolName, (toolDistribution.get(tc.toolName) ?? 0) + 1);

      // File activity
      const filePath = extractFilePath(tc, projectRoot);
      if (filePath) {
        incrementFileActivity(fileActivity, filePath, tc.toolName, sid);
      }

      // Bash command tokens — extract words from Bash commands for CLI-grounded filtering
      if (tc.toolName === 'Bash' && typeof tc.input.command === 'string') {
        for (const token of tc.input.command.split(/[\s|;&]+/)) {
          const clean = token.toLowerCase().replace(/^['"]+|['"]+$/g, '');
          if (clean.length > 0) bashCommandTokens.add(clean);
        }
      }

      // Detect Agent Teams sessions via Teammate tool calls
      if (tc.toolName === 'Teammate') {
        teamSessions.add(sid);
      }

      // Delegations (Task/Agent tool)
      if (tc.toolName === 'Task' || tc.toolName === 'Agent') {
        const agentName = extractAgentName(tc);
        if (agentName) {
          const existing = delegationMap.get(agentName);
          if (existing) {
            existing.count++;
            existing.sessionIds.add(sid);
            // Mark as team if any delegation has team_name
            if (tc.teamName) existing.hasTeamName = true;
          } else {
            delegationMap.set(agentName, {
              count: 1,
              sessionIds: new Set([sid]),
              hasTeamName: !!tc.teamName,
            });
          }
        }
      }

      // Skill activations (Skill tool)
      if (tc.toolName === 'Skill') {
        const skillName = extractSkillName(tc);
        if (skillName) {
          const existing = skillMap.get(skillName);
          if (existing) {
            existing.explicit++;
            existing.sessionIds.add(sid);
          } else {
            skillMap.set(skillName, { explicit: 1, auto: 0, sessionIds: new Set([sid]) });
          }
        }
      }
    }

    // Check user prompts for /command patterns
    for (const task of result.tasks) {
      const match = task.prompt.match(/^\/([a-zA-Z][\w-]*)/);
      if (match) {
        const name = match[1];
        const existing = skillMap.get(name);
        if (existing) {
          existing.explicit++;
          existing.sessionIds.add(sid);
        } else {
          skillMap.set(name, { explicit: 1, auto: 0, sessionIds: new Set([sid]) });
        }
      }
    }

    // Token usage
    const usage = result.tokenUsage;
    if (usage.sessionsWithData > 0) {
      sessionsWithTokenData++;
      totalInput += usage.inputTokens;
      totalOutput += usage.outputTokens;
      totalCacheRead += usage.cacheReadTokens;
      totalCacheCreation += usage.cacheCreationTokens;
      totalCache5m += usage.cache5mTokens;
      totalCache1h += usage.cache1hTokens;
    }
  }

  // Build delegation records
  const delegations: DelegationRecord[] = [];
  for (const [agentName, data] of delegationMap) {
    // Classify as ephemeral teammate:
    // 1. Definitive: Task tool call has team_name
    // 2. Fallback: single-session delegation AND that session has Teammate tool calls
    const sessionIdArr = [...data.sessionIds];
    const isEphemeral = data.hasTeamName ||
      (sessionIdArr.length === 1 && teamSessions.has(sessionIdArr[0]));

    delegations.push({
      agentName,
      count: data.count,
      sessionIds: sessionIdArr,
      isEphemeralTeammate: isEphemeral,
    });
  }
  delegations.sort((a, b) => b.count - a.count);

  // Build skill activation records
  const skillActivations: SkillActivationRecord[] = [];
  for (const [skillName, data] of skillMap) {
    skillActivations.push({
      skillName,
      explicitCount: data.explicit,
      autoCount: data.auto,
      sessionIds: [...data.sessionIds],
    });
  }
  skillActivations.sort((a, b) => (b.explicitCount + b.autoCount) - (a.explicitCount + a.autoCount));

  const tokenUsage: UsageSummary = {
    inputTokens: totalInput,
    outputTokens: totalOutput,
    cacheReadTokens: totalCacheRead,
    cacheCreationTokens: totalCacheCreation,
    cache5mTokens: totalCache5m,
    cache1hTokens: totalCache1h,
    completeness: sessionsWithTokenData === results.length ? 'exact' : 'estimated',
    sessionsWithData: sessionsWithTokenData,
    sessionsTotal: results.length,
  };

  return {
    sessionsAnalyzed: results.length,
    sessionsExact,
    sessionsPartial,
    sessionsDamaged,
    dateRange: {
      from: earliestDate ?? new Date(),
      to: latestDate ?? new Date(),
    },
    totalTurns,
    totalToolCalls,
    toolDistribution,
    fileActivity,
    delegations,
    skillActivations,
    tokenUsage,
    bashCommandTokens,
  };
}

// ---- Helpers ----

function extractFilePath(
  tc: TranscriptParseResult['toolCalls'][0],
  projectRoot?: string,
): string | null {
  const input = tc.input;
  let filePath: string | null = null;

  if (tc.toolName === 'Read' || tc.toolName === 'Edit' || tc.toolName === 'Write') {
    filePath = (input.file_path as string) ?? null;
  } else if (tc.toolName === 'Bash') {
    // Best-effort: don't extract file paths from bash commands
    // (too unreliable for aggregation)
    return null;
  } else {
    return null;
  }

  if (!filePath) return null;

  // Normalize: strip project root prefix
  if (projectRoot && filePath.startsWith(projectRoot + '/')) {
    return filePath.slice(projectRoot.length + 1);
  }

  return filePath;
}

function incrementFileActivity(
  activity: Map<string, FileActivity>,
  filePath: string,
  toolName: string,
  sessionId: string,
): void {
  let entry = activity.get(filePath);
  if (!entry) {
    entry = { readCount: 0, editCount: 0, writeCount: 0, bashCount: 0, sessions: new Set() };
    activity.set(filePath, entry);
  }

  entry.sessions.add(sessionId);

  switch (toolName) {
    case 'Read': entry.readCount++; break;
    case 'Edit': entry.editCount++; break;
    case 'Write': entry.writeCount++; break;
    case 'Bash': entry.bashCount++; break;
  }
}

function extractAgentName(tc: TranscriptParseResult['toolCalls'][0]): string | null {
  const input = tc.input;
  if (typeof input.name === 'string') return input.name;
  if (typeof input.agent === 'string') return input.agent;
  if (typeof input.subagent_type === 'string') return input.subagent_type;
  // Try to extract from description
  if (typeof input.description === 'string') {
    const desc = input.description as string;
    // Use first 30 chars of description as agent identifier
    return desc.length > 30 ? desc.slice(0, 30) + '...' : desc;
  }
  return null;
}

function extractSkillName(tc: TranscriptParseResult['toolCalls'][0]): string | null {
  const input = tc.input;
  if (typeof input.skill === 'string') return input.skill;
  if (typeof input.name === 'string') return input.name;
  return null;
}

// ---- Token Economics ----

/** Approximate model pricing per 1M tokens (USD). */
interface ModelPricing {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

function getModelPricing(model: string | null): ModelPricing {
  const m = (model ?? '').toLowerCase();
  if (m.includes('opus')) {
    return { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.5 };
  }
  if (m.includes('haiku')) {
    return { input: 0.8, output: 4.0, cacheWrite: 1.0, cacheRead: 0.08 };
  }
  // Default: sonnet pricing
  return { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 };
}

/** Cache TTL threshold in milliseconds (5 minutes). */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Analyze token economics from parsed transcript results.
 * Pure function — no filesystem access.
 */
export function analyzeTokenEconomics(
  parseResults: TranscriptParseResult[],
  estimatedStartupTokens: number,
): TokenEconomicsReport {
  let sessionsWithTokenData = 0;
  let firstMessageTotalSum = 0;
  let firstMessageCount = 0;
  let totalCost = 0;
  const costByModel = new Map<string, number>();
  let totalCacheRead = 0;
  let totalCacheCreation = 0;
  let totalCompactions = 0;
  let sessionsWithCompaction = 0;

  const cacheMiss: CacheMissBreakdown = {
    ttlTimeoutCount: 0,
    configChangeCount: 0,
    unknownCount: 0,
    ttlTimeoutTokens: 0,
    configChangeTokens: 0,
    unknownTokens: 0,
  };

  const snapshots: SessionTokenSnapshot[] = [];

  for (const result of parseResults) {
    const msgs = result.messageTokens;
    if (msgs.length === 0) continue;

    sessionsWithTokenData++;

    // First message startup cost
    const first = msgs[0];
    const firstTotal = first.inputTokens + first.cacheReadTokens + first.cacheCreationTokens;
    firstMessageTotalSum += firstTotal;
    firstMessageCount++;

    // Per-session token totals for snapshot + cost
    let sessInput = 0;
    let sessOutput = 0;
    let sessCacheRead = 0;
    let sessCacheCreation = 0;
    let sessCost = 0;
    const sessModel = result.session.model;

    for (const msg of msgs) {
      sessInput += msg.inputTokens;
      sessOutput += msg.outputTokens;
      sessCacheRead += msg.cacheReadTokens;
      sessCacheCreation += msg.cacheCreationTokens;

      const pricing = getModelPricing(msg.model);
      sessCost +=
        (msg.inputTokens / 1_000_000) * pricing.input +
        (msg.outputTokens / 1_000_000) * pricing.output +
        (msg.cacheCreationTokens / 1_000_000) * pricing.cacheWrite +
        (msg.cacheReadTokens / 1_000_000) * pricing.cacheRead;
    }

    totalCost += sessCost;
    const modelKey = sessModel ?? 'unknown';
    costByModel.set(modelKey, (costByModel.get(modelKey) ?? 0) + sessCost);

    totalCacheRead += sessCacheRead;
    totalCacheCreation += sessCacheCreation;

    // Session snapshot for trends
    snapshots.push({
      sessionId: result.session.sessionId,
      date: result.session.startedAt,
      totalInput: sessInput + sessCacheRead + sessCacheCreation,
      totalOutput: sessOutput,
      cacheReadTokens: sessCacheRead,
      cacheCreationTokens: sessCacheCreation,
      newInputTokens: sessInput,
      model: sessModel,
    });

    // Cache TTL attribution — analyze per-message gaps
    attributeCacheMisses(msgs, cacheMiss);

    // Compaction: check for system events
    const hasCompaction = result.session.events.some(
      (e) => e.kind === 'system' && e.rawType === 'system',
    );
    if (hasCompaction) {
      sessionsWithCompaction++;
      // Count system events as compaction events
      totalCompactions += result.session.events.filter(
        (e) => e.kind === 'system' && e.rawType === 'system',
      ).length;
    }
  }

  // Sort snapshots by date ascending
  snapshots.sort((a, b) => a.date.getTime() - b.date.getTime());

  // Startup cost comparison
  const actualFirst = firstMessageCount > 0
    ? Math.round(firstMessageTotalSum / firstMessageCount)
    : 0;
  const startupDelta = actualFirst - estimatedStartupTokens;
  const startupDeltaPercent = estimatedStartupTokens > 0
    ? Math.round((startupDelta / estimatedStartupTokens) * 100)
    : 0;

  // Cache efficiency
  const cacheTotal = totalCacheRead + totalCacheCreation;
  const overallCacheEfficiency = cacheTotal > 0
    ? Math.round((totalCacheRead / cacheTotal) * 100)
    : 0;

  const sessionsTotal = parseResults.length;
  const avgCostPerSession = sessionsWithTokenData > 0
    ? totalCost / sessionsWithTokenData
    : 0;

  return {
    sessionsWithTokenData,
    sessionsTotal,
    estimatedStartupTokens,
    actualFirstMessageTokens: actualFirst,
    startupDelta,
    startupDeltaPercent,
    totalEstimatedCost: totalCost,
    avgCostPerSession,
    costByModel,
    overallCacheEfficiency,
    cacheMissBreakdown: cacheMiss,
    sessionSnapshots: snapshots,
    totalCompactions,
    sessionsWithCompaction,
  };
}

/**
 * Attribute cache creation events to TTL timeout, config change, or unknown.
 * A cache creation spike after a >5-minute gap is attributed to TTL timeout.
 */
function attributeCacheMisses(
  messages: MessageTokenSnapshot[],
  breakdown: CacheMissBreakdown,
): void {
  for (let i = 1; i < messages.length; i++) {
    const msg = messages[i];
    const prev = messages[i - 1];

    // Only analyze messages with significant cache creation
    if (msg.cacheCreationTokens <= 0) continue;

    const gapMs = msg.timestamp.getTime() - prev.timestamp.getTime();

    if (gapMs > CACHE_TTL_MS) {
      breakdown.ttlTimeoutCount++;
      breakdown.ttlTimeoutTokens += msg.cacheCreationTokens;
    } else if (gapMs >= 0) {
      breakdown.configChangeCount++;
      breakdown.configChangeTokens += msg.cacheCreationTokens;
    } else {
      breakdown.unknownCount++;
      breakdown.unknownTokens += msg.cacheCreationTokens;
    }
  }

  // First message cache creation is always "new content" (session startup)
  if (messages.length > 0 && messages[0].cacheCreationTokens > 0) {
    breakdown.configChangeCount++;
    breakdown.configChangeTokens += messages[0].cacheCreationTokens;
  }
}

function createEmptyStats(): AggregateStats {
  return {
    sessionsAnalyzed: 0,
    sessionsExact: 0,
    sessionsPartial: 0,
    sessionsDamaged: 0,
    dateRange: { from: new Date(), to: new Date() },
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
  };
}
