import type { TranscriptParseResult } from '../parsers/transcript-jsonl.js';
import type { TaskAttempt, ToolCall, ToolResult } from '../types/transcript.js';
import { relative } from 'path';

// ---- Public types ----

export interface RecoveryAssessment {
  sessionId: string;
  sessionDate: Date;

  /** Session completion status. */
  status: 'complete' | 'incomplete' | 'failed' | 'damaged';

  /** Info about the last task in the session. */
  lastTask: {
    prompt: string;
    startedAt: Date;
    toolCallCount: number;
    filesModified: string[];
    filesRead: string[];
  } | null;

  /** Most recent successful tool call before the end/failure. */
  lastCheckpoint: {
    description: string;
    timestamp: Date;
    toolName: string;
    filePath?: string;
  } | null;

  /** Error info when status === 'failed'. */
  lastError: {
    toolName: string;
    command?: string;
    errorMessage: string;
    timestamp: Date;
  } | null;

  /** Generated recovery prompt for pasting into a new session. */
  recoveryPrompt: string;
}

// ---- Helpers ----

const MAX_PROMPT_LENGTH = 200;
const MAX_ERROR_LENGTH = 300;

/**
 * Strip Claude Code XML wrapper tags (e.g., <ide_opened_file>...</ide_opened_file>)
 * from user prompt text. If nothing remains after stripping, return a fallback.
 */
export function cleanPromptText(prompt: string): string {
  // Strip <ide_opened_file>...</ide_opened_file> blocks
  let cleaned = prompt.replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>\s*/g, '').trim();
  // Strip <ide_selection>...</ide_selection> blocks
  cleaned = cleaned.replace(/<ide_selection>[\s\S]*?<\/ide_selection>\s*/g, '').trim();
  // Strip any other <tag>...</tag> wrapper that looks like a Claude Code system tag
  cleaned = cleaned.replace(/<[a-z_-]+>[\s\S]*?<\/[a-z_-]+>\s*/g, '').trim();

  if (!cleaned) {
    return '(IDE-initiated session)';
  }

  return cleaned;
}

/**
 * Replace absolute paths in text with project-relative or ~/... paths.
 */
export function normalizePathsInText(text: string, projectRoot?: string): string {
  let result = text;
  if (projectRoot) {
    // Replace project root prefix (with trailing slash to avoid partial matches)
    result = result.replaceAll(projectRoot + '/', '');
  }
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home) {
    result = result.replaceAll(home + '/', '~/');
  }
  return result;
}

/**
 * Make a path relative to projectRoot, or return as-is if not under projectRoot.
 */
function normalizePath(filePath: string, projectRoot?: string): string {
  if (!projectRoot) return filePath;
  const rel = relative(projectRoot, filePath);
  // If the relative path starts with ".." it's outside project root
  if (rel.startsWith('..') || rel === filePath) return filePath;
  return rel;
}

/**
 * Extract file paths from Edit/Write tool calls in a task.
 */
function extractModifiedFiles(task: TaskAttempt, projectRoot?: string): string[] {
  const paths = new Set<string>();
  for (const tc of task.toolCalls) {
    if (tc.toolName === 'Edit' || tc.toolName === 'Write') {
      const fp = tc.input.file_path as string | undefined;
      if (fp) paths.add(normalizePath(fp, projectRoot));
    }
  }
  return [...paths];
}

/**
 * Extract file paths from Read tool calls in a task.
 */
function extractReadFiles(task: TaskAttempt, projectRoot?: string): string[] {
  const paths = new Set<string>();
  for (const tc of task.toolCalls) {
    if (tc.toolName === 'Read') {
      const fp = tc.input.file_path as string | undefined;
      if (fp) paths.add(normalizePath(fp, projectRoot));
    }
  }
  return [...paths];
}

/**
 * Find the corresponding ToolCall for a ToolResult by callId.
 */
function findToolCallForResult(result: ToolResult, toolCalls: ToolCall[]): ToolCall | undefined {
  return toolCalls.find((tc) => tc.callId === result.callId);
}

/**
 * Build a human-readable description for a successful checkpoint.
 */
function describeCheckpoint(toolCall: ToolCall): { description: string; filePath?: string } {
  const name = toolCall.toolName;

  if (name === 'Bash') {
    const cmd = (toolCall.input.command as string) ?? '';
    const lower = cmd.toLowerCase();
    if (lower.includes('npm test') || lower.includes('vitest') || lower.includes('jest'))
      return { description: 'Tests passed' };
    if (lower.includes('npm run build') || lower.includes('tsc'))
      return { description: 'Build succeeded' };
    if (lower.includes('git commit'))
      return { description: 'Git commit completed' };
    const shortCmd = cmd.length > 60 ? cmd.slice(0, 60) + '…' : cmd;
    return { description: `Command succeeded: ${shortCmd}` };
  }

  if (name === 'Write' || name === 'Edit') {
    const fp = toolCall.input.file_path as string | undefined;
    if (fp) {
      const filename = fp.split('/').pop() ?? fp;
      return { description: `File written: ${filename}`, filePath: fp };
    }
  }

  return { description: `${name} completed successfully` };
}

/**
 * Extract error message from a tool result.
 */
function extractErrorMessage(result: ToolResult): string {
  // Check toolUseResult for error content
  const tur = result.toolUseResult;
  if (tur) {
    // Look for common error fields
    for (const key of ['stderr', 'error', 'message', 'content']) {
      const val = tur[key];
      if (typeof val === 'string' && val.length > 0) {
        return val.length > MAX_ERROR_LENGTH ? val.slice(0, MAX_ERROR_LENGTH) + '…' : val;
      }
    }
  }

  return 'Unknown error';
}

