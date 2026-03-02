import { describe, it, expect } from 'vitest';
import { sanitizeMermaidId, escapeMermaidLabel } from '../../src/utils/graph-helpers.js';

describe('sanitizeMermaidId', () => {
  it('replaces special characters with underscores and collapses them', () => {
    const result = sanitizeMermaidId('agent:.claude/agents/reviewer.md');
    // `:` and `.` both become `_`, then consecutive underscores collapse
    expect(result).toBe('agent_claude_agents_reviewer_md');
  });

  it('collapses consecutive underscores', () => {
    const result = sanitizeMermaidId('a***b');
    expect(result).toBe('a_b');
  });

  it('handles dots and slashes', () => {
    const result = sanitizeMermaidId('skill:.claude/skills/code-review/SKILL.md');
    expect(result).toBe('skill_claude_skills_code_review_SKILL_md');
  });

  it('prefixes with n_ when starting with a digit', () => {
    const result = sanitizeMermaidId('123abc');
    expect(result).toBe('n_123abc');
  });

  it('does not prefix when starting with a letter', () => {
    const result = sanitizeMermaidId('abc123');
    expect(result).toBe('abc123');
  });

  it('is deterministic (same input → same output)', () => {
    const input = 'mcp-server:.mcp.json#github';
    expect(sanitizeMermaidId(input)).toBe(sanitizeMermaidId(input));
  });

  it('handles spaces', () => {
    const result = sanitizeMermaidId('some file name');
    expect(result).toBe('some_file_name');
  });

  it('handles MCP server hash references', () => {
    const result = sanitizeMermaidId('mcp-server:.mcp.json#github');
    expect(result).toBe('mcp_server_mcp_json_github');
  });

  it('removes trailing underscores', () => {
    const result = sanitizeMermaidId('foo.');
    expect(result).toBe('foo');
  });

  it('produces valid Mermaid identifiers (alphanumeric + underscore only)', () => {
    const inputs = [
      'agent:.claude/agents/reviewer.md',
      'claude-md:CLAUDE.md',
      'mcp-server:.mcp.json#github',
      'skill:.claude/skills/code-review/SKILL.md',
      'rule:.claude/rules/testing.md',
    ];
    for (const input of inputs) {
      const result = sanitizeMermaidId(input);
      expect(result).toMatch(/^[a-zA-Z_]\w*$/);
    }
  });
});

describe('escapeMermaidLabel', () => {
  it('escapes angle brackets', () => {
    expect(escapeMermaidLabel('a<b>c')).toBe('a&lt;b&gt;c');
  });

  it('escapes curly braces', () => {
    expect(escapeMermaidLabel('a{b}c')).toBe('a&#123;b&#125;c');
  });

  it('escapes double quotes', () => {
    expect(escapeMermaidLabel('a"b"c')).toBe('a&quot;b&quot;c');
  });

  it('escapes ampersands', () => {
    expect(escapeMermaidLabel('a&b')).toBe('a&amp;b');
  });

  it('passes through normal text unchanged', () => {
    expect(escapeMermaidLabel('reviewer')).toBe('reviewer');
  });
});
