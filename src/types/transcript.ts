// ---- Parse-level types ----

/** Warning generated when a JSONL line can't be parsed. */
export interface ParseWarning {
  /** 1-indexed line number in the JSONL file. */
  line: number;
  /** Human-readable reason for the warning. */
  reason: string;
  /** First 200 chars of the raw line, for debugging. */
  raw?: string;
}

/** Parsed session — top-level container for one .jsonl file. */
export interface TranscriptSession {
  /** UUID extracted from the filename. */
  sessionId: string;
  /** Claude Code CLI version, if present on the init line. */
  claudeCodeVersion: string | null;
  /** Primary model used in this session. */
  model: string | null;
  /** Project root inferred from `cwd` field on first conversation line. */
  projectRoot: string | null;
  /** Git branch active at session start. */
  gitBranch: string | null;
  /** Timestamp of the first message. */
  startedAt: Date;
  /** Timestamp of the last message, or null if session appears truncated. */
  endedAt: Date | null;
  /** Absolute path to the source .jsonl file. */
  sourceFile: string;
  /** Normalized events extracted from the JSONL lines. */
  events: TranscriptEvent[];
  /** Warnings generated during parsing (malformed lines, unknown types, etc.). */
  parseWarnings: ParseWarning[];
  /**
   * Parse completeness:
   * - 'exact' — all lines parsed successfully
   * - 'partial' — some lines skipped (unknown type, optional fields missing)
   * - 'damaged' — truncated file, encoding errors, or >10% parse failures
   */
  completeness: 'exact' | 'partial' | 'damaged';
  /** Raw `type` values that were encountered but skipped (infrastructure lines). */
  skippedLineTypes: string[];
}

// ---- Event types ----

/** Normalized event kind — disambiguated from raw `type` field. */
export type TranscriptEventKind =
  | 'user_prompt'
  | 'tool_call'
  | 'tool_result'
  | 'assistant_text'
  | 'thinking'
  | 'system';

/** One normalized event from a JSONL conversation line. */
export interface TranscriptEvent {
  /** Disambiguated event kind. */
  kind: TranscriptEventKind;
  /** When this event occurred. */
  timestamp: Date;
  /** Unique identifier for this message within the session. */
  uuid: string;
  /** Parent message UUID, for sidechain (subagent) events. */
  parentUuid: string | null;
  /** API request ID, if present. */
  requestId?: string;
  /** Whether this event occurred inside a subagent sidechain. */
  isSidechain: boolean;
  /** Original `type` field from the JSONL line (e.g., "user", "assistant"). */
  rawType: string;
}

// ---- Tool types ----

/** A tool invocation extracted from an assistant message's content array. */
export interface ToolCall {
  /** Tool name: "Read", "Edit", "Bash", "Task", "Glob", "mcp__server__tool", etc. */
  toolName: string;
  /** Tool-specific input parameters. */
  input: Record<string, unknown>;
  /** Unique call ID from content[].id (e.g., "toolu_..."). */
  callId: string;
  /** Caller type from content[].caller.type. */
  callerType: string;
  /** API request ID for correlation. */
  requestId: string;
  /** Whether this tool call occurred inside a subagent sidechain. */
  isSidechain: boolean;
  /** Agent name, if this call was made within a delegated agent context. */
  agentContext?: string;
  /** Team name if this is an Agent Teams ephemeral teammate spawn. */
  teamName?: string;
}

/** A tool result extracted from a user message with tool_result content. */
export interface ToolResult {
  /** Matches ToolCall.callId via content[].tool_use_id. */
  callId: string;
  /** UUID of the assistant message that initiated this tool call. */
  sourceToolAssistantUUID: string;
  /** Outcome of the tool execution. */
  status: 'success' | 'error' | 'denied' | 'unknown';
  /** Classified error type when status is 'error' or 'denied'. */
  errorKind?: string;
  /** Tool-specific result payload (may be truncated for large results). */
  toolUseResult: Record<string, unknown>;
}

// ---- Task segmentation ----

