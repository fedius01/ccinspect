import type { HandoverResult, FileChange, GateResult } from './session-handover.js';

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
  lines.push(`> ${result.suggestedPrompt}`);
  lines.push('');

  return lines.join('\n');
}
