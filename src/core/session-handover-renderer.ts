import type { HandoverResult, FileChange, GateResult, TranscriptHandoverData, TranscriptTaskSummary } from './session-handover.js';
import { formatDuration } from './session-handover.js';

function formatFileChange(change: FileChange): string {
  const statusLabels: Record<FileChange['status'], string> = {
    added: 'Added',
    modified: 'Modified',
    deleted: 'Deleted',
    renamed: 'Renamed',
  };
  return `- ${statusLabels[change.status]}: ${change.path}`;
}

function formatGateRow(name: string, gate: GateResult): string {
  const icon = gate.passed ? '\u2705 Pass' : '\u274c Fail';
  return `| ${name} | ${icon} | ${gate.summary} |`;
}

function formatGateWarningRow(name: string, gate: GateResult): string {
  // For smells: passed with warnings
  const hasWarnings = gate.summary.includes('warnings');
  const hasErrors = gate.summary.match(/^(\d+)\s+errors/);
  const errorCount = hasErrors ? parseInt(hasErrors[1]) : 0;

  if (gate.passed && hasWarnings && errorCount === 0) {
    return `| ${name} | \u26a0\ufe0f Warnings | ${gate.summary} |`;
  }

  return formatGateRow(name, gate);
}

export function renderHandover(result: HandoverResult): string {
  const lines: string[] = [];

  lines.push('# Session Status');
  lines.push('');
  lines.push(`**Generated:** ${result.timestamp}`);
  lines.push(`**Project:** ${result.projectName}`);
  if (result.branch) {
    lines.push(`**Branch:** ${result.branch}`);
  }

  // Transcript sections (inserted before git/test sections when available)
  if (result.transcriptData) {
    renderTranscriptSections(lines, result.transcriptData);
    lines.push('');
    lines.push('---');
  }

  // Completed Work
  lines.push('');
  lines.push('## Completed Work');
  if (result.completedWork.length > 0) {
    for (const change of result.completedWork) {
      lines.push(formatFileChange(change));
    }
  } else {
    lines.push('No changes detected.');
  }

  // Uncommitted Changes
  if (result.uncommittedChanges.length > 0) {
    lines.push('');
    lines.push('## Uncommitted Changes');
    for (const change of result.uncommittedChanges) {
      const suffix = change.staged ? ' (staged)' : ' (unstaged)';
      const statusLabels: Record<FileChange['status'], string> = {
        added: 'Added',
        modified: 'Modified',
        deleted: 'Deleted',
        renamed: 'Renamed',
      };
      lines.push(`- ${statusLabels[change.status]}: ${change.path}${suffix}`);
    }
  }

  // Quality Gates
  const hasAnyGate = result.testResult || result.typecheckResult || result.smellsResult;
  if (hasAnyGate) {
    lines.push('');
    lines.push('## Quality Gates');
    lines.push('');
    lines.push('| Gate | Status | Details |');
    lines.push('|------|--------|---------|');

    if (result.testResult) {
      lines.push(formatGateRow('Tests', result.testResult));
    }
    if (result.typecheckResult) {
      lines.push(formatGateRow('TypeScript', result.typecheckResult));
    }
    if (result.smellsResult) {
      lines.push(formatGateWarningRow('Code Smells', result.smellsResult));
    }
  }

  // Issues Found (TODOs and failing gates)
  const issues: string[] = [];

  if (result.testResult && !result.testResult.passed) {
    issues.push(`- Tests failing: ${result.testResult.summary}`);
  }
  if (result.typecheckResult && !result.typecheckResult.passed) {
    issues.push(`- TypeScript errors: ${result.typecheckResult.summary}`);
  }
  if (result.smellsResult && !result.smellsResult.passed) {
    issues.push(`- Code smell errors: ${result.smellsResult.summary}`);
  }

  for (const todo of result.todos) {
    issues.push(`- ${todo.file}:${todo.line} \u2014 ${todo.text}`);
  }

  if (issues.length > 0) {
    lines.push('');
    lines.push('## Issues Found');
    for (const issue of issues) {
      lines.push(issue);
    }
  }

  // Suggested Next Session Prompt
  lines.push('');
  lines.push('## Suggested Next Session Prompt');
  // Use transcript-derived prompt if available, otherwise the git-based one
  const prompt = result.transcriptData?.suggestedPrompt ?? result.suggestedPrompt;
  lines.push(`> ${prompt}`);
  lines.push('');

  return lines.join('\n');
}

