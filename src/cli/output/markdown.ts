import type { LintResult } from '../../types/index.js';

export function printLintResultMarkdown(result: LintResult): string {
  const lines: string[] = [];

  lines.push('# ccinspect Lint Report');
  lines.push('');

  if (result.issues.length === 0) {
    lines.push('**No issues found.** Configuration looks good!');
    lines.push('');
  } else {
    lines.push('| Severity | Rule | Message | File | Suggestion |');
    lines.push('|----------|------|---------|------|------------|');

    for (const issue of result.issues) {
      let severity: string;
      if (issue.severity === 'error') {
        severity = '**ERROR**';
      } else if (issue.severity === 'warning') {
        severity = 'warning';
      } else {
        severity = 'info';
      }
      const lineRef = issue.line ? `:${issue.line}` : '';
      const file = issue.file ? `\`${issue.file}${lineRef}\`` : '-';
      const message = issue.message.replace(/\|/g, '\\|');
      const suggestion = issue.suggestion.replace(/\|/g, '\\|');
      lines.push(`| ${severity} | \`${issue.ruleId}\` | ${message} | ${file} | ${suggestion} |`);
    }
    lines.push('');
  }

  // Summary
  lines.push('## Summary');
  lines.push('');

  const parts: string[] = [];
  if (result.stats.errors > 0) parts.push(`${result.stats.errors} error(s)`);
  if (result.stats.warnings > 0) parts.push(`${result.stats.warnings} warning(s)`);
  if (result.stats.infos > 0) parts.push(`${result.stats.infos} info(s)`);
  if (parts.length === 0) parts.push('0 issues');

  lines.push(`- **Issues:** ${parts.join(', ')}`);
  lines.push(`- **Rules checked:** ${result.stats.rulesRun}`);
  lines.push(`- **Files scanned:** ${result.stats.filesChecked}`);
  lines.push(`- **Duration:** ${result.stats.duration}ms`);
  lines.push('');

  return lines.join('\n');
}
