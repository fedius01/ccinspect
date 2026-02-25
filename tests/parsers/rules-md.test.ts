import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { parseRuleMd } from '../../src/parsers/rules-md.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

describe('rules-md parser', () => {
  describe('full-project typescript.md', () => {
    const projectRoot = join(FIXTURES, 'full-project');
    const filePath = join(projectRoot, '.claude', 'rules', 'typescript.md');

    it('returns non-null for valid rule file', () => {
      const result = parseRuleMd(filePath, projectRoot);
      expect(result).not.toBeNull();
    });

    it('detects frontmatter', () => {
      const result = parseRuleMd(filePath, projectRoot)!;
      expect(result.hasFrontmatter).toBe(true);
    });

    it('extracts paths array', () => {
      const result = parseRuleMd(filePath, projectRoot)!;
      expect(result.frontmatter.paths).toEqual(['src/**/*.ts', 'src/**/*.tsx']);
    });

    it('extracts description', () => {
      const result = parseRuleMd(filePath, projectRoot)!;
      expect(result.frontmatter.description).toBe(
        'TypeScript coding standards for production source code',
      );
    });

    it('extracts markdown content', () => {
      const result = parseRuleMd(filePath, projectRoot)!;
      expect(result.content).toContain('TypeScript Rules');
    });
  });

  describe('overconfigured dead-rule.md', () => {
    const projectRoot = join(FIXTURES, 'overconfigured');
    const filePath = join(projectRoot, '.claude', 'rules', 'dead-rule.md');

    it('flags as dead when globs match no files', () => {
      const result = parseRuleMd(filePath, projectRoot)!;
      expect(result.isDead).toBe(true);
      expect(result.matchedFiles).toHaveLength(0);
    });
  });

  describe('overconfigured typescript.md (live rule)', () => {
    const projectRoot = join(FIXTURES, 'overconfigured');
    const filePath = join(projectRoot, '.claude', 'rules', 'typescript.md');

    it('matches existing source files', () => {
      const result = parseRuleMd(filePath, projectRoot)!;
      expect(result.isDead).toBe(false);
      expect(result.matchedFiles.length).toBeGreaterThan(0);
    });
  });

  describe('overconfigured bad-frontmatter.md', () => {
    const projectRoot = join(FIXTURES, 'overconfigured');
    const filePath = join(projectRoot, '.claude', 'rules', 'bad-frontmatter.md');

    it('parses without error', () => {
      const result = parseRuleMd(filePath, projectRoot);
      expect(result).not.toBeNull();
    });

    it('has frontmatter detected', () => {
      const result = parseRuleMd(filePath, projectRoot)!;
      expect(result.hasFrontmatter).toBe(true);
    });

    it('has paths as a string (not array)', () => {
      const result = parseRuleMd(filePath, projectRoot)!;
      // paths is a string, not an array
      expect(typeof result.frontmatter.paths).toBe('string');
    });

    it('has unknown field priority', () => {
      const result = parseRuleMd(filePath, projectRoot)!;
      expect(result.frontmatter.priority).toBe('high');
    });
  });

  describe('file without frontmatter', () => {
    const projectRoot = join(FIXTURES, 'overconfigured');
    // deploy.md has no frontmatter (it's a command file, but we can parse it)
    const filePath = join(FIXTURES, 'full-project', '.claude', 'commands', 'deploy.md');

    it('reports no frontmatter', () => {
      const result = parseRuleMd(filePath, projectRoot)!;
      expect(result.hasFrontmatter).toBe(false);
    });

    it('is not flagged as dead when no paths defined', () => {
      const result = parseRuleMd(filePath, projectRoot)!;
      expect(result.isDead).toBe(false);
    });
  });

  describe('error handling', () => {
    it('returns null for non-existent file', () => {
      const result = parseRuleMd('/nonexistent/rule.md', '/test');
      expect(result).toBeNull();
    });
  });
});