/** One user-initiated task within a session — starts with each user prompt. */
export interface TaskAttempt {
  /** User message content, truncated to 500 chars by default. */
  prompt: string;
  /** When the user sent the prompt. */
  startedAt: Date;
  /** When the last tool result for this task completed. */
  endedAt?: Date;
  /** Tool calls made in response to this prompt. */
  toolCalls: ToolCall[];
  /** Tool results received for this task's tool calls. */
  toolResults: ToolResult[];
  /**
   * Task outcome:
   * - 'success' — completed with no errors in final tool calls
   * - 'partial' — some tool calls succeeded, some failed
   * - 'failed' — final tool calls errored
   * - 'interrupted' — session ended mid-task (no endedAt)
   * - 'unknown' — insufficient signal to determine
   */
  outcome: 'success' | 'partial' | 'failed' | 'interrupted' | 'unknown';
}

// ---- Token usage ----

/** Token usage aggregated from assistant message `usage` objects. */
export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** 5-minute prompt cache tokens. */
  cache5mTokens: number;
  /** 1-hour prompt cache tokens. */
  cache1hTokens: number;
  /**
   * Whether all sessions had token metadata:
   * - 'exact' — token fields present on all messages
   * - 'estimated' — some messages lacked token metadata
   */
  completeness: 'exact' | 'estimated';
  /** How many sessions contributed token data. */
  sessionsWithData: number;
  /** Total sessions analyzed (including those without token data). */
  sessionsTotal: number;
}

// ---- Aggregation ----

/** Per-file activity counts across sessions. */
export interface FileActivity {
  readCount: number;
  editCount: number;
  writeCount: number;
  /** Bash commands referencing this file. */
  bashCount: number;
  /** Session IDs where this file was touched. */
  sessions: Set<string>;
}

/** Aggregated agent delegation record across sessions. */
export interface DelegationRecord {
  agentName: string;
  count: number;
  sessionIds: string[];
  /** Whether this delegation was an Agent Teams ephemeral teammate. */
  isEphemeralTeammate: boolean;
}

/** Aggregated skill activation record across sessions. */
export interface SkillActivationRecord {
  skillName: string;
  /** User explicitly typed /skill-name. */
  explicitCount: number;
  /** System auto-invoked the skill. */
  autoCount: number;
  sessionIds: string[];
}

/** Cross-session aggregate statistics. */
export interface AggregateStats {
  sessionsAnalyzed: number;
  sessionsExact: number;
  sessionsPartial: number;
  sessionsDamaged: number;
  dateRange: { from: Date; to: Date };
  totalTurns: number;
  totalToolCalls: number;
  /** Tool name → total call count. */
  toolDistribution: Map<string, number>;
  /** File path → activity counts. */
  fileActivity: Map<string, FileActivity>;
  delegations: DelegationRecord[];
  skillActivations: SkillActivationRecord[];
  tokenUsage: UsageSummary;
  /** Unique lowercase tokens from all Bash tool call command strings. */
  bashCommandTokens: Set<string>;
}

// ---- Confidence levels ----

/** Confidence level for runtime-derived findings. */
export type FindingConfidence = 'exact' | 'strong' | 'heuristic';

// ---- Runtime findings (for cci audit) ----

/** A single piece of evidence supporting a runtime finding. */
export interface RuntimeEvidence {
  sessionId: string;
  timestamp: Date;
  /** Human-readable description of what was observed. */
  description: string;
}

/** A runtime-derived finding with confidence tagging. */
export interface RuntimeFinding {
  /** Finding ID, e.g., "utilization/agent-unused". */
  id: string;
  severity: 'info' | 'warning';
  /** Confidence level of this finding. */
  confidence: FindingConfidence;
  message: string;
  /** Number of data points supporting this finding. */
  evidenceCount: number;
  /** Up to 3 representative examples. */
  sampleEvidence: RuntimeEvidence[];
  falsePositiveRisk: 'low' | 'medium' | 'high';
  /** Sessions that contributed to this finding. */
  sessionIds: string[];
}

// ---- Utilization ----

/** Utilization status for a single config component (agent, skill, MCP server, or command). */
export interface ConfigUtilization {
  /** Component name (agent filename, skill directory name, MCP server name, command filename). */
  name: string;
  /** File where this component is defined. */
  configFile: string;
  /** Scope: 'project' or 'user'. */
  scope: string;
  /** Whether the component was used in any analyzed session. */
  used: boolean;
  /** Total invocations across all analyzed sessions. */
  usageCount: number;
  /** Number of unique sessions where it was used. */
  sessionCount: number;
  /** Total sessions in the analysis window (for "0 out of 12" display). */
  sessionsAnalyzed: number;
  /** Confidence level of the finding. */
  confidence: 'exact' | 'strong' | 'heuristic';
  /** Additional human-readable context. */
  details?: string;
}

