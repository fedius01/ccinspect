import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { basename, join, resolve } from 'path';
import { findGitRoot } from '../utils/git.js';
import type { TranscriptParseResult } from '../parsers/transcript-jsonl.js';
import { parseTranscriptFile } from '../parsers/transcript-jsonl.js';
import { discoverTranscripts } from '../utils/transcript-discovery.js';
import { cleanPromptText, normalizePathsInText } from './session-recovery.js';
import type { TaskAttempt, ToolCall, UsageSummary } from '../types/transcript.js';

export interface HandoverConfig {
  testCommand: string;
  typecheckCommand: string;
  smellsCommand: string;
  statusFile: string;
  diffBase: string;
  skipTests: boolean;
  skipTypecheck: boolean;
  projectDir: string;
  /** Enable transcript integration. */
  transcript?: boolean;
  /** Target a specific session UUID (implies transcript). */
  sessionId?: string;
  /** Duration filter for transcript events (e.g., "2h", "30m"). */
  since?: string;
}

/** Transcript-derived data for the handover output. */
export interface TranscriptHandoverData {
  /** Session metadata. */
  sessionSummary: {
    sessionId: string;
    durationMinutes: number;
    model: string | null;
    turnCount: number;
    toolCallCount: number;
    compactionCount: number;
  };

  /** Token usage, if available. */
  tokenUsage: UsageSummary | null;

  /** Per-task narrative. */
  tasks: TranscriptTaskSummary[];

  /** Tool call counts by name. */
  toolUsage: Array<{ name: string; count: number }>;

  /** Git correlation results. */
  gitCorrelation: {
    claudeModified: string[];
    manualEdits: string[];
    reverted: string[];
  };

  /** Suggested next prompt from transcript. */
  suggestedPrompt: string;
}

export interface TranscriptTaskSummary {
  /** Outcome icon: checkmark, warning, cross, pause. */
  outcome: TaskAttempt['outcome'];
  /** Brief description from user prompt. */
  description: string;
  /** Files edited in this task. */
  filesEdited: number;
  /** Total tool calls in this task. */
  toolCallCount: number;
}

export interface HandoverResult {
  timestamp: string;
  projectName: string;
  branch: string | null;
  completedWork: FileChange[];
  uncommittedChanges: FileChange[];
  testResult: GateResult | null;
  typecheckResult: GateResult | null;
  smellsResult: GateResult | null;
  todos: TodoItem[];
  suggestedPrompt: string;
  /** Transcript data — only present when --transcript is used. */
  transcriptData?: TranscriptHandoverData;
}

export interface FileChange {
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  path: string;
  staged: boolean;
}

export interface GateResult {
  passed: boolean;
  summary: string;
  raw: string;
}

export interface TodoItem {
  file: string;
  line: number;
  text: string;
}

const COMMAND_TIMEOUT = 60_000;

function runCommand(command: string, cwd: string): { exitCode: number; stdout: string; stderr: string } {
  try {
     
    const stdout = execSync(command, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: COMMAND_TIMEOUT,
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'status' in error) {
      const execError = error as { status: number | null; stdout: string; stderr: string };
      return {
        exitCode: execError.status ?? 1,
        stdout: execError.stdout ?? '',
        stderr: execError.stderr ?? '',
      };
    }
    // Timeout or other error
    const msg = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: '', stderr: msg };
  }
}

function parseGitNameStatus(output: string): FileChange[] {
  const changes: FileChange[] = [];
  for (const line of output.trim().split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const statusCode = parts[0].trim();
    const filePath = parts[parts.length - 1].trim();

    let status: FileChange['status'];
    switch (statusCode[0]) {
      case 'A':
        status = 'added';
        break;
      case 'D':
        status = 'deleted';
        break;
      case 'R':
        status = 'renamed';
        break;
      default:
        status = 'modified';
        break;
    }
    changes.push({ status, path: filePath, staged: false });
  }
  return changes;
}

