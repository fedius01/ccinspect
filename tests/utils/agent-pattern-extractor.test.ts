import { describe, it, expect } from 'vitest';
import { extractAgentPatterns } from '../../src/utils/agent-pattern-extractor.js';

describe('extractAgentPatterns', () => {
  it('extracts commands from inline code spans', () => {
    const body = 'Run `pytest` to verify.\nAlso try `python -m pytest tests/ -v`.';
    const result = extractAgentPatterns('test-runner', '', body);

    expect(result.commandPatterns).toContain('pytest');
    expect(result.commandPatterns).toContain('python -m pytest tests/ -v');
    expect(result.hasPatterns).toBe(true);
  });

  it('extracts commands from fenced code blocks', () => {
    const body = [
      '## Workflow',
      '```bash',
      'cd backend/',
      'python -m pytest tests/ -v',
      '```',
    ].join('\n');
    const result = extractAgentPatterns('test-runner', '', body);

    // cd is stop-listed, but pytest should be extracted
    expect(result.commandPatterns).toContain('pytest');
    expect(result.commandPatterns).toContain('python -m pytest tests/ -v');
    // cd should NOT appear as a command
    expect(result.commandPatterns).not.toContain('cd');
    // python is too generic alone — filtered
    expect(result.commandPatterns).not.toContain('python');
  });

  it('extracts path prefixes from body text', () => {
    const body = [
      '1. Navigate to `backend/`',
      '2. Run tests in `tests/unit/`',
      '3. Check `src/api/routes.ts`',
    ].join('\n');
    const result = extractAgentPatterns('test-runner', '', body);

    expect(result.pathPrefixes).toContain('backend/');
    expect(result.pathPrefixes).toContain('tests/unit/');
    expect(result.pathPrefixes).toContain('src/api/');
  });

  it('filters stop-listed commands', () => {
    const body = 'Run `cd backend/` then `echo hello`';
    const result = extractAgentPatterns('runner', '', body);

    expect(result.commandPatterns).not.toContain('cd');
    expect(result.commandPatterns).not.toContain('echo');
    // Path should still be extracted
    expect(result.pathPrefixes).toContain('backend/');
  });

  it('returns hasPatterns false when no extractable patterns', () => {
    const body = 'Review code changes for quality and suggest improvements.\nThink carefully about edge cases.';
    const result = extractAgentPatterns('code-reviewer', '', body);

    expect(result.commandPatterns).toEqual([]);
    expect(result.pathPrefixes).toEqual([]);
    expect(result.hasPatterns).toBe(false);
  });

  it('extracts from description code spans', () => {
    const result = extractAgentPatterns('linter', 'Runs `ruff check` on Python files', '');

    expect(result.commandPatterns).toContain('ruff');
    expect(result.commandPatterns).toContain('ruff check');
    expect(result.hasPatterns).toBe(true);
  });

  it('does not extract URLs as path prefixes', () => {
    const body = 'See https://example.com/api/docs for reference.\nAlso check http://localhost:3000/health.';
    const result = extractAgentPatterns('docs', '', body);

    expect(result.pathPrefixes).not.toContain('https://example.com/api/');
    expect(result.pathPrefixes).not.toContain('http://localhost:3000/');
  });

  it('deduplicates command patterns', () => {
    const body = [
      'Run `pytest` inline.',
      '```bash',
      'pytest',
      '```',
    ].join('\n');
    const result = extractAgentPatterns('test-runner', '', body);

    const pytestCount = result.commandPatterns.filter(p => p === 'pytest').length;
    expect(pytestCount).toBe(1);
  });

  it('handles multi-command lines with &&, |, ;', () => {
    const body = 'Run `ruff check . && ruff format .`';
    const result = extractAgentPatterns('linter', '', body);

    expect(result.commandPatterns).toContain('ruff');
    // Full spans with && are split, so we get individual commands
    expect(result.commandPatterns).toContain('ruff check .');
    expect(result.commandPatterns).toContain('ruff format .');
    // Deduplicated — 'ruff' appears once
    const ruffCount = result.commandPatterns.filter(p => p === 'ruff').length;
    expect(ruffCount).toBe(1);
  });

  it('extracts commands for Go and Rust', () => {
    const body = 'Run `cargo test` for Rust tests.\nRun `go test ./...` for Go tests.';
    const result = extractAgentPatterns('test-runner', '', body);

    expect(result.commandPatterns).toContain('cargo');
    expect(result.commandPatterns).toContain('go');
  });

  it('handles empty body gracefully', () => {
    const result = extractAgentPatterns('empty', '', '');

    expect(result.agentName).toBe('empty');
    expect(result.commandPatterns).toEqual([]);
    expect(result.pathPrefixes).toEqual([]);
    expect(result.hasPatterns).toBe(false);
  });

  it('handles body with only URLs', () => {
    const body = 'Check https://docs.pytest.org/en/stable/ for more info.';
    const result = extractAgentPatterns('docs', '', body);

    // Should not pick up URL paths
    expect(result.pathPrefixes).toEqual([]);
  });

  it('skips comment lines in code blocks', () => {
    const body = [
      '```bash',
      '# This is a comment',
      'npm test',
      '```',
    ].join('\n');
    const result = extractAgentPatterns('runner', '', body);

    expect(result.commandPatterns).toContain('npm');
    expect(result.commandPatterns).not.toContain('#');
  });

  it('sets agentName from the name parameter', () => {
    const result = extractAgentPatterns('my-agent', '', 'some body');
    expect(result.agentName).toBe('my-agent');
  });

  it('extracts the full workflow example from the task spec', () => {
    const body = [
      '## Workflow',
      '1. Navigate to `backend/`',
      '2. Run `python -m pytest tests/ -v --tb=short`',
      '3. Analyze results',
    ].join('\n');
    const result = extractAgentPatterns('test-runner', '', body);

    expect(result.commandPatterns).toContain('pytest');
    expect(result.commandPatterns).toContain('python -m pytest tests/ -v --tb=short');
    // python is too generic alone — filtered
    expect(result.commandPatterns).not.toContain('python');
    expect(result.pathPrefixes).toContain('backend/');
    expect(result.pathPrefixes).toContain('tests/');
    expect(result.hasPatterns).toBe(true);
  });

  it('does not extract flags as commands', () => {
    const body = 'Run `--verbose --debug` flags.';
    const result = extractAgentPatterns('runner', '', body);

    // All tokens are flags — no meaningful command
    expect(result.commandPatterns).toEqual([]);
  });

  it('filters generic runtime tokens but keeps full commands', () => {
    const body = 'Run `python -m pytest tests/`';
    const result = extractAgentPatterns('runner', '', body);
    expect(result.commandPatterns).toContain('pytest');
    expect(result.commandPatterns).not.toContain('python');
    // Full command is still kept
    expect(result.commandPatterns.some(p => p.includes('python -m pytest'))).toBe(true);
  });

  it('deduplicates path prefixes', () => {
    const body = [
      'Check `tests/unit/` and also `tests/integration/`.',
      'Run tests in tests/unit/ again.',
    ].join('\n');
    const result = extractAgentPatterns('runner', '', body);

    const testsUnitCount = result.pathPrefixes.filter(p => p === 'tests/unit/').length;
    expect(testsUnitCount).toBe(1);
  });
});
