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
      if (issue.evidence && issue.evidence.length > 0) {
        for (const ev of issue.evidence) {
          const loc = ev.line ? `${ev.file}:${ev.line}` : ev.file;
          lines.push(`| | | \`${loc}\` — "${ev.content.replace(/\|/g, '\\|')}" | | |`);
        }
      }
    }
    lines.push('');
  }

  // Summary
  lines.push('## Summary');
  lines.push('');

  const { errors, warnings, infos } = result.stats;
  const headlineParts: string[] = [];
  if (errors > 0) headlineParts.push(`${errors} ${errors === 1 ? 'error' : 'errors'}`);
  if (warnings > 0) headlineParts.push(`${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`);
  const headline = headlineParts.length > 0 ? headlineParts.join(', ') : 'No issues found';

  lines.push(`- **Issues:** ${headline}`);
  lines.push(`- **Rules checked:** ${result.stats.rulesRun}`);
  lines.push(`- **Files scanned:** ${result.stats.filesChecked}`);
  lines.push(`- **Duration:** ${result.stats.duration}ms`);
  if (infos > 0) {
    lines.push(`- **Notes:** ${infos}`);
  }
  lines.push('');

  return lines.join('\n');
}
