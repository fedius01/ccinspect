import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import type {
  TranscriptSession,
  TranscriptEvent,
  TranscriptEventKind,
  ToolCall,
  ToolResult,
  TaskAttempt,
  UsageSummary,
  ParseWarning,
  MessageTokenSnapshot,
} from '../types/transcript.js';

/**
 * Full parse result including the session metadata, extracted tool calls/results,
 * task segmentation, and token usage. The `session` field is the normalized
 * TranscriptSession; other fields are derived analysis data.
 */
export interface TranscriptParseResult {
  session: TranscriptSession;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  tasks: TaskAttempt[];
  tokenUsage: UsageSummary;
  /** Per-assistant-message token snapshots, ordered by timestamp. */
  messageTokens: MessageTokenSnapshot[];
}

// ---- Content block types ----

interface TextBlock {
  type: 'text';
  text: string;
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
  caller?: { type: string };
}

interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: unknown;
}

interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock | { type: string };

// ---- Raw JSONL line shape ----

interface RawLine {
  type: string;
  uuid?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  sessionId?: string;
  version?: string;
  cwd?: string;
  gitBranch?: string;
  timestamp?: string;
  requestId?: string;
  sourceToolAssistantUUID?: string;
  toolUseResult?: Record<string, unknown>;
  message?: {
    role?: string;
    model?: string;
    content?: ContentBlock[] | string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation?: {
        ephemeral_5m_input_tokens?: number;
        ephemeral_1h_input_tokens?: number;
      };
    };
    stop_reason?: string;
  };
}

// ---- Infrastructure line types to skip ----

const INFRASTRUCTURE_TYPES = new Set([
  'queue-operation',
  'file-history-snapshot',
]);

// ---- Permission/error indicators ----

const PERMISSION_DENIED_PATTERNS = [
  'permission denied',
  'is not allowed',
  'not permitted',
  'denied by',
  'permission settings',
];

const ERROR_PATTERNS = [
  'error:',
  'Error:',
  'FAIL',
  'failed',
  'ENOENT',
  'EACCES',
  'EPERM',
  'command failed',
  'exit code',
];

// ---- Helpers ----

/**
 * Normalize message.content to an array of content blocks.
 * Handles both array and string forms.
 */
function normalizeContent(content: ContentBlock[] | string | undefined): ContentBlock[] {
  if (content === undefined || content === null) return [];
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  if (Array.isArray(content)) return content;
  return [];
}

/**
 * Classify a conversation line's event kind from its content blocks and raw type.
 */
function classifyEvent(rawType: string, blocks: ContentBlock[]): TranscriptEventKind {
  const hasToolUse = blocks.some((b) => b.type === 'tool_use');
  const hasToolResult = blocks.some((b) => b.type === 'tool_result');
  const hasThinking = blocks.some((b) => b.type === 'thinking');

  if (rawType === 'user') {
    if (hasToolResult) return 'tool_result';
    return 'user_prompt';
  }

  if (rawType === 'assistant') {
    // Priority: tool_use > thinking > text
    if (hasToolUse) return 'tool_call';
    if (hasThinking) return 'thinking';
    return 'assistant_text';
  }

  return 'system';
}

/**
 * Determine tool result status from its content.
 */
function determineToolResultStatus(content: unknown): 'success' | 'error' | 'denied' | 'unknown' {
  const text = typeof content === 'string' ? content : '';
  const lower = text.toLowerCase();

  for (const pattern of PERMISSION_DENIED_PATTERNS) {
    if (lower.includes(pattern)) return 'denied';
  }

  for (const pattern of ERROR_PATTERNS) {
    if (text.includes(pattern)) return 'error';
  }

  return 'success';
}

/**
 * Extract tool calls from an assistant message's content blocks.
 */
