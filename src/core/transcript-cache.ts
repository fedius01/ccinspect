import { readFile, writeFile, mkdir, unlink, readdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import type { TranscriptParseResult } from '../parsers/transcript-jsonl.js';
import type { ToolCall, ToolResult, TaskAttempt, UsageSummary, MessageTokenSnapshot } from '../types/transcript.js';

// ---- Serialized types (Date → string, Set → array) ----

interface SerializedToolCall {
  toolName: string;
  input: Record<string, unknown>;
  callId: string;
  callerType: string;
  requestId: string;
  isSidechain: boolean;
  agentContext?: string;
  teamName?: string;
}

interface SerializedToolResult {
  callId: string;
  sourceToolAssistantUUID: string;
  status: 'success' | 'error' | 'denied' | 'unknown';
  errorKind?: string;
  toolUseResult: Record<string, unknown>;
}

interface SerializedTaskAttempt {
  prompt: string;
  startedAt: string;
  endedAt?: string;
  toolCalls: SerializedToolCall[];
  toolResults: SerializedToolResult[];
  outcome: TaskAttempt['outcome'];
}

interface SerializedMessageTokenSnapshot {
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  model: string | null;
}

interface SerializedUsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cache5mTokens: number;
  cache1hTokens: number;
  completeness: 'exact' | 'estimated';
  sessionsWithData: number;
  sessionsTotal: number;
}

/**
 * Bump this when the CacheEntry format changes.
 * Old cache entries with a different (or missing) version are rejected and re-parsed.
 */
export const CACHE_VERSION = 3;

/**
 * Cache entry stored as JSON on disk.
 * All Date fields are ISO strings; Set fields are arrays.
 */
export interface CacheEntry {
  // Cache format version — must match CACHE_VERSION to be valid
  cacheVersion: number;

  // Cache validation key
  filePath: string;
  fileSize: number;
  fileMtime: number;
  cachedAt: string;

  // Session metadata
  sessionId: string;
  claudeCodeVersion: string | null;
  model: string | null;
  projectRoot: string | null;
  gitBranch: string | null;
  startedAt: string;
  endedAt: string | null;
  completeness: 'exact' | 'partial' | 'damaged';
  parseWarningsCount: number;
  skippedLineTypes: string[];

  // Aggregated data
  toolCalls: SerializedToolCall[];
  toolResults: SerializedToolResult[];
  tasks: SerializedTaskAttempt[];
  tokenUsage: SerializedUsageSummary;
  messageTokens?: SerializedMessageTokenSnapshot[];
}

// ---- Serialization helpers ----

function serializeToolCall(tc: ToolCall): SerializedToolCall {
  return {
    toolName: tc.toolName,
    input: tc.input,
    callId: tc.callId,
    callerType: tc.callerType,
    requestId: tc.requestId,
    isSidechain: tc.isSidechain,
    ...(tc.agentContext !== undefined ? { agentContext: tc.agentContext } : {}),
    ...(tc.teamName !== undefined ? { teamName: tc.teamName } : {}),
  };
}

function serializeToolResult(tr: ToolResult): SerializedToolResult {
  return {
    callId: tr.callId,
    sourceToolAssistantUUID: tr.sourceToolAssistantUUID,
    status: tr.status,
    ...(tr.errorKind !== undefined ? { errorKind: tr.errorKind } : {}),
    toolUseResult: tr.toolUseResult,
  };
}

function serializeTask(task: TaskAttempt): SerializedTaskAttempt {
  return {
    prompt: task.prompt,
    startedAt: task.startedAt.toISOString(),
    ...(task.endedAt ? { endedAt: task.endedAt.toISOString() } : {}),
    toolCalls: task.toolCalls.map(serializeToolCall),
    toolResults: task.toolResults.map(serializeToolResult),
    outcome: task.outcome,
  };
}

function serializeMessageToken(mt: MessageTokenSnapshot): SerializedMessageTokenSnapshot {
  return {
    timestamp: mt.timestamp.toISOString(),
    inputTokens: mt.inputTokens,
    outputTokens: mt.outputTokens,
    cacheCreationTokens: mt.cacheCreationTokens,
    cacheReadTokens: mt.cacheReadTokens,
    model: mt.model,
  };
}

