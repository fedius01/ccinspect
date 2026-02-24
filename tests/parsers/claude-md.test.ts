import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { parseClaudeMd } from '../../src/parsers/claude-md.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

describe('claude-md parser', () => {
  describe('minimal-project', () => {
    it('parses a minimal CLAUDE.md', () => {
      const result = parseClaudeMd(join(FIXTURES, 'minimal-project', 'CLAUDE.md'));
      expect(result).not.toBeNull();
      expect(result!.lineCount).toBeGreaterThan(0);
      expect(result!.tokenCount).toBeGreaterThan(0);
    });
  });

  describe('full-project', () => {
    it('detects recommended sections', () => {
      const result = parseClaudeMd(join(FIXTURES, 'full-project', 'CLAUDE.md'));
      expect(result).not.toBeNull();
      expect(result!.hasOverview).toBe(true);
      expect(result!.hasCommands).toBe(true);
      expect(result!.hasArchitecture).toBe(true);
      expect(result!.hasTechStack).toBe(true);
    });

    it('extracts sections', () => {
      const result = parseClaudeMd(join(FIXTURES, 'full-project', 'CLAUDE.md'));
      expect(result).not.toBeNull();
      expect(result!.sections.length).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    it('returns null for non-existent file', () => {
      const result = parseClaudeMd(join(FIXTURES, 'does-not-exist', 'CLAUDE.md'));
      expect(result).toBeNull();
    });
  });
});
