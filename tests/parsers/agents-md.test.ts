import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { parseAgentMd } from '../../src/parsers/agents-md.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

describe('agents-md parser', () => {
  describe('full-project reviewer.md', () => {
    const filePath = join(FIXTURES, 'full-project', '.claude', 'agents', 'reviewer.md');

    it('returns non-null for valid agent file', () => {
      const result = parseAgentMd(filePath);
      expect(result).not.toBeNull();
    });

    it('detects frontmatter', () => {
      const result = parseAgentMd(filePath)!;
      expect(result.hasFrontmatter).toBe(true);
    });

    it('extracts tools array', () => {
      const result = parseAgentMd(filePath)!;
      expect(result.frontmatter.tools).toEqual(['Read', 'Bash', 'Grep']);
    });

    it('extracts allowedTools array', () => {
      const result = parseAgentMd(filePath)!;
      expect(result.frontmatter.allowedTools).toBeInstanceOf(Array);
      expect(result.frontmatter.allowedTools).toContain('Bash(npm run lint)');
    });

    it('extracts model string', () => {
      const result = parseAgentMd(filePath)!;
      expect(result.frontmatter.model).toBe('claude-sonnet-4-20250514');
    });

    it('extracts description', () => {
      const result = parseAgentMd(filePath)!;
      expect(result.frontmatter.description).toBe(
        'Code reviewer agent that checks style, correctness, and test coverage',
      );
    });

    it('extracts markdown content', () => {
      const result = parseAgentMd(filePath)!;
      expect(result.content).toContain('Code Reviewer Agent');
    });
  });

  describe('overconfigured helper.md (no frontmatter)', () => {
    const filePath = join(FIXTURES, 'overconfigured', '.claude', 'agents', 'helper.md');

    it('returns non-null', () => {
      const result = parseAgentMd(filePath);
      expect(result).not.toBeNull();
    });

    it('reports no frontmatter', () => {
      const result = parseAgentMd(filePath)!;
      expect(result.hasFrontmatter).toBe(false);
    });

    it('has empty frontmatter object', () => {
      const result = parseAgentMd(filePath)!;
      expect(Object.keys(result.frontmatter)).toHaveLength(0);
    });
  });

  describe('overconfigured reviewer.md (invalid frontmatter)', () => {
    const filePath = join(FIXTURES, 'overconfigured', '.claude', 'agents', 'reviewer.md');

    it('has frontmatter', () => {
      const result = parseAgentMd(filePath)!;
      expect(result.hasFrontmatter).toBe(true);
    });

    it('tools is a string (not array)', () => {
      const result = parseAgentMd(filePath)!;
      expect(typeof result.frontmatter.tools).toBe('string');
    });

    it('has unknown field priority', () => {
      const result = parseAgentMd(filePath)!;
      expect(result.frontmatter.priority).toBe('high');
    });
  });

  describe('skill file (using same parser)', () => {
    const filePath = join(FIXTURES, 'full-project', '.claude', 'skills', 'code-review', 'SKILL.md');

    it('parses skill YAML frontmatter', () => {
      const result = parseAgentMd(filePath)!;
      expect(result.hasFrontmatter).toBe(true);
      expect(result.frontmatter.name).toBe('code-review');
      expect(result.frontmatter.description).toContain('automated code review');
    });
  });

  describe('error handling', () => {
    it('returns null for non-existent file', () => {
      const result = parseAgentMd('/nonexistent/agent.md');
      expect(result).toBeNull();
    });
  });
});