function extractToolCalls(
  blocks: ContentBlock[],
  requestId: string,
  isSidechain: boolean,
): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const block of blocks) {
    if (block.type === 'tool_use') {
      const b = block as ToolUseBlock;
      const call: ToolCall = {
        toolName: b.name,
        input: b.input ?? {},
        callId: b.id,
        callerType: b.caller?.type ?? 'unknown',
        requestId,
        isSidechain,
      };
      // Extract team_name from Agent Teams teammate spawns
      if (b.name === 'Task' && b.input && typeof (b.input as Record<string, unknown>).team_name === 'string') {
        call.teamName = (b.input as Record<string, unknown>).team_name as string;
      }
      calls.push(call);
    }
  }
  return calls;
}

function deriveErrorKind(status: ToolResult['status']): string | undefined {
  if (status === 'denied') return 'permission_denied';
  if (status === 'error') return 'tool_error';
  return undefined;
}

/**
 * Extract tool results from a user message's content blocks.
 */
function extractToolResults(
  blocks: ContentBlock[],
  line: RawLine,
): ToolResult[] {
  const results: ToolResult[] = [];
  for (const block of blocks) {
    if (block.type === 'tool_result') {
      const b = block as ToolResultBlock;
      const status = determineToolResultStatus(b.content);
      results.push({
        callId: b.tool_use_id,
        sourceToolAssistantUUID: line.sourceToolAssistantUUID ?? '',
        status,
        errorKind: deriveErrorKind(status),
        toolUseResult: line.toolUseResult ?? {},
      });
    }
  }
  return results;
}

/**
 * Extract text content from content blocks for prompt truncation.
 */
function extractTextContent(blocks: ContentBlock[], maxLength: number): string {
  const texts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      texts.push((block as TextBlock).text);
    }
  }
  const full = texts.join('\n');
  return full.length > maxLength ? full.slice(0, maxLength) : full;
}

// ---- Main parser ----

interface ParseState {
  events: TranscriptEvent[];
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  warnings: ParseWarning[];
  skippedLineTypes: Set<string>;

  // Session metadata — extracted from first lines
  sessionId: string | null;
  claudeCodeVersion: string | null;
  model: string | null;
  projectRoot: string | null;
  gitBranch: string | null;
  firstTimestamp: Date | null;
  lastTimestamp: Date | null;

  // Token usage tracking
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalCache5mTokens: number;
  totalCache1hTokens: number;
  assistantMessagesWithUsage: number;
  totalAssistantMessages: number;

  // Per-message token snapshots
  messageTokens: MessageTokenSnapshot[];

  // Line counts
  conversationLines: number;
  failedLines: number;
}

function createParseState(): ParseState {
  return {
    events: [],
    toolCalls: [],
    toolResults: [],
    warnings: [],
    skippedLineTypes: new Set(),
    sessionId: null,
    claudeCodeVersion: null,
    model: null,
    projectRoot: null,
    gitBranch: null,
    firstTimestamp: null,
    lastTimestamp: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    totalCache5mTokens: 0,
    totalCache1hTokens: 0,
    assistantMessagesWithUsage: 0,
    totalAssistantMessages: 0,
    messageTokens: [],
    conversationLines: 0,
    failedLines: 0,
  };
}