/** A testable instruction extracted from a rule's markdown body. */
export interface ExtractedInstruction {
  /** The matched text from the rule body (trimmed to relevant phrase). */
  matchedText: string;
  /** The pattern type for future compliance checking. */
  patternType: 'command-preference' | 'test-workflow' | 'tool-restriction' | 'branch-convention';
  /** The positive term — what the rule says to use. */
  preferred?: string;
  /** The negative term — what the rule says to avoid. */
  avoided?: string;
}

/** Result of checking one instruction against transcript data. */
export interface ComplianceResult {
  /** The extracted instruction that was checked. */
  instruction: ExtractedInstruction;
  /** Whether transcript data is consistent with the instruction. */
  consistent: boolean;
  /** Human-readable evidence summary. */
  evidence: string;
  /** Total data points examined (for "14/14 calls used pnpm"). */
  totalDataPoints: number;
  /** Data points consistent with the instruction. */
  consistentDataPoints: number;
  /** Always 'heuristic' for behavioral compliance. */
  confidence: 'heuristic';
}

/** Compliance results for a single rule. */
export interface RuleComplianceReport {
  ruleName: string;
  results: ComplianceResult[];
  /** Whether any testable + checkable patterns were found. */
  hasResults: boolean;
}

/** Utilization data for a single rule file. */
export interface RuleUtilization {
  /** Filename (e.g., "react.md", "testing.md"). */
  name: string;
  /** Full path to the rule file. */
  configFile: string;
  /** Whether project or user scope. */
  scope: 'project' | 'user';
  /** Whether the rule is path-scoped or unconditional. */
  ruleType: 'path-scoped' | 'unconditional';

  // Path-scoped only
  /** The paths:/globs: patterns from frontmatter. */
  globs?: string[];
  /** Count of Read tool calls on files matching globs. */
  matchingFilesRead: number;
  /** Count of Edit/Write calls on matching files. */
  matchingFilesEdited: number;
  /** Write-blindness: Edit/Write without any prior Read across all sessions. */
  matchingFilesEditedWithoutRead: number;
  /** Sessions where matching files were Read. */
  sessionsWithMatch: number;
  /** Sessions with Edit-without-Read on matching files. */
  writeBlindnessSessions: number;
  /** Files that matched the rule's glob and were edited without prior Read. Top 10 by session count. */
  writeBlindnessFiles?: Array<{
    filePath: string;       // Project-relative path
    editSessions: number;   // How many sessions this file was edited without Read
  }>;

  // Unconditional only
  /** Token cost from FileInfo.estimatedTokens. */
  estimatedTokens?: number;
  /** Extracted testable instructions from rule body (for unconditional rules). */
  extractedInstructions?: ExtractedInstruction[];
  /** Compliance check results (only for unconditional rules with extracted instructions). */
  complianceResults?: ComplianceResult[];

  // Common
  sessionsAnalyzed: number;
  /** 'exact' for "no files touched", 'strong' for "files Read". */
  confidence: 'exact' | 'strong';
}

/** Complete utilization report across all config surfaces. */
export interface UtilizationReport {
  // Data quality
  sessionsAnalyzed: number;
  sessionsExact: number;
  sessionsPartial: number;
  sessionsDamaged: number;
  dateRange: { from: Date; to: Date };
  /** The --days filter that was applied. */
  days: number;

  // Per-surface utilization
  agents: ConfigUtilization[];
  skills: ConfigUtilization[];
  mcpServers: ConfigUtilization[];
  commands: ConfigUtilization[];
  rules: {
    pathScoped: RuleUtilization[];
    unconditional: RuleUtilization[];
    totalUnconditionalTokens: number;
  };
}

// ---- Per-message token snapshots (for token economics) ----

/** Token usage from a single assistant message. */
export interface MessageTokenSnapshot {
  timestamp: Date;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  model: string | null;
}

// ---- Token economics ----

/** Per-session token snapshot for trend analysis. */
export interface SessionTokenSnapshot {
  sessionId: string;
  date: Date;
  totalInput: number;            // input + cache_read + cache_creation
  totalOutput: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  newInputTokens: number;        // input_tokens (marginal, non-cached)
  model: string | null;
}

