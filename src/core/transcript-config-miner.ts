import { resolve as resolvePath } from 'path';
import { discoverTranscripts } from '../utils/transcript-discovery.js';
import { parseTranscriptFile } from '../parsers/transcript-jsonl.js';
import type { TranscriptConfigChange } from '../types/history.js';
import type { ToolCall } from '../types/transcript.js';

/**
 * Mine Claude Code transcripts for config file edits.
 *
 * Scans transcript JSONL files for Edit and Write tool calls that target
 * known config file paths. Returns a chronologically sorted list of changes.
 *
 * @param projectRoot - Absolute path to the project root
 * @param configPaths - Absolute paths of config files to track
 * @param since - Optional ISO timestamp; only process sessions starting after this date
 * @returns Array of TranscriptConfigChange sorted chronologically (oldest first)
 */
export async function mineTranscriptConfigChanges(
  projectRoot: string,
  configPaths: string[],
  since?: string,
): Promise<TranscriptConfigChange[]> {
  if (configPaths.length === 0) return [];

  // Normalize config paths for comparison
  const normalizedPaths = new Set(configPaths.map((p) => resolvePath(p)));

  // Discover transcript sessions
  const discovery = await discoverTranscripts(projectRoot);
  if (!discovery || discovery.sessionFiles.length === 0) return [];

  // Parse the since threshold
  const sinceMs = since ? new Date(since).getTime() : 0;

  const allChanges: TranscriptConfigChange[] = [];

  for (const sessionFile of discovery.sessionFiles) {
    // Filter by date: skip sessions older than `since`
    // Use lastModified as a proxy for session timing
    if (sinceMs > 0 && sessionFile.lastModified.getTime() < sinceMs) {
      continue;
    }

    try {
      const parseResult = await parseTranscriptFile(sessionFile.filePath);

      // Extract the session start timestamp (from first message or fallback to mtime)
      const sessionTimestamp = parseResult.session.startedAt?.toISOString()
        ?? sessionFile.lastModified.toISOString();

      // Filter by session start time (conservative: skip entire session if it started before `since`)
      if (sinceMs > 0) {
        const sessionStartMs = parseResult.session.startedAt?.getTime()
          ?? sessionFile.lastModified.getTime();
        if (sessionStartMs < sinceMs) continue;
      }

      // Scan tool calls for config file changes
      for (const toolCall of parseResult.toolCalls) {
        const change = extractConfigChange(
          toolCall,
          normalizedPaths,
          sessionFile.sessionId,
          sessionTimestamp,
        );
        if (change) {
          allChanges.push(change);
        }
      }
    } catch {
      // Skip sessions that fail to parse — non-fatal
    }
  }

  // Sort chronologically (oldest first)
  allChanges.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return allChanges;
}

/**
 * Check if a tool call modifies a config file, and extract the change details.
 */
function extractConfigChange(
  toolCall: ToolCall,
  configPaths: Set<string>,
  sessionId: string,
  sessionTimestamp: string,
): TranscriptConfigChange | null {
  const input = toolCall.input;
  if (!input) return null;

  if (toolCall.toolName === 'Write') {
    const filePath = getFilePath(input);
    if (!filePath) return null;

    const resolved = resolvePath(filePath);
    if (!configPaths.has(resolved)) return null;

    // Write tool: full content is in input.content or input.file_text
    const content = (input.content as string) ?? (input.file_text as string) ?? null;

    return {
      sessionId,
      timestamp: sessionTimestamp,
      toolName: 'Write',
      filePath: resolved,
      changeType: content !== null ? 'overwrite' : 'create',
      content: content ?? undefined,
      confidence: 'high',
    };
  }

  if (toolCall.toolName === 'Edit') {
    const filePath = getFilePath(input);
    if (!filePath) return null;

    const resolved = resolvePath(filePath);
    if (!configPaths.has(resolved)) return null;

    const oldStr = (input.old_str ?? input.old_string) as string | undefined;
    const newStr = (input.new_str ?? input.new_string) as string | undefined;

    return {
      sessionId,
      timestamp: sessionTimestamp,
      toolName: 'Edit',
      filePath: resolved,
      changeType: 'edit',
      editPatch: oldStr !== undefined && newStr !== undefined
        ? { oldStr, newStr }
        : undefined,
      confidence: 'high',
    };
  }

  // We skip Bash tool calls for now — best-effort detection is complex
  // and low confidence. The disk snapshot catches these changes anyway.
  return null;
}

/**
 * Extract the file path from a tool call's input object.
 * Handles variations in field naming across tool versions.
 */
function getFilePath(input: Record<string, unknown>): string | null {
  return (input.file_path as string)
    ?? (input.filePath as string)
    ?? (input.path as string)
    ?? null;
}