function processLine(state: ParseState, rawLine: string, lineNumber: number): void {
  // Skip empty lines silently
  if (rawLine.trim() === '') return;

  // Try to parse JSON
  let parsed: RawLine;
  try {
    parsed = JSON.parse(rawLine) as RawLine;
  } catch {
    state.failedLines++;
    state.warnings.push({
      line: lineNumber,
      reason: 'Malformed JSON',
      raw: rawLine.slice(0, 200),
    });
    return;
  }

  // Check for type field
  if (!parsed.type || typeof parsed.type !== 'string') {
    state.failedLines++;
    state.warnings.push({
      line: lineNumber,
      reason: 'Missing or invalid "type" field',
      raw: rawLine.slice(0, 200),
    });
    return;
  }

  // Skip infrastructure lines
  if (INFRASTRUCTURE_TYPES.has(parsed.type)) {
    state.skippedLineTypes.add(parsed.type);
    return;
  }

  // Only process user/assistant conversation lines
  if (parsed.type !== 'user' && parsed.type !== 'assistant') {
    // Unknown type — skip with warning
    if (parsed.type !== 'system') {
      state.failedLines++;
      state.warnings.push({
        line: lineNumber,
        reason: `Unknown line type: "${parsed.type}"`,
        raw: rawLine.slice(0, 200),
      });
    } else {
      state.skippedLineTypes.add(parsed.type);
    }
    return;
  }

  state.conversationLines++;

  // Extract session metadata from first conversation line
  if (state.sessionId === null && parsed.sessionId) {
    state.sessionId = parsed.sessionId;
  }
  if (state.claudeCodeVersion === null && parsed.version) {
    state.claudeCodeVersion = parsed.version;
  }
  if (state.projectRoot === null && parsed.cwd) {
    state.projectRoot = parsed.cwd;
  }
  if (state.gitBranch === null && parsed.gitBranch) {
    state.gitBranch = parsed.gitBranch;
  }

  // Extract model from first assistant message
  if (state.model === null && parsed.type === 'assistant' && parsed.message?.model) {
    state.model = parsed.message.model;
  }

  // Parse timestamp
  const timestamp = parsed.timestamp ? new Date(parsed.timestamp) : new Date();
  if (state.firstTimestamp === null) {
    state.firstTimestamp = timestamp;
  }
  state.lastTimestamp = timestamp;

  // Normalize content
  const blocks = normalizeContent(parsed.message?.content);

  // Classify event
  const kind = classifyEvent(parsed.type, blocks);

  // Build event
  const event: TranscriptEvent = {
    kind,
    timestamp,
    uuid: parsed.uuid ?? `generated-${lineNumber}`,
    parentUuid: parsed.parentUuid ?? null,
    requestId: parsed.requestId,
    isSidechain: parsed.isSidechain ?? false,
    rawType: parsed.type,
  };
  state.events.push(event);

  // Extract tool calls from assistant messages
  if (kind === 'tool_call') {
    const calls = extractToolCalls(blocks, parsed.requestId ?? '', parsed.isSidechain ?? false);
    state.toolCalls.push(...calls);
  }

  // Extract tool results from user messages
  if (kind === 'tool_result') {
    const results = extractToolResults(blocks, parsed);
    state.toolResults.push(...results);
  }

  // Aggregate token usage from assistant messages
  if (parsed.type === 'assistant') {
    state.totalAssistantMessages++;
    const usage = parsed.message?.usage;
    if (usage) {
      state.assistantMessagesWithUsage++;
      const inputTok = usage.input_tokens ?? 0;
      const outputTok = usage.output_tokens ?? 0;
      const cacheCreation = usage.cache_creation_input_tokens ?? 0;
      const cacheRead = usage.cache_read_input_tokens ?? 0;

      state.totalInputTokens += inputTok;
      state.totalOutputTokens += outputTok;
      state.totalCacheCreationTokens += cacheCreation;
      state.totalCacheReadTokens += cacheRead;
      state.totalCache5mTokens += usage.cache_creation?.ephemeral_5m_input_tokens ?? 0;
      state.totalCache1hTokens += usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;

      state.messageTokens.push({
        timestamp,
        inputTokens: inputTok,
        outputTokens: outputTok,
        cacheCreationTokens: cacheCreation,
        cacheReadTokens: cacheRead,
        model: parsed.message?.model ?? state.model,
      });
    }
  }
}

/**
 * Segment events into task attempts.
 * Each user_prompt starts a new TaskAttempt.
 */