function getCompletedWork(cwd: string, diffBase: string): FileChange[] {
  const result = runCommand(`git diff ${diffBase} --name-status`, cwd);
  if (result.exitCode !== 0 && !result.stdout) return [];
  return parseGitNameStatus(result.stdout);
}

function getUncommittedChanges(cwd: string): FileChange[] {
  const changes: FileChange[] = [];

  // Staged changes
  const staged = runCommand('git diff --cached --name-status', cwd);
  if (staged.stdout.trim()) {
    for (const change of parseGitNameStatus(staged.stdout)) {
      changes.push({ ...change, staged: true });
    }
  }

  // Unstaged changes
  const unstaged = runCommand('git diff --name-status', cwd);
  if (unstaged.stdout.trim()) {
    for (const change of parseGitNameStatus(unstaged.stdout)) {
      changes.push({ ...change, staged: false });
    }
  }

  // Untracked files
  const untracked = runCommand('git ls-files --others --exclude-standard', cwd);
  if (untracked.stdout.trim()) {
    for (const line of untracked.stdout.trim().split('\n')) {
      if (line.trim()) {
        changes.push({ status: 'added', path: line.trim(), staged: false });
      }
    }
  }

  return changes;
}

function getBranch(cwd: string): string | null {
  const result = runCommand('git branch --show-current', cwd);
  if (result.exitCode !== 0) return null;
  return result.stdout.trim() || null;
}

function parseTestOutput(stdout: string, stderr: string): string {
  const combined = stdout + '\n' + stderr;

  // Vitest patterns
  const vitestMatch = combined.match(/Tests\s+(\d+)\s+passed/);
  const vitestFailMatch = combined.match(/Tests\s+(\d+)\s+failed\s*\|\s*(\d+)\s+passed/);
  if (vitestFailMatch) {
    return `${vitestFailMatch[2]} passing, ${vitestFailMatch[1]} failing`;
  }
  if (vitestMatch) {
    return `${vitestMatch[1]} passing`;
  }

  // Generic patterns: "X passing", "X failed"
   
  const passingMatch = combined.match(/(\d+)\s+pass(?:ing|ed)/i);
   
  const failingMatch = combined.match(/(\d+)\s+fail(?:ing|ed)/i);
  if (passingMatch && failingMatch) {
    return `${passingMatch[1]} passing, ${failingMatch[1]} failing`;
  }
  if (passingMatch) {
    return `${passingMatch[1]} passing`;
  }
  if (failingMatch) {
    return `${failingMatch[1]} failing`;
  }

  return 'completed';
}

function parseTypecheckOutput(stdout: string, stderr: string): string {
  const combined = stdout + '\n' + stderr;

  // tsc pattern: "Found N error(s)"
  const errorMatch = combined.match(/Found\s+(\d+)\s+error/);
  if (errorMatch) {
    return `${errorMatch[1]} error${parseInt(errorMatch[1]) !== 1 ? 's' : ''}`;
  }

  return '0 errors';
}

function parseSmellsOutput(stdout: string, stderr: string): string {
  const combined = stdout + '\n' + stderr;

  // ESLint pattern: "N problems (M errors, K warnings)"
   
  const problemsMatch = combined.match(/(\d+)\s+problems?\s*\((\d+)\s+errors?,\s*(\d+)\s+warnings?\)/);
  if (problemsMatch) {
    return `${problemsMatch[2]} errors, ${problemsMatch[3]} warnings`;
  }

  // Simpler pattern: "X errors" or "X warnings"
   
  const errorMatch = combined.match(/(\d+)\s+errors?/i);
   
  const warningMatch = combined.match(/(\d+)\s+warnings?/i);
  if (errorMatch || warningMatch) {
    const errors = errorMatch ? errorMatch[1] : '0';
    const warnings = warningMatch ? warningMatch[1] : '0';
    return `${errors} errors, ${warnings} warnings`;
  }

  return 'completed';
}