// ---- Transcript section rendering ----

const OUTCOME_ICONS: Record<TranscriptTaskSummary['outcome'], string> = {
  success: '\u2705',
  partial: '\u26a0\ufe0f',
  failed: '\u274c',
  interrupted: '\u23f8\ufe0f',
  unknown: '\u2753',
};

function renderTranscriptSections(lines: string[], data: TranscriptHandoverData): void {
  // Session Summary
  lines.push('');
  lines.push('## Session Summary');
  const s = data.sessionSummary;
  const durationStr = formatDuration(s.durationMinutes);
  const modelStr = s.model ?? 'unknown';
  const turnWord = s.turnCount === 1 ? 'turn' : 'turns';
  const toolWord = s.toolCallCount === 1 ? 'tool call' : 'tool calls';
  lines.push(`- Duration: ${durationStr} \u00b7 Model: ${modelStr} \u00b7 ${s.turnCount} ${turnWord} \u00b7 ${s.toolCallCount} ${toolWord}`);

  if (data.tokenUsage) {
    const tu = data.tokenUsage;
    const inputStr = formatTokenCount(tu.inputTokens);
    const outputStr = formatTokenCount(tu.outputTokens);
    lines.push(`- Tokens: ~${inputStr} input \u00b7 ~${outputStr} output`);
  }

  lines.push(`- Context compactions: ${s.compactionCount}`);

  // Tasks Attempted
  if (data.tasks.length > 0) {
    lines.push('');
    lines.push('## Tasks Attempted');
    for (let i = 0; i < data.tasks.length; i++) {
      const task = data.tasks[i];
      const icon = OUTCOME_ICONS[task.outcome];
      const fileSuffix = task.filesEdited !== 1 ? 's' : '';
      const filesStr = task.filesEdited > 0
        ? `${task.filesEdited} file${fileSuffix} edited`
        : 'no files edited';
      lines.push(`${i + 1}. ${icon} ${task.description} \u2014 ${filesStr}, ${task.toolCallCount} tool calls`);
    }
  }

  // Tool Usage
  if (data.toolUsage.length > 0) {
    lines.push('');
    lines.push('## Tool Usage');
    const parts = data.toolUsage.map((t) => `${t.name}: ${t.count}`);
    lines.push(`  ${parts.join(' \u00b7 ')}`);
  }

  // Git Correlation
  const gc = data.gitCorrelation;
  const hasCorrelation = gc.claudeModified.length > 0 || gc.manualEdits.length > 0 || gc.reverted.length > 0;
  if (hasCorrelation) {
    lines.push('');
    lines.push('## Git Correlation');
    if (gc.claudeModified.length > 0) {
      lines.push(`  Claude-modified:  ${gc.claudeModified.join(', ')}`);
    }
    if (gc.manualEdits.length > 0) {
      lines.push(`  Manual edits:     ${gc.manualEdits.join(', ')}`);
    }
    if (gc.reverted.length > 0) {
      lines.push(`  Reverted:         ${gc.reverted.join(', ')}`);
    }
    if (gc.claudeModified.length === 0) {
      lines.push('  Claude-modified:  (none)');
    }
    if (gc.manualEdits.length === 0) {
      lines.push('  Manual edits:     (none)');
    }
    if (gc.reverted.length === 0) {
      lines.push('  Reverted:         (none)');
    }
  }
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return String(tokens);
}