function segmentTasks(
  events: TranscriptEvent[],
  toolCalls: ToolCall[],
  toolResults: ToolResult[],
  blocks: Map<string, ContentBlock[]>,
): TaskAttempt[] {
  const tasks: TaskAttempt[] = [];

  // Find indices of user_prompt events
  const promptIndices: number[] = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].kind === 'user_prompt') {
      promptIndices.push(i);
    }
  }

  if (promptIndices.length === 0) return tasks;

  for (let p = 0; p < promptIndices.length; p++) {
    const startIdx = promptIndices[p];
    const endIdx = p + 1 < promptIndices.length ? promptIndices[p + 1] : events.length;
    const promptEvent = events[startIdx];

    // Extract prompt text from stored content blocks
    const promptBlocks = blocks.get(promptEvent.uuid);
    const prompt = promptBlocks ? extractTextContent(promptBlocks, 500) : '';

    // Collect tool calls that were made in response to this task
    const taskToolCalls: ToolCall[] = [];
    const taskToolResults: ToolResult[] = [];

    // Collect events between this prompt and the next
    const taskEvents = events.slice(startIdx, endIdx);
    const taskRequestIds = new Set<string>();
    for (const ev of taskEvents) {
      if (ev.requestId) taskRequestIds.add(ev.requestId);
    }

    for (const tc of toolCalls) {
      if (taskRequestIds.has(tc.requestId)) {
        taskToolCalls.push(tc);
      }
    }

    // Match tool results to task events by sourceToolAssistantUUID
    const taskAssistantUuids = new Set<string>();
    for (const ev of taskEvents) {
      if (ev.rawType === 'assistant') {
        taskAssistantUuids.add(ev.uuid);
      }
    }
    for (const tr of toolResults) {
      if (taskAssistantUuids.has(tr.sourceToolAssistantUUID)) {
        taskToolResults.push(tr);
      }
    }

    // Determine outcome
    const lastEvent = events[endIdx - 1];
    const isLastTask = p === promptIndices.length - 1;
    let outcome: TaskAttempt['outcome'] = 'unknown';

    if (taskToolResults.length === 0 && taskToolCalls.length === 0) {
      // No tool activity — could be a simple text exchange or interrupted
      if (isLastTask && taskEvents.length <= 1) {
        outcome = 'interrupted';
      } else {
        outcome = 'success';
      }
    } else if (taskToolResults.length > 0) {
      const lastResult = taskToolResults[taskToolResults.length - 1];
      const hasAnyErrors = taskToolResults.some((r) => r.status === 'error' || r.status === 'denied');

      if (lastResult.status === 'error' || lastResult.status === 'denied') {
        outcome = 'failed';
      } else if (hasAnyErrors) {
        outcome = 'partial';
      } else {
        outcome = 'success';
      }
    } else if (isLastTask && lastEvent.kind === 'tool_call') {
      // Ended with a tool call but no result — interrupted
      outcome = 'interrupted';
    }

    // If this is the last task and there's no final assistant_text after tool activity, likely interrupted
    if (isLastTask && taskToolCalls.length > 0) {
      const hasUnmatchedCalls = taskToolResults.length < taskToolCalls.length;
      const lastTaskEvent = taskEvents[taskEvents.length - 1];
      const endsWithoutAssistantText = lastTaskEvent?.kind !== 'assistant_text';
      if (hasUnmatchedCalls || endsWithoutAssistantText) {
        outcome = 'interrupted';
      }
    }

    const lastTaskEvent = taskEvents[taskEvents.length - 1];
    const endedAt = lastTaskEvent && lastTaskEvent !== promptEvent ? lastTaskEvent.timestamp : undefined;

    tasks.push({
      prompt,
      startedAt: promptEvent.timestamp,
      endedAt,
      toolCalls: taskToolCalls,
      toolResults: taskToolResults,
      outcome,
    });
  }

  return tasks;
}

/**
 * Build the full parse result from parsed state.
 */