function findTodosInFiles(cwd: string, files: string[]): TodoItem[] {
  const todos: TodoItem[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(cwd, file), 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/\b(TODO|FIXME|HACK|XXX)\b:?\s*(.*)/);
        if (match) {
          todos.push({
            file,
            line: i + 1,
            text: `${match[1]}: ${match[2].trim() || '(no description)'}`,
          });
        }
      }
    } catch {
      // File might not exist (deleted), skip
    }
  }
  return todos;
}

function hasPackageScript(cwd: string, scriptName: string): boolean {
  try {
    const pkgPath = join(cwd, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
    const scripts = pkg.scripts as Record<string, string> | undefined;
    return scripts !== undefined && scriptName in scripts;
  } catch {
    return false;
  }
}

function buildSuggestedPrompt(result: HandoverResult): string {
  const parts: string[] = [];

  // Check for failures
  if (result.testResult && !result.testResult.passed) {
    parts.push(`Fix failing tests (${result.testResult.summary}).`);
  }
  if (result.typecheckResult && !result.typecheckResult.passed) {
    parts.push(`Fix TypeScript errors (${result.typecheckResult.summary}).`);
  }
  if (result.smellsResult && !result.smellsResult.passed) {
    parts.push(`Address code smell errors (${result.smellsResult.summary}).`);
  }

  if (parts.length > 0) {
    return parts.join(' ');
  }

  // All green
  const qualityParts: string[] = [];
  qualityParts.push('All quality gates passing.');

  if (result.smellsResult && result.smellsResult.summary.includes('warnings')) {
     
    const warningMatch = result.smellsResult.summary.match(/(\d+)\s+warnings?/);
    if (warningMatch && parseInt(warningMatch[1]) > 0) {
      qualityParts.push(`${warningMatch[1]} code smell warnings remain (tracked tech debt, see \`/smells\`).`);
    }
  }

  if (result.uncommittedChanges.length > 0) {
    qualityParts.push(`${result.uncommittedChanges.length} uncommitted change(s) to review.`);
  }

  return qualityParts.join(' ');
}

export async function generateHandover(config: HandoverConfig): Promise<HandoverResult> {
  const cwd = config.projectDir;
  const gitRoot = findGitRoot(cwd);
  const isGitRepo = gitRoot !== null;

  const timestamp = new Date().toISOString();
  const projectName = isGitRepo ? basename(gitRoot) : basename(cwd);
  const branch = isGitRepo ? getBranch(cwd) : null;

  // Completed work (committed changes)
  const completedWork = isGitRepo ? getCompletedWork(cwd, config.diffBase) : [];

  // Uncommitted changes
  const uncommittedChanges = isGitRepo ? getUncommittedChanges(cwd) : [];

  // Quality gates
  let testResult: GateResult | null = null;
  if (!config.skipTests) {
    const test = runCommand(config.testCommand, cwd);
    const summary = parseTestOutput(test.stdout, test.stderr);
    testResult = {
      passed: test.exitCode === 0,
      summary,
      raw: (test.stdout + '\n' + test.stderr).trim(),
    };
  }

  let typecheckResult: GateResult | null = null;
  if (!config.skipTypecheck) {
    const tsc = runCommand(config.typecheckCommand, cwd);
    const summary = tsc.exitCode === 0 ? '0 errors' : parseTypecheckOutput(tsc.stdout, tsc.stderr);
    typecheckResult = {
      passed: tsc.exitCode === 0,
      summary,
      raw: (tsc.stdout + '\n' + tsc.stderr).trim(),
    };
  }

  let smellsResult: GateResult | null = null;
  if (hasPackageScript(cwd, 'smells')) {
    const smells = runCommand(config.smellsCommand, cwd);
    const summary = parseSmellsOutput(smells.stdout, smells.stderr);
    const hasErrors = summary.match(/^(\d+)\s+errors/);
    const errorCount = hasErrors ? parseInt(hasErrors[1]) : 0;
    smellsResult = {
      passed: smells.exitCode === 0 || errorCount === 0,
      summary,
      raw: (smells.stdout + '\n' + smells.stderr).trim(),
    };
  }

  // Find TODOs in changed files
  const changedPaths = [
    ...completedWork.map((c) => c.path),
    ...uncommittedChanges.map((c) => c.path),
  ].filter((p, i, arr) => arr.indexOf(p) === i);
  const todos = findTodosInFiles(cwd, changedPaths);

  // Build result
  const result: HandoverResult = {
    timestamp,
    projectName,
    branch,
    completedWork,
    uncommittedChanges,
    testResult,
    typecheckResult,
    smellsResult,
    todos,
    suggestedPrompt: '',
  };

  result.suggestedPrompt = buildSuggestedPrompt(result);

  // Transcript integration (when --transcript or --session is used)
  if (config.transcript || config.sessionId) {
    const transcriptData = await collectTranscriptData(config, result);
    if (transcriptData) {
      result.transcriptData = transcriptData;
    }
  }

  return result;
}

// ---- Duration parsing ----

/**
 * Parse a duration string like "2h" or "30m" into milliseconds.
 * Supports: Nh (hours), Nm (minutes).
 */
export function parseDuration(duration: string): number | null {
  const match = duration.match(/^(\d+)([hm])$/);
  if (!match) return null;
  const value = parseInt(match[1]);
  const unit = match[2];
  if (unit === 'h') return value * 60 * 60 * 1000;
  if (unit === 'm') return value * 60 * 1000;
  return null;
}

// ---- Format duration ----

export function formatDuration(minutes: number): string {
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}min`;
}

// ---- Transcript data collection ----

async function collectTranscriptData(
  config: HandoverConfig,
  handoverResult: HandoverResult,
): Promise<TranscriptHandoverData | null> {
  const projectRoot = resolve(config.projectDir);

  // Discover transcripts
  const discovery = await discoverTranscripts(projectRoot);
  if (!discovery || discovery.sessionFiles.length === 0) {
    return null;
  }

  // Find target session
  let targetFile = discovery.sessionFiles[0]; // default: most recent
  if (config.sessionId) {
    const found = discovery.sessionFiles.find((f) => f.sessionId === config.sessionId);
    if (!found) return null;
    targetFile = found;
  }

  // Parse the session (always re-parse — need full events)
  let parseResult: TranscriptParseResult;
  try {
    parseResult = await parseTranscriptFile(targetFile.filePath);
  } catch {
    return null;
  }

  // Apply --since filter if specified
  let tasks = parseResult.tasks;
  let toolCalls = parseResult.toolCalls;
  if (config.since) {
    const durationMs = parseDuration(config.since);
    if (durationMs) {
      const cutoff = new Date(Date.now() - durationMs);
      tasks = tasks.filter((t) => t.startedAt >= cutoff);
      toolCalls = toolCalls.filter((tc) => {
        // Keep tool calls belonging to tasks in the filtered time range
        return tasks.some((t) =>
          tc.callId && t.toolCalls.some((ttc) => ttc.callId === tc.callId),
        );
      });
      // If since filters everything, fall back to all data
      if (tasks.length === 0) {
        tasks = parseResult.tasks;
        toolCalls = parseResult.toolCalls;
      }
    }
  }

  // Session summary
  const session = parseResult.session;
  const durationMs = (session.endedAt ?? new Date()).getTime() - session.startedAt.getTime();
  const durationMinutes = durationMs / (1000 * 60);
  const compactionCount = session.events.filter((e) => e.kind === 'system' && e.rawType === 'system').length;

  const sessionSummary = {
    sessionId: session.sessionId,
    durationMinutes,
    model: session.model,
    turnCount: tasks.length,
    toolCallCount: toolCalls.length,
    compactionCount,
  };

  // Token usage
  const tokenUsage = parseResult.tokenUsage.sessionsWithData > 0
    ? parseResult.tokenUsage
    : null;

  // Task narrative
  const taskSummaries = tasks.map((task) => buildTaskSummary(task, projectRoot));

  // Tool usage breakdown
  const toolCountMap = new Map<string, number>();
  for (const tc of toolCalls) {
    toolCountMap.set(tc.toolName, (toolCountMap.get(tc.toolName) ?? 0) + 1);
  }
  const toolUsage = [...toolCountMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // Git correlation
  const gitCorrelation = correlateGitChanges(handoverResult, toolCalls, projectRoot);

  // Suggested next prompt from transcript
  const suggestedPrompt = buildTranscriptSuggestedPrompt(tasks);

  return {
    sessionSummary,
    tokenUsage,
    tasks: taskSummaries,
    toolUsage,
    gitCorrelation,
    suggestedPrompt,
  };
}

function buildTaskSummary(task: TaskAttempt, projectRoot: string): TranscriptTaskSummary {
  let description = cleanPromptText(task.prompt);
  description = normalizePathsInText(description, projectRoot);
  // Truncate to 100 chars
  if (description.length > 100) {
    description = description.slice(0, 100) + '...';
  }

  // Count files edited
  const editedFiles = new Set<string>();
  for (const tc of task.toolCalls) {
    if (tc.toolName === 'Edit' || tc.toolName === 'Write') {
      const fp = tc.input.file_path as string | undefined;
      if (fp) editedFiles.add(fp);
    }
  }

  return {
    outcome: task.outcome,
    description,
    filesEdited: editedFiles.size,
    toolCallCount: task.toolCalls.length,
  };
}

function correlateGitChanges(
  handoverResult: HandoverResult,
  toolCalls: ToolCall[],
  projectRoot: string,
): TranscriptHandoverData['gitCorrelation'] {
  // Get all file paths from git diff (both committed and uncommitted)
  const gitFiles = new Set<string>();
  for (const change of handoverResult.completedWork) {
    gitFiles.add(change.path);
  }
  for (const change of handoverResult.uncommittedChanges) {
    gitFiles.add(change.path);
  }

  // Get all file paths from transcript Edit/Write calls
  const transcriptFiles = new Set<string>();
  for (const tc of toolCalls) {
    if (tc.toolName === 'Edit' || tc.toolName === 'Write') {
      const fp = tc.input.file_path as string | undefined;
      if (fp) {
        // Normalize to project-relative
        if (fp.startsWith(projectRoot + '/')) {
          transcriptFiles.add(fp.slice(projectRoot.length + 1));
        } else {
          transcriptFiles.add(fp);
        }
      }
    }
  }

  const claudeModified: string[] = [];
  const manualEdits: string[] = [];
  const reverted: string[] = [];

  // Files in git AND transcript → Claude-modified
  // Files in git but NOT transcript → manual edits
  for (const file of gitFiles) {
    if (transcriptFiles.has(file)) {
      claudeModified.push(file);
    } else {
      manualEdits.push(file);
    }
  }

  // Files in transcript but NOT git → reverted
  for (const file of transcriptFiles) {
    if (!gitFiles.has(file)) {
      reverted.push(file);
    }
  }

  return { claudeModified, manualEdits, reverted };
}

function buildTranscriptSuggestedPrompt(tasks: TaskAttempt[]): string {
  if (tasks.length === 0) {
    return 'The session completed successfully. Continue with the next planned task.';
  }

  const lastTask = tasks[tasks.length - 1];
  const cleanedPrompt = cleanPromptText(lastTask.prompt);
  const truncated = cleanedPrompt.length > 200
    ? cleanedPrompt.slice(0, 200) + '...'
    : cleanedPrompt;

  switch (lastTask.outcome) {
    case 'interrupted':
      return `Continue the interrupted task: "${truncated}"`;
    case 'failed':
      return `Fix the failed task: "${truncated}"`;
    case 'partial':
      return `Complete the partially finished task: "${truncated}"`;
    case 'success':
    case 'unknown':
    default:
      return 'The session completed successfully. Continue with the next planned task.';
  }
}
