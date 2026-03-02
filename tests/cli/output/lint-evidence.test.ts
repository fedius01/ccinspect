import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LintResult, LintIssue, LintEvidence } from '../../../src/types/index.js';
import { printLintResult } from '../../../src/cli/output/terminal.js';
import { printLintResultJson } from '../../../src/cli/output/json.js';
import { printLintResultMarkdown } from '../../../src/cli/output/markdown.js';

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
      rulesRun: 1,
      filesChecked: 1,
      duration: 10,
    },
  };
}

// ─── Terminal formatter ───

describe('terminal formatter evidence', () => {
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

  it('renders evidence lines when present', () => {
    const evidence: LintEvidence[] = [
      { file: 'architecture.md', line: 12, content: 'use tabs for indentation in all files' },
      { file: 'frontend.md', line: 5, content: 'use spaces for consistent formatting' },
    ];
    const result = makeResult([makeIssue({ evidence })]);
    printLintResult(result);

    expect(output).toContain('Evidence:');
    expect(output).toContain('architecture.md:12');
    expect(output).toContain('"use tabs for indentation in all files"');
    expect(output).toContain('frontend.md:5');
    expect(output).toContain('"use spaces for consistent formatting"');
  });

  it('does not render Evidence label when no evidence', () => {
    const result = makeResult([makeIssue()]);
    printLintResult(result);

    expect(output).not.toContain('Evidence:');
  });

  it('does not render Evidence label when evidence is empty array', () => {
    const result = makeResult([makeIssue({ evidence: [] })]);
    printLintResult(result);

    expect(output).not.toContain('Evidence:');
  });

  it('renders evidence without line number', () => {
    const evidence: LintEvidence[] = [
      { file: 'config.json', content: 'some value' },
    ];
    const result = makeResult([makeIssue({ evidence })]);
    printLintResult(result);

    expect(output).toContain('Evidence:');
    expect(output).toContain('config.json');
    expect(output).not.toContain('config.json:');
    expect(output).toContain('"some value"');
  });

  it('truncates long content at 120 characters', () => {
    const longContent = 'x'.repeat(150);
    const evidence: LintEvidence[] = [
      { file: 'file.md', line: 1, content: longContent },
    ];
    const result = makeResult([makeIssue({ evidence })]);
    printLintResult(result);

    // Should contain truncated version with ellipsis
    expect(output).toContain('x'.repeat(120) + '\u2026');
    // Should NOT contain the full 150 chars untruncated
    expect(output).not.toContain('x'.repeat(150) + '"');
  });

  it('does not truncate content at exactly 120 characters', () => {
    const exactContent = 'y'.repeat(120);
    const evidence: LintEvidence[] = [
      { file: 'file.md', line: 1, content: exactContent },
    ];
    const result = makeResult([makeIssue({ evidence })]);
    printLintResult(result);

    expect(output).toContain('"' + exactContent + '"');
    expect(output).not.toContain('\u2026');
  });

  it('renders single evidence item', () => {
    const evidence: LintEvidence[] = [
      { file: 'rules/no-tabs.md', line: 3, content: 'never use tabs' },
    ];
    const result = makeResult([makeIssue({ evidence })]);
    printLintResult(result);

    expect(output).toContain('Evidence:');
    expect(output).toContain('rules/no-tabs.md:3');
  });
});

// ─── JSON formatter ───

describe('json formatter evidence', () => {
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

  it('includes evidence array in JSON output', () => {
    const evidence: LintEvidence[] = [
      { file: 'a.md', line: 1, content: 'foo' },
      { file: 'b.md', content: 'bar' },
    ];
    const result = makeResult([makeIssue({ evidence })]);
    printLintResultJson(result);

    const parsed = JSON.parse(output);
    expect(parsed.issues[0].evidence).toHaveLength(2);
    expect(parsed.issues[0].evidence[0]).toEqual({ file: 'a.md', line: 1, content: 'foo' });
    expect(parsed.issues[0].evidence[1]).toEqual({ file: 'b.md', content: 'bar' });
  });

  it('omits evidence field when undefined', () => {
    const result = makeResult([makeIssue()]);
    printLintResultJson(result);

    const parsed = JSON.parse(output);
    expect(parsed.issues[0]).not.toHaveProperty('evidence');
  });
});

// ─── Markdown formatter ───

describe('markdown formatter evidence', () => {
  it('includes evidence rows in markdown output', () => {
    const evidence: LintEvidence[] = [
      { file: 'arch.md', line: 12, content: 'use tabs everywhere' },
      { file: 'style.md', line: 5, content: 'use spaces always' },
    ];
    const result = makeResult([makeIssue({ evidence })]);
    const md = printLintResultMarkdown(result);

    expect(md).toContain('`arch.md:12`');
    expect(md).toContain('"use tabs everywhere"');
    expect(md).toContain('`style.md:5`');
    expect(md).toContain('"use spaces always"');
  });

  it('does not include evidence rows when no evidence', () => {
    const result = makeResult([makeIssue()]);
    const md = printLintResultMarkdown(result);

    // Should have the issue row but no evidence sub-rows
    expect(md).toContain('test/rule');
    // Count table rows (excluding header/separator)
    const tableRows = md.split('\n').filter((l) => l.startsWith('|'));
    // Header + separator + 1 issue row = 3 rows
    expect(tableRows).toHaveLength(3);
  });

  it('does not include evidence rows when evidence is empty', () => {
    const result = makeResult([makeIssue({ evidence: [] })]);
    const md = printLintResultMarkdown(result);

    const tableRows = md.split('\n').filter((l) => l.startsWith('|'));
    expect(tableRows).toHaveLength(3);
  });

  it('renders evidence without line number', () => {
    const evidence: LintEvidence[] = [
      { file: 'settings.json', content: 'some config value' },
    ];
    const result = makeResult([makeIssue({ evidence })]);
    const md = printLintResultMarkdown(result);

    expect(md).toContain('`settings.json`');
    expect(md).toContain('"some config value"');
  });

  it('escapes pipe characters in evidence content', () => {
    const evidence: LintEvidence[] = [
      { file: 'test.md', line: 1, content: 'use | as separator' },
    ];
    const result = makeResult([makeIssue({ evidence })]);
    const md = printLintResultMarkdown(result);

    expect(md).toContain('use \\| as separator');
  });
});