/** Cache miss attribution — why did cache misses occur? */
export interface CacheMissBreakdown {
  ttlTimeoutCount: number;       // Inter-message gap >5 min caused cache expiry
  configChangeCount: number;     // Cache creation without timeout gap
  unknownCount: number;
  ttlTimeoutTokens: number;
  configChangeTokens: number;
  unknownTokens: number;
}

/** Full token economics report. */
export interface TokenEconomicsReport {
  // Data quality
  sessionsWithTokenData: number;
  sessionsTotal: number;

  // Startup cost comparison
  estimatedStartupTokens: number;      // From ConfigInventory.totalStartupTokens
  actualFirstMessageTokens: number;    // Average input tokens on first assistant message
  startupDelta: number;                // actual - estimated
  startupDeltaPercent: number;         // (delta / estimated) * 100

  // Cost estimation (USD, approximate)
  totalEstimatedCost: number;
  avgCostPerSession: number;
  costByModel: Map<string, number>;

  // Cache analysis
  overallCacheEfficiency: number;      // 0-100 percentage
  cacheMissBreakdown: CacheMissBreakdown;

  // Trends
  sessionSnapshots: SessionTokenSnapshot[];

  // Compaction
  totalCompactions: number;
  sessionsWithCompaction: number;
}

// ---- Discrepancies ----

/** A detected discrepancy between config and runtime behavior. */
export interface ConfigDiscrepancy {
  /** Discrepancy type identifier. */
  type:
    | 'ghost-delegation'
    | 'orphan-confirmed'
    | 'permission-contradiction'
    | 'write-blindness-recurring'
    | 'ghost-mcp-server'
    | 'ephemeral-teammates'
    | 'agent-bypass';
  /** Severity — orphan-confirmed upgrades from info to warning. */
  severity: 'info' | 'warning';
  /** Confidence level. */
  confidence: FindingConfidence;
  /** Human-readable description. */
  message: string;
  /** The config component involved. */
  componentName: string;
  /** Component type for grouping. */
  componentType: 'agent' | 'permission' | 'rule' | 'mcp-server';
  /** Supporting evidence. */
  evidence: string;
  /** Session count where this was observed. */
  sessionCount: number;
  /** Total sessions analyzed. */
  sessionsAnalyzed: number;
}

/** Complete discrepancy report. */
export interface DiscrepancyReport {
  discrepancies: ConfigDiscrepancy[];
  sessionsAnalyzed: number;
}

// ---- File activity heatmap ----

/** A single file entry in the heatmap analysis. */
export interface FileHeatmapEntry {
  filePath: string;
  readCount: number;
  editCount: number;
  writeCount: number;
  sessionCount: number;
  /** Average edits per session (for high-churn). */
  editsPerSession?: number;
}

/** A cluster of files frequently edited together. */
export interface FileCluster {
  files: string[];
  sharedSessions: number;
}

/** File activity heatmap analysis. */
export interface FileHeatmapReport {
  /** Files with most edits across sessions. */
  highChurn: FileHeatmapEntry[];
  /** Files Read but never Edited — reference files. */
  readOnlyReferences: FileHeatmapEntry[];
  /** Files Edited but never Read. */
  editWithoutRead: FileHeatmapEntry[];
  /** Test correlation: edited source files with/without test file activity. */
  testCorrelation: {
    editedSourceFiles: number;
    withTestActivity: number;
    withoutTestActivity: number;
    correlationPercent: number;
    /** Source files missing test activity (top 10). */
    untestedFiles: string[];
  };
  /** File clusters edited together (stretch — may be null). */
  coEditClusters: FileCluster[] | null;
  /** Total unique files in activity data. */
  totalFilesTracked: number;
}

// ---- Discovery ----

/** Metadata about a discovered session file (without parsing it). */
export interface SessionFileInfo {
  /** UUID extracted from the filename (sans .jsonl extension). */
  sessionId: string;
  /** Absolute path to the .jsonl file. */
  filePath: string;
  /** File size in bytes. */
  fileSize: number;
  /** File modification time. */
  lastModified: Date;
}

/** Result of discovering transcript files for a project. */
export interface TranscriptDiscoveryResult {
  /** The encoded project directory under ~/.claude/projects/. */
  projectDir: string;
  /** Discovered session files, sorted by lastModified descending. */
  sessionFiles: SessionFileInfo[];
  /** Path to sessions-index.json if it exists, null otherwise. */
  sessionsIndexPath: string | null;
}