function buildParseResult(state: ParseState, sourceFile: string, contentBlocksMap: Map<string, ContentBlock[]>): TranscriptParseResult {
  // Determine completeness
  let completeness: TranscriptSession['completeness'];
  if (state.conversationLines === 0) {
    completeness = 'damaged';
  } else if (state.failedLines === 0) {
    completeness = 'exact';
  } else {
    const failureRate = state.failedLines / (state.conversationLines + state.failedLines);
    completeness = failureRate > 0.25 ? 'damaged' : 'partial';
  }

  // Build token usage summary
  const tokenUsage: UsageSummary = {
    inputTokens: state.totalInputTokens,
    outputTokens: state.totalOutputTokens,
    cacheReadTokens: state.totalCacheReadTokens,
    cacheCreationTokens: state.totalCacheCreationTokens,
    cache5mTokens: state.totalCache5mTokens,
    cache1hTokens: state.totalCache1hTokens,
    completeness:
      state.totalAssistantMessages > 0 &&
      state.assistantMessagesWithUsage === state.totalAssistantMessages
        ? 'exact'
        : 'estimated',
    sessionsWithData: state.assistantMessagesWithUsage > 0 ? 1 : 0,
    sessionsTotal: 1,
  };

  // Segment tasks
  const tasks = segmentTasks(state.events, state.toolCalls, state.toolResults, contentBlocksMap);

  const session: TranscriptSession = {
    sessionId: state.sessionId ?? 'unknown',
    claudeCodeVersion: state.claudeCodeVersion,
    model: state.model,
    projectRoot: state.projectRoot,
    gitBranch: state.gitBranch,
    startedAt: state.firstTimestamp ?? new Date(0),
    endedAt: state.lastTimestamp,
    sourceFile,
    events: state.events,
    parseWarnings: state.warnings,
    completeness,
    skippedLineTypes: [...state.skippedLineTypes],
  };

  return {
    session,
    toolCalls: state.toolCalls,
    toolResults: state.toolResults,
    tasks,
    tokenUsage,
    messageTokens: state.messageTokens,
  };
}

// ---- Extended state for task segmentation ----
// We need to store content blocks per event UUID to extract prompt text later

interface ExtendedParseState extends ParseState {
  contentBlocksMap: Map<string, ContentBlock[]>;
}

function createExtendedState(): ExtendedParseState {
  return {
    ...createParseState(),
    contentBlocksMap: new Map(),
  };
}

function processLineExtended(state: ExtendedParseState, rawLine: string, lineNumber: number): void {
  // Pre-parse to capture content blocks before delegating
  const trimmed = rawLine.trim();
  if (trimmed === '') {
    processLine(state, rawLine, lineNumber);
    return;
  }

  let parsed: RawLine | null = null;
  try {
    parsed = JSON.parse(trimmed) as RawLine;
  } catch {
    // Will be handled by processLine
  }

  processLine(state, rawLine, lineNumber);

  // Store content blocks for user_prompt events (for task segmentation)
  if (parsed && parsed.uuid && parsed.message?.content) {
    const blocks = normalizeContent(parsed.message.content);
    state.contentBlocksMap.set(parsed.uuid, blocks);
  }
}

// ---- Public API ----

/**
 * Parse a JSONL transcript file into a TranscriptParseResult.
 * Reads the file line-by-line (streaming for memory efficiency on large files).
 * Skips infrastructure lines, normalizes events, extracts tool calls/results,
 * segments into task attempts, and aggregates token usage.
 */
export async function parseTranscriptFile(filePath: string): Promise<TranscriptParseResult> {
  const state = createExtendedState();

  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber++;
    processLineExtended(state, line, lineNumber);
  }

  return buildParseResult(state, filePath, state.contentBlocksMap);
}

/**
 * Parse JSONL content from a string (useful for testing without filesystem).
 * Each line should be a JSON object.
 */
export function parseTranscriptContent(content: string, sourceFile: string): TranscriptParseResult {
  const state = createExtendedState();
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    processLineExtended(state, lines[i], i + 1);
  }

  return buildParseResult(state, sourceFile, state.contentBlocksMap);
}
