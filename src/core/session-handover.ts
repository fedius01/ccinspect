import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { basename, join } from 'path';
import { findGitRoot } from '../utils/git.js';

export interface HandoverConfig {
  testCommand: string;
  typecheckCommand: string;
  smellsCommand: string;
  statusFile: string;
  diffBase: string;
  skipTests: boolean;
  skipTypecheck: boolean;
  projectDir: string;
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
    // eslint-disable-next-line sonarjs/os-command
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

  return result;
}