function serializeUsage(usage: UsageSummary): SerializedUsageSummary {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    cache5mTokens: usage.cache5mTokens,
    cache1hTokens: usage.cache1hTokens,
    completeness: usage.completeness,
    sessionsWithData: usage.sessionsWithData,
    sessionsTotal: usage.sessionsTotal,
  };
}

// ---- Public API ----

/**
 * Get the cache directory path.
 * Default: ~/.ccinspect/cache/transcripts/
 */
export function getCacheDir(overrideDir?: string): string {
  if (overrideDir) return overrideDir;
  return join(homedir(), '.ccinspect', 'cache', 'transcripts');
}

/**
 * Get the cache file path for a session.
 */
export function getCachePath(sessionId: string, cacheDir?: string): string {
  return join(getCacheDir(cacheDir), `${sessionId}.json`);
}

/**
 * Try to read a cached parse result for a session file.
 * Returns null if no cache file exists, cache is corrupted, or cache is stale.
 */
export async function readCache(
  sessionId: string,
  currentFilePath: string,
  currentFileSize: number,
  currentFileMtime: number,
  cacheDir?: string,
): Promise<CacheEntry | null> {
  const cachePath = getCachePath(sessionId, cacheDir);
  try {
    const raw = await readFile(cachePath, 'utf-8');
    const entry = JSON.parse(raw) as CacheEntry;

    // Validate cache version — reject stale format
    if (entry.cacheVersion !== CACHE_VERSION) {
      return null;
    }

    // Validate cache key
    if (
      entry.filePath !== currentFilePath ||
      entry.fileSize !== currentFileSize ||
      entry.fileMtime !== currentFileMtime
    ) {
      return null;
    }

    return entry;
  } catch {
    return null;
  }
}

/**
 * Write a parsed result to cache.
 * Creates the cache directory if it doesn't exist.
 * Serializes Date objects to ISO strings.
 * Write failure is non-fatal (best-effort caching).
 */
export async function writeCache(
  sessionId: string,
  filePath: string,
  fileSize: number,
  fileMtime: number,
  parseResult: TranscriptParseResult,
  cacheDir?: string,
): Promise<void> {
  const dir = getCacheDir(cacheDir);
  const cachePath = getCachePath(sessionId, cacheDir);

  const entry: CacheEntry = {
    cacheVersion: CACHE_VERSION,
    filePath,
    fileSize,
    fileMtime,
    cachedAt: new Date().toISOString(),

    sessionId: parseResult.session.sessionId,
    claudeCodeVersion: parseResult.session.claudeCodeVersion,
    model: parseResult.session.model,
    projectRoot: parseResult.session.projectRoot,
    gitBranch: parseResult.session.gitBranch,
    startedAt: parseResult.session.startedAt.toISOString(),
    endedAt: parseResult.session.endedAt?.toISOString() ?? null,
    completeness: parseResult.session.completeness,
    parseWarningsCount: parseResult.session.parseWarnings.length,
    skippedLineTypes: parseResult.session.skippedLineTypes,

    toolCalls: parseResult.toolCalls.map(serializeToolCall),
    toolResults: parseResult.toolResults.map(serializeToolResult),
    tasks: parseResult.tasks.map(serializeTask),
    tokenUsage: serializeUsage(parseResult.tokenUsage),
    messageTokens: (parseResult.messageTokens ?? []).map(serializeMessageToken),
  };

  try {
    await mkdir(dir, { recursive: true });
    await writeFile(cachePath, JSON.stringify(entry, null, 2), 'utf-8');
  } catch {
    // Cache write failure is non-fatal — silently ignore
  }
}

/**
 * Delete a specific cache entry.
 */
export async function deleteCache(sessionId: string, cacheDir?: string): Promise<void> {
  const cachePath = getCachePath(sessionId, cacheDir);
  try {
    await unlink(cachePath);
  } catch {
    // No error if file doesn't exist
  }
}

/**
 * Delete all cache entries.
 */
export async function clearCache(cacheDir?: string): Promise<void> {
  const dir = getCacheDir(cacheDir);
  try {
    const entries = await readdir(dir);
    for (const entry of entries) {
      if (entry.endsWith('.json')) {
        try {
          await unlink(join(dir, entry));
        } catch {
          // Skip files we can't delete
        }
      }
    }
  } catch {
    // No error if directory doesn't exist
  }
}
