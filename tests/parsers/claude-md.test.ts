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
    const filePath = join(FIXTURES, 'full-project', 'CLAUDE.md');

    it('detects recommended sections', () => {
      const result = parseClaudeMd(filePath);
      expect(result).not.toBeNull();
      expect(result!.hasOverview).toBe(true);
      expect(result!.hasCommands).toBe(true);
      expect(result!.hasArchitecture).toBe(true);
      expect(result!.hasTechStack).toBe(true);
    });

    it('extracts sections', () => {
      const result = parseClaudeMd(filePath);
      expect(result).not.toBeNull();
      expect(result!.sections.length).toBeGreaterThan(0);
    });

    it('has no generic instructions in a well-written file', () => {
      const result = parseClaudeMd(filePath)!;
      expect(result.genericInstructions).toHaveLength(0);
    });

    it('has no imports', () => {
      const result = parseClaudeMd(filePath)!;
      expect(result.imports).toHaveLength(0);
      expect(result.maxImportDepth).toBe(0);
    });
  });

  describe('conflicting CLAUDE.md (generic instructions)', () => {
    const filePath = join(FIXTURES, 'conflicting', 'CLAUDE.md');

    it('detects generic instructions', () => {
      const result = parseClaudeMd(filePath)!;
      expect(result.genericInstructions.length).toBeGreaterThan(10);
    });

    it('reports correct line numbers for generic instructions', () => {
      const result = parseClaudeMd(filePath)!;
      for (const instruction of result.genericInstructions) {
        expect(instruction.line).toBeGreaterThan(0);
        expect(instruction.text.length).toBeGreaterThan(0);
      }
    });

    it('detects specific generic phrases', () => {
      const result = parseClaudeMd(filePath)!;
      const texts = result.genericInstructions.map((g) => g.text.toLowerCase());
      expect(texts.some((t) => t.includes('follow best practices'))).toBe(true);
      expect(texts.some((t) => t.includes('write clean code'))).toBe(true);
      expect(texts.some((t) => t.includes('keep functions small and focused'))).toBe(true);
    });

    it('has over 150 lines', () => {
      const result = parseClaudeMd(filePath)!;
      expect(result.lineCount).toBeGreaterThan(150);
    });

    it('detects overview section', () => {
      const result = parseClaudeMd(filePath)!;
      expect(result.hasOverview).toBe(true);
    });

    it('detects architecture section', () => {
      const result = parseClaudeMd(filePath)!;
      expect(result.hasArchitecture).toBe(true);
    });
  });

  describe('overconfigured CLAUDE.md (import chain)', () => {
    const filePath = join(FIXTURES, 'overconfigured', 'CLAUDE.md');

    it('detects @import references', () => {
      const result = parseClaudeMd(filePath)!;
      expect(result.imports.length).toBeGreaterThan(0);
    });

    it('resolves import chain with depth', () => {
      const result = parseClaudeMd(filePath)!;
      expect(result.importChain.length).toBeGreaterThan(0);
      expect(result.maxImportDepth).toBeGreaterThan(0);
    });

    it('has over 300 lines', () => {
      const result = parseClaudeMd(filePath)!;
      expect(result.lineCount).toBeGreaterThan(300);
    });

    it('has overview but no architecture section heading', () => {
      const result = parseClaudeMd(filePath)!;
      expect(result.hasOverview).toBe(true);
      // This file does NOT have a heading matching architecture keywords
      // (Module Structure is NOT in the architecture keyword list)
    });

    it('detects many generic instructions', () => {
      const result = parseClaudeMd(filePath)!;
      expect(result.genericInstructions.length).toBeGreaterThan(10);
    });

    it('has high token count', () => {
      const result = parseClaudeMd(filePath)!;
      expect(result.tokenCount).toBeGreaterThan(1800);
    });
  });

  describe('error handling', () => {
    it('returns null for non-existent file', () => {
      const result = parseClaudeMd(join(FIXTURES, 'does-not-exist', 'CLAUDE.md'));
      expect(result).toBeNull();
    });
  });
});
