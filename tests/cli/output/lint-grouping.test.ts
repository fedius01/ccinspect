import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LintResult, LintIssue, LintEvidence, IssueCategory, Severity } from '../../../src/types/index.js';
import { printLintResult } from '../../../src/cli/output/terminal.js';

// ─── Helpers ───

function makeIssue(overrides: Partial<LintIssue> = {}): LintIssue {
  return {
    ruleId: 'test/rule',
    severity: 'warning',
    category: 'rules',
    message: 'Test issue message',
    file: 'test-file.md',
    suggestion: 'Fix the issue',
    autoFixable: false,
    ...overrides,
  };
}

function makeResult(issues: LintIssue[]): LintResult {
  return {
    issues,
    stats: {
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      infos: issues.filter((i) => i.severity === 'info').length,
      rulesRun: 5,
      filesChecked: 3,
      duration: 42,
    },
  };
}

// ─── Tests ───

describe('lint output category grouping', () => {
  let output: string;

  beforeEach(() => {
    output = '';
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output += args.map(String).join(' ') + '\n';
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('groups issues by category with section headers', () => {
    const result = makeResult([
      makeIssue({ category: 'memory', ruleId: 'memory/line-count', message: 'Too many lines' }),
      makeIssue({ category: 'settings', ruleId: 'settings/sandbox', message: 'No sandbox' }),
      makeIssue({ category: 'rules', ruleId: 'rules/dead-globs', message: 'Dead glob' }),
    ]);
    printLintResult(result);

    expect(output).toContain('Memory (1 issue)');
    expect(output).toContain('Settings (1 issue)');
    expect(output).toContain('Rules (1 issue)');
  });

  it('uses plural "issues" for counts > 1', () => {
    const result = makeResult([
      makeIssue({ category: 'memory', ruleId: 'memory/a', message: 'Issue A' }),
      makeIssue({ category: 'memory', ruleId: 'memory/b', message: 'Issue B' }),
    ]);
    printLintResult(result);

    expect(output).toContain('Memory (2 issues)');
  });

  it('sorts issues within each group by severity (error → warning → info)', () => {
    const result = makeResult([
      makeIssue({ category: 'settings', severity: 'info', ruleId: 'settings/info', message: 'Info issue' }),
      makeIssue({ category: 'settings', severity: 'error', ruleId: 'settings/err', message: 'Error issue' }),
      makeIssue({ category: 'settings', severity: 'warning', ruleId: 'settings/warn', message: 'Warning issue' }),
    ]);
    printLintResult(result);

    const errorPos = output.indexOf('Error issue');
    const warningPos = output.indexOf('Warning issue');
    const infoPos = output.indexOf('Info issue');
    expect(errorPos).toBeLessThan(warningPos);
    expect(warningPos).toBeLessThan(infoPos);
  });

  it('renders categories in defined display order', () => {
    const result = makeResult([
      makeIssue({ category: 'git', ruleId: 'git/tracked', message: 'Git issue' }),
      makeIssue({ category: 'memory', ruleId: 'memory/lines', message: 'Memory issue' }),
      makeIssue({ category: 'settings', ruleId: 'settings/sandbox', message: 'Settings issue' }),
    ]);
    printLintResult(result);

    const memoryPos = output.indexOf('Memory (1 issue)');
    const settingsPos = output.indexOf('Settings (1 issue)');
    const gitPos = output.indexOf('Git (1 issue)');
    expect(memoryPos).toBeLessThan(settingsPos);
    expect(settingsPos).toBeLessThan(gitPos);
  });

  it('omits empty category headers', () => {
    const result = makeResult([
      makeIssue({ category: 'memory', ruleId: 'memory/a', message: 'Mem issue' }),
      makeIssue({ category: 'git', ruleId: 'git/a', message: 'Git issue' }),
    ]);
    printLintResult(result);

    expect(output).toContain('Memory (1 issue)');
    expect(output).toContain('Git (1 issue)');
    expect(output).not.toContain('Settings (');
    expect(output).not.toContain('Rules (');
    expect(output).not.toContain('Agents (');
  });

  it('shows "No issues found" for zero issues', () => {
    const result = makeResult([]);
    printLintResult(result);

    expect(output).toContain('No issues found');
    expect(output).not.toContain('Memory');
    expect(output).not.toContain('Settings');
  });

  it('renders unknown categories as fallback', () => {
    const result = makeResult([
      makeIssue({ category: 'unknown-cat' as IssueCategory, ruleId: 'unknown/rule', message: 'Unknown' }),
    ]);
    printLintResult(result);

    expect(output).toContain('unknown-cat (1 issue)');
  });

  it('preserves per-issue rendering (icon, suggestion, rule ID)', () => {
    const result = makeResult([
      makeIssue({
        category: 'memory',
        severity: 'warning',
        ruleId: 'memory/line-count',
        message: 'Too many lines',
        file: 'CLAUDE.md',
        suggestion: 'Trim it down',
      }),
    ]);
    printLintResult(result);

    expect(output).toContain('[memory/line-count]');
    expect(output).toContain('CLAUDE.md');
    expect(output).toContain('Trim it down');
  });

  it('preserves footer summary line', () => {
    const result = makeResult([
      makeIssue({ category: 'memory', severity: 'warning' }),
      makeIssue({ category: 'settings', severity: 'info' }),
    ]);
    printLintResult(result);

    expect(output).toContain('1 warning(s)');
    expect(output).toContain('1 info(s)');
    expect(output).toContain('5 rules checked');
    expect(output).toContain('3 files scanned');
    expect(output).toContain('42ms');
  });
});

// ─── Path shortening tests ───

describe('lint output path shortening', () => {
  let output: string;

  beforeEach(() => {
    output = '';
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output += args.map(String).join(' ') + '\n';
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shortens project-relative file paths', () => {
    const result = makeResult([
      makeIssue({
        category: 'memory',
        file: '/tmp/test-project/CLAUDE.md',
        message: 'Too many lines',
      }),
    ]);
    printLintResult(result, { projectRoot: '/tmp/test-project' });

    expect(output).toContain('CLAUDE.md');
    expect(output).not.toContain('/tmp/test-project/CLAUDE.md');
  });

  it('shortens nested project-relative paths', () => {
    const result = makeResult([
      makeIssue({
        category: 'settings',
        file: '/tmp/test-project/.claude/settings.json',
        message: 'Missing sandbox',
      }),
    ]);
    printLintResult(result, { projectRoot: '/tmp/test-project' });

    expect(output).toContain('.claude/settings.json');
  });

  it('shortens home-dir paths to ~/', () => {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (!home) return; // skip if no HOME

    const result = makeResult([
      makeIssue({
        category: 'agents',
        file: `${home}/.claude/agents/smith.md`,
        message: 'Agent not referenced',
      }),
    ]);
    printLintResult(result, { projectRoot: '/tmp/other-project' });

    expect(output).toContain('~/.claude/agents/smith.md');
    expect(output).not.toContain(home);
  });

  it('shortens evidence file paths', () => {
    const evidence: LintEvidence[] = [
      { file: '/tmp/test-project/CLAUDE.md', line: 43, content: 'matched phrase' },
    ];
    const result = makeResult([
      makeIssue({ category: 'memory', evidence }),
    ]);
    printLintResult(result, { projectRoot: '/tmp/test-project' });

    expect(output).toContain('CLAUDE.md:43');
    expect(output).not.toContain('/tmp/test-project/CLAUDE.md:43');
  });

  it('shortens evidence home-dir paths to ~/', () => {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (!home) return;

    const evidence: LintEvidence[] = [
      { file: `${home}/.claude/settings.json`, content: 'some value' },
    ];
    const result = makeResult([
      makeIssue({ category: 'settings', evidence }),
    ]);
    printLintResult(result, { projectRoot: '/tmp/other-project' });

    expect(output).toContain('~/.claude/settings.json');
    expect(output).not.toContain(home);
  });

  it('does not crash without projectRoot option (uses cwd fallback)', () => {
    const result = makeResult([
      makeIssue({ category: 'memory', file: 'CLAUDE.md', message: 'Test' }),
    ]);

    expect(() => printLintResult(result)).not.toThrow();
    expect(output).toContain('CLAUDE.md');
  });

  it('leaves paths outside project and home unchanged', () => {
    const result = makeResult([
      makeIssue({
        category: 'settings',
        file: '/opt/enterprise/managed-settings.json',
        message: 'Enterprise config',
      }),
    ]);
    printLintResult(result, { projectRoot: '/tmp/test-project' });

    expect(output).toContain('/opt/enterprise/managed-settings.json');
  });

  it('does not modify issue.message text containing paths', () => {
    const result = makeResult([
      makeIssue({
        category: 'memory',
        file: '/tmp/test-project/CLAUDE.md',
        message: 'Variable FOO set at /tmp/test-project/.claude/settings.json shadows another',
      }),
    ]);
    printLintResult(result, { projectRoot: '/tmp/test-project' });

    // File ref should be shortened on header line
    expect(output).toContain('CLAUDE.md');
    // Message body should still contain the full path
    expect(output).toContain('set at /tmp/test-project/.claude/settings.json shadows');
  });
});

// ─── Multi-line layout tests ───

describe('lint output multi-line layout', () => {
  let output: string;

  beforeEach(() => {
    output = '';
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output += args.map(String).join(' ') + '\n';
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders header with file:line and ruleId on line 1', () => {
    const result = makeResult([
      makeIssue({
        category: 'memory',
        file: 'CLAUDE.md',
        line: 39,
        ruleId: 'memory/stale-imports',
        message: 'Broken import',
        suggestion: 'Fix the import',
      }),
    ]);
    printLintResult(result);

    const lines = output.split('\n');
    const headerLine = lines.find((l) => l.includes('[memory/stale-imports]'));
    expect(headerLine).toBeDefined();
    expect(headerLine).toContain('CLAUDE.md:39');
    expect(headerLine).toContain('[memory/stale-imports]');
  });

  it('renders header with file and no line number', () => {
    const result = makeResult([
      makeIssue({
        category: 'settings',
        file: '.claude/settings.json',
        ruleId: 'settings/dangerous-allow',
        message: 'Dangerous allow',
        suggestion: 'Scope it down',
      }),
    ]);
    printLintResult(result);

    const lines = output.split('\n');
    const headerLine = lines.find((l) => l.includes('[settings/dangerous-allow]'));
    expect(headerLine).toBeDefined();
    expect(headerLine).toContain('.claude/settings.json');
    expect(headerLine).not.toContain('.claude/settings.json:');
  });

  it('renders header with just ruleId when no file', () => {
    const result = makeResult([
      makeIssue({
        category: 'settings',
        file: undefined,
        ruleId: 'settings/sandbox-recommended',
        message: 'Sandbox not enabled',
        suggestion: 'Enable sandbox',
      }),
    ]);
    printLintResult(result);

    const lines = output.split('\n');
    const headerLine = lines.find((l) => l.includes('[settings/sandbox-recommended]'));
    expect(headerLine).toBeDefined();
    // Should not have a file path before the ruleId
    expect(headerLine!.indexOf('[settings/sandbox-recommended]')).toBeGreaterThan(0);
  });

  it('renders action line with \u21b3 prefix', () => {
    const result = makeResult([
      makeIssue({
        category: 'memory',
        message: 'Test message',
        suggestion: 'Do the fix',
      }),
    ]);
    printLintResult(result);

    expect(output).toContain('\u21b3 Do the fix');
  });

  it('does not use \u2192 arrow for suggestions', () => {
    const result = makeResult([
      makeIssue({ suggestion: 'Some suggestion' }),
    ]);
    printLintResult(result);

    expect(output).not.toContain('\u2192 Some suggestion');
  });

  it('renders evidence with \u2502 pipe, not Evidence: label', () => {
    const evidence: LintEvidence[] = [
      { file: 'test.md', line: 5, content: 'some content' },
    ];
    const result = makeResult([
      makeIssue({ category: 'rules', evidence }),
    ]);
    printLintResult(result);

    expect(output).toContain('\u2502 test.md:5');
    expect(output).not.toContain('Evidence:');
  });

  it('does not produce wide padding gaps (no 5+ consecutive spaces in issue lines)', () => {
    const result = makeResult([
      makeIssue({
        category: 'memory',
        file: 'CLAUDE.md',
        ruleId: 'memory/line-count',
        message: 'Short msg',
        suggestion: 'Fix it',
      }),
      makeIssue({
        category: 'memory',
        file: 'CLAUDE.md',
        ruleId: 'memory/token-budget',
        message: 'A much longer message that would cause padding in the old layout',
        suggestion: 'Reduce tokens',
      }),
    ]);
    printLintResult(result);

    // Get lines between category header and footer
    const lines = output.split('\n');
    const issueLines = lines.filter((l) =>
      l.trim().length > 0 &&
      !l.includes('ccinspect lint') &&
      !l.includes('Memory (') &&
      !l.includes('---') &&
      !l.includes('rules checked'),
    );

    // Message lines (4-space indent) should not have 5+ consecutive spaces
    const messageLines = issueLines.filter((l) => l.startsWith('    ') && !l.includes('\u2502') && !l.includes('\u21b3'));
    for (const line of messageLines) {
      expect(line).not.toMatch(/ {4} {5,}/);
    }
  });
});

// ─── Collapsed group rendering tests ───

describe('lint output collapsed groups', () => {
  let output: string;

  beforeEach(() => {
    output = '';
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output += args.map(String).join(' ') + '\n';
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('collapses deny-sensitive-paths into one block with path names', () => {
    const result = makeResult([
      makeIssue({
        category: 'settings',
        severity: 'info',
        ruleId: 'settings/deny-sensitive-paths',
        message: 'No deny rule protects SSH credentials. Consider adding: Read(./.ssh/**), Write(./.ssh/**)',
        suggestion: 'Add to your settings.json deny list',
      }),
      makeIssue({
        category: 'settings',
        severity: 'info',
        ruleId: 'settings/deny-sensitive-paths',
        message: 'No deny rule protects AWS credentials. Consider adding: Read(./.aws/**), Write(./.aws/**)',
        suggestion: 'Add to your settings.json deny list',
      }),
      makeIssue({
        category: 'settings',
        severity: 'info',
        ruleId: 'settings/deny-sensitive-paths',
        message: 'No deny rule protects .gitignore files from modification. Consider adding: Write(**/.gitignore)',
        suggestion: 'Add to your settings.json deny list',
      }),
      makeIssue({
        category: 'settings',
        severity: 'info',
        ruleId: 'settings/deny-sensitive-paths',
        message: 'No deny rule protects .npmrc from modification. Consider adding: Write(./.npmrc)',
        suggestion: 'Add to your settings.json deny list',
      }),
    ]);
    printLintResult(result);

    // Should show collapsed count
    expect(output).toContain('4 sensitive paths unprotected');
    // All names extracted cleanly
    expect(output).toContain('SSH credentials');
    expect(output).toContain('AWS credentials');
    expect(output).toContain('.gitignore files from modification');
    expect(output).toContain('.npmrc from modification');
    // Should show the ruleId once
    expect(output).toContain('[settings/deny-sensitive-paths]');
    // Should NOT show individual messages
    expect(output).not.toContain('No deny rule protects SSH');
    // Category header should show original count
    expect(output).toContain('Settings (4 issues)');
  });

  it('collapses todo-fixme into one block with line numbers', () => {
    const result = makeResult([
      makeIssue({
        category: 'memory',
        severity: 'info',
        ruleId: 'memory/todo-fixme',
        file: 'CLAUDE.md',
        line: 103,
        message: 'CLAUDE.md line 103: Contains "TODO" marker',
        suggestion: 'Resolve the TODO',
      }),
      makeIssue({
        category: 'memory',
        severity: 'info',
        ruleId: 'memory/todo-fixme',
        file: 'CLAUDE.md',
        line: 107,
        message: 'CLAUDE.md line 107: Contains "FIXME" marker',
        suggestion: 'Resolve the TODO',
      }),
    ]);
    printLintResult(result);

    expect(output).toContain('2 stale TODO/FIXME markers');
    expect(output).toContain('lines 103, 107');
    expect(output).toContain('[memory/todo-fixme]');
  });

  it('collapses generic-instructions with quoted text per line', () => {
    const result = makeResult([
      makeIssue({
        category: 'memory',
        severity: 'warning',
        ruleId: 'memory/generic-instructions',
        file: 'CLAUDE.md',
        line: 43,
        message: 'Generic instruction found in CLAUDE.md at line 43: "Follow best practices"',
        suggestion: 'Replace with specific guidance',
      }),
      makeIssue({
        category: 'memory',
        severity: 'warning',
        ruleId: 'memory/generic-instructions',
        file: 'CLAUDE.md',
        line: 46,
        message: 'Generic instruction found in CLAUDE.md at line 46: "Ensure code quality"',
        suggestion: 'Replace with specific guidance',
      }),
    ]);
    printLintResult(result);

    expect(output).toContain('2 generic instructions found');
    expect(output).toContain('line 43: "Follow best practices"');
    expect(output).toContain('line 46: "Ensure code quality"');
    expect(output).toContain('[memory/generic-instructions]');
  });

  it('collapses dead-globs with file → glob format', () => {
    const result = makeResult([
      makeIssue({
        category: 'rules',
        severity: 'warning',
        ruleId: 'rules-dir/dead-globs',
        file: '.claude/rules/placeholder.md',
        message: 'Rule file has path globs that match no files',
        suggestion: 'Remove or update paths',
        evidence: [{ file: '.claude/rules/placeholder.md', content: 'glob "lib/**" matched 0 files' }],
      }),
      makeIssue({
        category: 'rules',
        severity: 'warning',
        ruleId: 'rules-dir/dead-globs',
        file: '.claude/rules/python.md',
        message: 'Rule file has path globs that match no files',
        suggestion: 'Remove or update paths',
        evidence: [{ file: '.claude/rules/python.md', content: 'glob "backend/**/*.py" matched 0 files' }],
      }),
    ]);
    printLintResult(result);

    expect(output).toContain('2 rule files have dead globs');
    expect(output).toContain('placeholder.md');
    expect(output).toContain('lib/**');
    expect(output).toContain('python.md');
    expect(output).toContain('backend/**/*.py');
    expect(output).toContain('[rules-dir/dead-globs]');
  });

  it('collapses overlapping-rules with pair format', () => {
    const result = makeResult([
      makeIssue({
        category: 'rules',
        severity: 'info',
        ruleId: 'rules-dir/overlapping-rules',
        file: '.claude/rules/formatting.md',
        message: 'Rules ".claude/rules/formatting.md" and ".claude/rules/linting.md" have overlapping scope.',
        suggestion: 'Narrow globs',
      }),
      makeIssue({
        category: 'rules',
        severity: 'info',
        ruleId: 'rules-dir/overlapping-rules',
        file: '.claude/rules/formatting.md',
        message: 'Rules ".claude/rules/formatting.md" and ".claude/rules/typescript.md" have overlapping scope.',
        suggestion: 'Narrow globs',
      }),
    ]);
    printLintResult(result);

    expect(output).toContain('2 rule scope overlaps detected');
    expect(output).toContain('formatting.md');
    expect(output).toContain('linting.md');
    expect(output).toContain('typescript.md');
    expect(output).toContain('[rules-dir/overlapping-rules]');
  });

  it('collapses dangerous-allow with pattern details', () => {
    const result = makeResult([
      makeIssue({
        category: 'settings',
        severity: 'warning',
        ruleId: 'settings/dangerous-allow',
        file: '.claude/settings.json',
        message: 'Dangerous allow pattern "Bash" grants unrestricted shell access. Consider scoping.',
        suggestion: 'Scope: Bash(npm run *)',
      }),
      makeIssue({
        category: 'settings',
        severity: 'warning',
        ruleId: 'settings/dangerous-allow',
        file: '.claude/settings.json',
        message: 'Dangerous allow pattern "Edit(*)" allows editing any file. Consider scoping.',
        suggestion: 'Scope: Edit(src/**)',
      }),
    ]);
    printLintResult(result);

    expect(output).toContain('2 dangerous allow patterns');
    expect(output).toContain('"Bash"');
    expect(output).toContain('"Edit(*)"');
    expect(output).toContain('[settings/dangerous-allow]');
  });

  it('collapses orphan-agent with agent names', () => {
    const result = makeResult([
      makeIssue({
        category: 'agents',
        severity: 'info',
        ruleId: 'agents/orphan-agent',
        file: '.claude/agents/architect.md',
        message: 'Agent "architect" is not referenced by any other config.',
        suggestion: 'Remove if unused',
      }),
      makeIssue({
        category: 'agents',
        severity: 'info',
        ruleId: 'agents/orphan-agent',
        file: '.claude/agents/helper.md',
        message: 'Agent "helper" is not referenced by any other config.',
        suggestion: 'Remove if unused',
      }),
    ]);
    printLintResult(result);

    expect(output).toContain('2 agents not referenced');
    expect(output).toContain('architect');
    expect(output).toContain('helper');
    expect(output).toContain('[agents/orphan-agent]');
  });

  it('does not collapse when only 1 issue for a collapsible rule', () => {
    const result = makeResult([
      makeIssue({
        category: 'settings',
        severity: 'info',
        ruleId: 'settings/deny-sensitive-paths',
        message: 'No deny rule protects SSH credentials from access.',
        suggestion: 'Add deny patterns',
      }),
    ]);
    printLintResult(result);

    // Should render individually — no collapsed count
    expect(output).not.toContain('sensitive paths unprotected');
    expect(output).toContain('No deny rule protects SSH');
  });

  it('does not collapse non-collapsible rules with 2+ issues', () => {
    const result = makeResult([
      makeIssue({
        category: 'memory',
        severity: 'warning',
        ruleId: 'memory/line-count',
        message: 'File A too long',
        suggestion: 'Trim it',
      }),
      makeIssue({
        category: 'memory',
        severity: 'warning',
        ruleId: 'memory/line-count',
        message: 'File B too long',
        suggestion: 'Trim it',
      }),
      makeIssue({
        category: 'memory',
        severity: 'warning',
        ruleId: 'memory/line-count',
        message: 'File C too long',
        suggestion: 'Trim it',
      }),
    ]);
    printLintResult(result);

    // Each issue rendered individually
    expect(output).toContain('File A too long');
    expect(output).toContain('File B too long');
    expect(output).toContain('File C too long');
    // No collapsed summary line (the "3 issues" in category header is fine)
    expect(output).not.toContain('    3 issues');
  });

  it('uses highest severity icon for mixed-severity collapsed group', () => {
    const result = makeResult([
      makeIssue({
        category: 'memory',
        severity: 'info',
        ruleId: 'memory/todo-fixme',
        file: 'CLAUDE.md',
        line: 10,
        message: 'TODO marker found',
        suggestion: 'Resolve',
      }),
      makeIssue({
        category: 'memory',
        severity: 'warning' as Severity,
        ruleId: 'memory/todo-fixme',
        file: 'CLAUDE.md',
        line: 20,
        message: 'FIXME marker found',
        suggestion: 'Resolve',
      }),
    ]);
    printLintResult(result);

    // The warning icon (⚠) should appear, not just the info icon (ℹ)
    expect(output).toContain('\u26a0'); // ⚠ warning icon
  });

  it('preserves category header with original issue count, not collapsed count', () => {
    const result = makeResult([
      makeIssue({
        category: 'settings',
        severity: 'info',
        ruleId: 'settings/deny-sensitive-paths',
        message: 'No deny rule protects SSH credentials from access.',
        suggestion: 'Add deny',
      }),
      makeIssue({
        category: 'settings',
        severity: 'info',
        ruleId: 'settings/deny-sensitive-paths',
        message: 'No deny rule protects AWS credentials from access.',
        suggestion: 'Add deny',
      }),
      makeIssue({
        category: 'settings',
        severity: 'info',
        ruleId: 'settings/deny-sensitive-paths',
        message: 'No deny rule protects GCloud config from access.',
        suggestion: 'Add deny',
      }),
      makeIssue({
        category: 'settings',
        severity: 'warning',
        ruleId: 'settings/sandbox-recommended',
        message: 'Sandbox not enabled',
        suggestion: 'Enable sandbox',
      }),
    ]);
    printLintResult(result);

    // 4 issues total in settings, even though 3 are collapsed into 1 block
    expect(output).toContain('Settings (4 issues)');
  });

  it('renders collapsed and individual issues in same category', () => {
    const result = makeResult([
      makeIssue({
        category: 'settings',
        severity: 'warning',
        ruleId: 'settings/sandbox-recommended',
        message: 'Sandbox not enabled',
        suggestion: 'Enable sandbox',
      }),
      makeIssue({
        category: 'settings',
        severity: 'info',
        ruleId: 'settings/deny-sensitive-paths',
        message: 'No deny rule protects SSH credentials from access.',
        suggestion: 'Add deny',
      }),
      makeIssue({
        category: 'settings',
        severity: 'info',
        ruleId: 'settings/deny-sensitive-paths',
        message: 'No deny rule protects AWS credentials from access.',
        suggestion: 'Add deny',
      }),
    ]);
    printLintResult(result);

    // Individual issue rendered normally
    expect(output).toContain('Sandbox not enabled');
    // Collapsed group rendered
    expect(output).toContain('2 sensitive paths unprotected');
  });

  it('uses generic fallback for collapsible rules with unparseable messages', () => {
    const result = makeResult([
      makeIssue({
        category: 'settings',
        severity: 'info',
        ruleId: 'settings/deny-sensitive-paths',
        message: 'Some unexpected message format',
        suggestion: 'Fix it',
      }),
      makeIssue({
        category: 'settings',
        severity: 'info',
        ruleId: 'settings/deny-sensitive-paths',
        message: 'Another unexpected message format',
        suggestion: 'Fix it',
      }),
    ]);
    // Should not crash
    expect(() => printLintResult(result)).not.toThrow();
    // Should still show count
    expect(output).toContain('2 sensitive paths unprotected');
  });

  it('footer shows most-affected files line unchanged by collapsing', () => {
    const result = makeResult([
      makeIssue({
        category: 'settings',
        severity: 'warning',
        ruleId: 'settings/dangerous-allow',
        file: '.claude/settings.json',
        message: 'Dangerous allow pattern "Bash".',
        suggestion: 'Scope it',
      }),
      makeIssue({
        category: 'settings',
        severity: 'warning',
        ruleId: 'settings/dangerous-allow',
        file: '.claude/settings.json',
        message: 'Dangerous allow pattern "Edit(*)".',
        suggestion: 'Scope it',
      }),
    ]);
    printLintResult(result);

    expect(output).toContain('Most affected: .claude/settings.json (2)');
  });

  it('collapsed groups always show their action line', () => {
    const result = makeResult([
      makeIssue({
        category: 'memory',
        severity: 'info',
        ruleId: 'memory/todo-fixme',
        file: 'CLAUDE.md',
        line: 10,
        message: 'CLAUDE.md line 10: Contains "TODO" marker',
        suggestion: 'Resolve the TODO',
      }),
      makeIssue({
        category: 'memory',
        severity: 'info',
        ruleId: 'memory/todo-fixme',
        file: 'CLAUDE.md',
        line: 20,
        message: 'CLAUDE.md line 20: Contains "FIXME" marker',
        suggestion: 'Resolve the TODO',
      }),
    ]);
    printLintResult(result);

    // Collapsed group should always show its custom action line
    expect(output).toContain('\u21b3 Resolve or remove');
  });

  it('footer summary counts are unchanged by collapsing', () => {
    const result = makeResult([
      makeIssue({
        category: 'settings',
        severity: 'warning',
        ruleId: 'settings/dangerous-allow',
        file: '.claude/settings.json',
        message: 'Dangerous allow pattern "Bash" grants unrestricted shell access.',
        suggestion: 'Scope it',
      }),
      makeIssue({
        category: 'settings',
        severity: 'warning',
        ruleId: 'settings/dangerous-allow',
        file: '.claude/settings.json',
        message: 'Dangerous allow pattern "Edit(*)" allows editing any file.',
        suggestion: 'Scope it',
      }),
      makeIssue({
        category: 'memory',
        severity: 'info',
        ruleId: 'memory/todo-fixme',
        file: 'CLAUDE.md',
        line: 10,
        message: 'TODO marker found',
        suggestion: 'Resolve',
      }),
      makeIssue({
        category: 'memory',
        severity: 'info',
        ruleId: 'memory/todo-fixme',
        file: 'CLAUDE.md',
        line: 20,
        message: 'FIXME marker found',
        suggestion: 'Resolve',
      }),
    ]);
    printLintResult(result);

    // Footer should show original counts, not collapsed counts
    expect(output).toContain('2 warning(s)');
    expect(output).toContain('2 info(s)');
  });
});

// ─── Most affected files tests ───

describe('lint output most affected files', () => {
  let output: string;

  beforeEach(() => {
    output = '';
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output += args.map(String).join(' ') + '\n';
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows top 3 files sorted by issue count', () => {
    const result = makeResult([
      makeIssue({ file: 'CLAUDE.md', category: 'memory', message: 'A' }),
      makeIssue({ file: 'CLAUDE.md', category: 'memory', message: 'B' }),
      makeIssue({ file: 'CLAUDE.md', category: 'memory', message: 'C' }),
      makeIssue({ file: 'CLAUDE.md', category: 'memory', message: 'D' }),
      makeIssue({ file: '.claude/settings.json', category: 'settings', message: 'E' }),
      makeIssue({ file: '.claude/settings.json', category: 'settings', message: 'F' }),
      makeIssue({ file: '.claude/settings.json', category: 'settings', message: 'G' }),
      makeIssue({ file: '.mcp.json', category: 'mcp' as IssueCategory, message: 'H' }),
      makeIssue({ file: '.mcp.json', category: 'mcp' as IssueCategory, message: 'I' }),
      makeIssue({ file: 'other.md', category: 'memory', message: 'J' }),
    ]);
    printLintResult(result);

    expect(output).toContain('Most affected: CLAUDE.md (4), .claude/settings.json (3), .mcp.json (2)');
  });

  it('aggregates .claude/rules/* files into one entry', () => {
    const result = makeResult([
      makeIssue({ file: '.claude/rules/formatting.md', category: 'rules', message: 'A' }),
      makeIssue({ file: '.claude/rules/linting.md', category: 'rules', message: 'B' }),
      makeIssue({ file: '.claude/rules/testing.md', category: 'rules', message: 'C' }),
      makeIssue({ file: 'CLAUDE.md', category: 'memory', message: 'D' }),
    ]);
    printLintResult(result);

    expect(output).toContain('.claude/rules/* (3)');
    expect(output).not.toContain('formatting.md (');
    expect(output).not.toContain('linting.md (');
  });

  it('aggregates .claude/agents/* files into one entry', () => {
    const result = makeResult([
      makeIssue({ file: '.claude/agents/reviewer.md', category: 'agents', message: 'A' }),
      makeIssue({ file: '.claude/agents/architect.md', category: 'agents', message: 'B' }),
      makeIssue({ file: 'CLAUDE.md', category: 'memory', message: 'C' }),
    ]);
    printLintResult(result);

    expect(output).toContain('.claude/agents/* (2)');
  });

  it('does not show "Most affected" when no issues have file field', () => {
    const result = makeResult([
      makeIssue({ file: undefined, category: 'settings', message: 'No sandbox' }),
      makeIssue({ file: undefined, category: 'settings', message: 'No deny' }),
    ]);
    printLintResult(result);

    expect(output).not.toContain('Most affected');
  });

  it('does not show "Most affected" when zero issues', () => {
    const result = makeResult([]);
    printLintResult(result);

    expect(output).not.toContain('Most affected');
  });
});

// ─── Verbose mode tests ───

describe('lint output verbose mode', () => {
  let output: string;

  beforeEach(() => {
    output = '';
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output += args.map(String).join(' ') + '\n';
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('expands collapsed groups into individual issues', () => {
    const result = makeResult([
      makeIssue({
        category: 'memory',
        severity: 'info',
        ruleId: 'memory/todo-fixme',
        file: 'CLAUDE.md',
        line: 103,
        message: 'CLAUDE.md line 103: Contains "TODO" marker',
        suggestion: 'Resolve the TODO',
      }),
      makeIssue({
        category: 'memory',
        severity: 'info',
        ruleId: 'memory/todo-fixme',
        file: 'CLAUDE.md',
        line: 107,
        message: 'CLAUDE.md line 107: Contains "FIXME" marker',
        suggestion: 'Resolve the TODO',
      }),
      makeIssue({
        category: 'memory',
        severity: 'info',
        ruleId: 'memory/todo-fixme',
        file: 'CLAUDE.md',
        line: 200,
        message: 'CLAUDE.md line 200: Contains "TODO" marker',
        suggestion: 'Resolve the TODO',
      }),
    ]);

    // Default: collapsed into one block
    printLintResult(result);
    expect(output).toContain('3 stale TODO/FIXME markers');

    // Verbose: each issue rendered individually
    output = '';
    printLintResult(result, { verbose: true });
    expect(output).not.toContain('3 stale TODO/FIXME markers');
    expect(output).toContain('CLAUDE.md line 103: Contains "TODO" marker');
    expect(output).toContain('CLAUDE.md line 107: Contains "FIXME" marker');
    expect(output).toContain('CLAUDE.md line 200: Contains "TODO" marker');
  });

  it('shows full evidence without truncation', () => {
    const longContent = 'x'.repeat(200);
    const evidence: LintEvidence[] = [
      { file: 'file.md', line: 1, content: longContent },
    ];
    const result = makeResult([makeIssue({ evidence })]);

    // Default: truncated at 120 chars
    printLintResult(result);
    expect(output).toContain('x'.repeat(120) + '\u2026');
    expect(output).not.toContain('x'.repeat(200) + '"');

    // Verbose: full content
    output = '';
    printLintResult(result, { verbose: true });
    expect(output).toContain('x'.repeat(200));
    expect(output).not.toContain('\u2026');
  });

  it('shows verbose indicator in header', () => {
    const result = makeResult([]);
    printLintResult(result, { verbose: true });

    expect(output).toContain('(verbose)');
  });

  it('does not show verbose indicator by default', () => {
    const result = makeResult([]);
    printLintResult(result);

    expect(output).not.toContain('(verbose)');
  });

  it('suppresses redundant suggestions (substring match)', () => {
    const result = makeResult([
      makeIssue({
        category: 'settings',
        ruleId: 'settings/dangerous-allow',
        file: '.claude/settings.json',
        message: 'Dangerous allow pattern "Bash" grants unrestricted shell access. Consider scoping: Bash(npm run *), Bash(git *)',
        suggestion: 'Consider scoping: Bash(npm run *), Bash(git *)',
      }),
    ]);
    printLintResult(result);

    // Suggestion is a substring of message — should be suppressed
    expect(output).toContain('Dangerous allow pattern');
    expect(output).not.toContain('\u21b3');
  });

  it('suppresses redundant suggestions (high word overlap)', () => {
    const result = makeResult([
      makeIssue({
        category: 'rules',
        ruleId: 'rules-dir/dead-globs',
        file: '.claude/rules/placeholder.md',
        message: 'Rule file .claude/rules/placeholder.md has path globs that match no files in the project.',
        suggestion: 'Rule file has path globs that match no files in the project. Consider removing or updating the paths.',
      }),
    ]);
    printLintResult(result);

    expect(output).toContain('has path globs that match no files');
    expect(output).not.toContain('\u21b3');
  });

  it('keeps valuable suggestions with unique content', () => {
    const result = makeResult([
      makeIssue({
        category: 'settings',
        ruleId: 'settings/sandbox-recommended',
        message: 'Sandbox is not enabled. Without sandbox, deny rules only block built-in tools.',
        suggestion: 'Enable sandbox in your settings: { "sandbox": { "enabled": true } }',
      }),
    ]);
    printLintResult(result);

    expect(output).toContain('\u21b3 Enable sandbox');
  });

  it('shows redundant suggestions in verbose mode', () => {
    const result = makeResult([
      makeIssue({
        category: 'settings',
        ruleId: 'settings/dangerous-allow',
        file: '.claude/settings.json',
        message: 'Dangerous allow pattern "Bash" grants unrestricted shell access. Consider scoping: Bash(npm run *)',
        suggestion: 'Consider scoping: Bash(npm run *)',
      }),
    ]);

    // Default: suppressed
    printLintResult(result);
    expect(output).not.toContain('\u21b3');

    // Verbose: shown despite redundancy
    output = '';
    printLintResult(result, { verbose: true });
    expect(output).toContain('\u21b3 Consider scoping');
  });

  it('collapses large-rule-file into one block with token counts', () => {
    const result = makeResult([
      makeIssue({
        category: 'rules',
        severity: 'info',
        ruleId: 'rules-dir/large-rule-file',
        file: '.claude/rules/architecture.md',
        message: 'Rule file .claude/rules/architecture.md is 4,572 tokens. Large rule files consume significant context on every matching prompt.',
        suggestion: 'Consider splitting into smaller, more focused rule files with narrower path scopes.',
      }),
      makeIssue({
        category: 'rules',
        severity: 'info',
        ruleId: 'rules-dir/large-rule-file',
        file: '.claude/rules/backend.md',
        message: 'Rule file .claude/rules/backend.md is 3,444 tokens. Large rule files consume significant context on every matching prompt.',
        suggestion: 'Consider splitting into smaller, more focused rule files with narrower path scopes.',
      }),
      makeIssue({
        category: 'rules',
        severity: 'info',
        ruleId: 'rules-dir/large-rule-file',
        file: '.claude/rules/tools-and-plugins.md',
        message: 'Rule file .claude/rules/tools-and-plugins.md is 3,390 tokens. Large rule files consume significant context on every matching prompt.',
        suggestion: 'Consider splitting into smaller, more focused rule files with narrower path scopes.',
      }),
    ]);
    printLintResult(result);

    expect(output).toContain('3 large rule files');
    expect(output).toContain('architecture.md');
    expect(output).toContain('4,572 tokens');
    expect(output).toContain('backend.md');
    expect(output).toContain('3,444 tokens');
    expect(output).toContain('tools-and-plugins.md');
    expect(output).toContain('3,390 tokens');
    expect(output).toContain('[rules-dir/large-rule-file]');
    expect(output).toContain('Split into smaller rules');
    // Should NOT show individual messages
    expect(output).not.toContain('Large rule files consume');
  });

  it('does not collapse single large-rule-file issue', () => {
    const result = makeResult([
      makeIssue({
        category: 'rules',
        severity: 'info',
        ruleId: 'rules-dir/large-rule-file',
        file: '.claude/rules/architecture.md',
        message: 'Rule file .claude/rules/architecture.md is 4,572 tokens. Large rule files consume significant context on every matching prompt.',
        suggestion: 'Consider splitting into smaller, more focused rule files with narrower path scopes.',
      }),
    ]);
    printLintResult(result);

    // Single issue renders individually — shows the full message
    expect(output).toContain('Large rule files consume');
    expect(output).not.toContain('large rule files');
  });

  it('collapses agents/frontmatter-present into one block', () => {
    const result = makeResult([
      makeIssue({
        category: 'agents',
        severity: 'warning',
        ruleId: 'agents/frontmatter-present',
        file: '.claude/agents/legacy-helper.md',
        message: 'Agent file .claude/agents/legacy-helper.md has no YAML frontmatter.',
        suggestion: 'Add YAML frontmatter with at minimum "name" and "description". Optional fields include "tools", "model", and "permissionMode".',
      }),
      makeIssue({
        category: 'agents',
        severity: 'warning',
        ruleId: 'agents/frontmatter-present',
        file: '.claude/agents/smith.md',
        message: 'Agent file .claude/agents/smith.md has no YAML frontmatter.',
        suggestion: 'Add YAML frontmatter with at minimum "name" and "description". Optional fields include "tools", "model", and "permissionMode".',
      }),
    ]);
    printLintResult(result);

    expect(output).toContain('2 agent files have no YAML frontmatter');
    expect(output).toContain('legacy-helper.md');
    expect(output).toContain('smith.md');
    expect(output).toContain('[agents/frontmatter-present]');
    expect(output).toContain('permissionMode');
    // Should NOT show individual messages
    expect(output).not.toContain('Agent file .claude/agents/legacy-helper.md has no');
  });

  it('collapses skills/frontmatter-present with "skill" label', () => {
    const result = makeResult([
      makeIssue({
        category: 'skills',
        severity: 'warning',
        ruleId: 'skills/frontmatter-present',
        file: '.claude/skills/review/SKILL.md',
        message: 'Skill file .claude/skills/review/SKILL.md has no YAML frontmatter.',
        suggestion: 'Add frontmatter.',
      }),
      makeIssue({
        category: 'skills',
        severity: 'warning',
        ruleId: 'skills/frontmatter-present',
        file: '.claude/skills/deploy/SKILL.md',
        message: 'Skill file .claude/skills/deploy/SKILL.md has no YAML frontmatter.',
        suggestion: 'Add frontmatter.',
      }),
    ]);
    printLintResult(result);

    expect(output).toContain('2 skill files have no YAML frontmatter');
    expect(output).toContain('SKILL.md');
    expect(output).toContain('[skills/frontmatter-present]');
  });

  it('preserves footer summary and most-affected in verbose mode', () => {
    const result = makeResult([
      makeIssue({
        category: 'settings',
        severity: 'warning',
        ruleId: 'settings/dangerous-allow',
        file: '.claude/settings.json',
        message: 'Dangerous allow pattern "Bash".',
        suggestion: 'Scope it',
      }),
      makeIssue({
        category: 'settings',
        severity: 'warning',
        ruleId: 'settings/dangerous-allow',
        file: '.claude/settings.json',
        message: 'Dangerous allow pattern "Edit(*)".',
        suggestion: 'Scope it',
      }),
    ]);
    printLintResult(result, { verbose: true });

    expect(output).toContain('2 warning(s)');
    expect(output).toContain('5 rules checked');
    expect(output).toContain('Most affected: .claude/settings.json (2)');
  });
});