// ---- Status determination ----

function determineStatus(parseResult: TranscriptParseResult): RecoveryAssessment['status'] {
  if (parseResult.session.completeness === 'damaged') return 'damaged';
  if (parseResult.tasks.length === 0) return 'complete';

  const lastTask = parseResult.tasks[parseResult.tasks.length - 1];
  switch (lastTask.outcome) {
    case 'success':
      return 'complete';
    case 'failed':
      return 'failed';
    case 'interrupted':
    case 'partial':
    case 'unknown':
      return 'incomplete';
  }
}

// ---- Last checkpoint finder ----

function findLastCheckpoint(
  task: TaskAttempt,
  allToolCalls: ToolCall[],
): RecoveryAssessment['lastCheckpoint'] {
  // Scan tool results in reverse to find last success
  for (let i = task.toolResults.length - 1; i >= 0; i--) {
    const result = task.toolResults[i];
    if (result.status === 'success') {
      const tc = findToolCallForResult(result, allToolCalls);
      if (tc) {
        const { description, filePath } = describeCheckpoint(tc);
        // Use the task's endedAt or startedAt as approximation for timestamp
        const timestamp = task.endedAt ?? task.startedAt;
        return { description, timestamp, toolName: tc.toolName, filePath };
      }
    }
  }

  return null;
}

// ---- Last error finder ----

function findLastError(
  task: TaskAttempt,
  allToolCalls: ToolCall[],
): RecoveryAssessment['lastError'] {
  // Find the last error result
  for (let i = task.toolResults.length - 1; i >= 0; i--) {
    const result = task.toolResults[i];
    if (result.status === 'error' || result.status === 'denied') {
      const tc = findToolCallForResult(result, allToolCalls);
      const toolName = tc?.toolName ?? 'unknown';
      const command = tc?.toolName === 'Bash' ? (tc.input.command as string) : undefined;
      const errorMessage = extractErrorMessage(result);
      const timestamp = task.endedAt ?? task.startedAt;

      return { toolName, command, errorMessage, timestamp };
    }
  }

  // Also check previous task for errors that may provide context
  return null;
}

// ---- Recovery prompt builder ----

function buildRecoveryPrompt(
  status: RecoveryAssessment['status'],
  lastTask: RecoveryAssessment['lastTask'],
  lastCheckpoint: RecoveryAssessment['lastCheckpoint'],
  lastError: RecoveryAssessment['lastError'],
): string {
  const lines: string[] = [];
  lines.push('Continue from a previous session. Here\'s the context:');

  if (lastTask) {
    const truncatedPrompt =
      lastTask.prompt.length > MAX_PROMPT_LENGTH
        ? lastTask.prompt.slice(0, MAX_PROMPT_LENGTH) + '…'
        : lastTask.prompt;
    lines.push('');
    lines.push(`Last task: "${truncatedPrompt}"`);

    if (lastTask.filesModified.length > 0) {
      lines.push('');
      lines.push(`Files modified: ${lastTask.filesModified.join(', ')}`);
    }
  }

  if (lastCheckpoint) {
    lines.push('');
    lines.push(`Last successful checkpoint: ${lastCheckpoint.description}`);
  }

  if (lastError) {
    lines.push('');
    const toolDesc = lastError.command
      ? `${lastError.toolName} — ${lastError.command}`
      : lastError.toolName;
    lines.push(`The last action failed: ${toolDesc}`);
    lines.push(`Error: ${lastError.errorMessage}`);
    lines.push('Please fix this error and continue.');
  } else if (status === 'incomplete') {
    lines.push('');
    lines.push('The session ended before the task was completed. Please review the current state and continue.');
  } else if (status === 'complete') {
    lines.push('');
    lines.push('The previous session completed successfully. Review the current state and continue with the next task.');
  } else if (status === 'damaged') {
    lines.push('');
    lines.push('The previous session transcript was damaged. Please review the current state of the project and continue.');
  }

  return lines.join('\n');
}

// ---- Main API ----

/**
 * Analyze a parsed session and produce a recovery assessment.
 */
export function assessRecovery(
  parseResult: TranscriptParseResult,
  projectRoot?: string,
): RecoveryAssessment {
  const status = determineStatus(parseResult);
  const sessionId = parseResult.session.sessionId;
  const sessionDate = parseResult.session.startedAt;

  // Extract last task info
  let lastTask: RecoveryAssessment['lastTask'] = null;
  let lastCheckpoint: RecoveryAssessment['lastCheckpoint'] = null;
  let lastError: RecoveryAssessment['lastError'] = null;

  if (parseResult.tasks.length > 0) {
    const task = parseResult.tasks[parseResult.tasks.length - 1];
    let cleanedPrompt = cleanPromptText(task.prompt);
    cleanedPrompt = normalizePathsInText(cleanedPrompt, projectRoot);

    lastTask = {
      prompt: cleanedPrompt,
      startedAt: task.startedAt,
      toolCallCount: task.toolCalls.length,
      filesModified: extractModifiedFiles(task, projectRoot),
      filesRead: extractReadFiles(task, projectRoot),
    };

    lastCheckpoint = findLastCheckpoint(task, parseResult.toolCalls);

    if (status === 'failed') {
      lastError = findLastError(task, parseResult.toolCalls);
    }
  }

  const recoveryPrompt = buildRecoveryPrompt(status, lastTask, lastCheckpoint, lastError);

  return {
    sessionId,
    sessionDate,
    status,
    lastTask,
    lastCheckpoint,
    lastError,
    recoveryPrompt,
  };
}
