import { describe, test, expect } from 'vitest';
import {
  extractGlobScope,
  globPatternsOverlap,
  globArraysOverlap,
  extractRuleScope,
} from '../../src/utils/glob-overlap';
import type { ParsedRule } from '../../src/parsers/rules-md';

// --- extractGlobScope ---

describe('extractGlobScope', () => {
  describe('base extraction', () => {
    test('"src/**/*.ts" → base "src"', () => {
      expect(extractGlobScope('src/**/*.ts').base).toBe('src');
    });

    test('"src/components/**" → base "src/components"', () => {
      expect(extractGlobScope('src/components/**').base).toBe('src/components');
    });

    test('"**/*.test.ts" → base ""', () => {
      expect(extractGlobScope('**/*.test.ts').base).toBe('');
    });

    test('"**" → base ""', () => {
      expect(extractGlobScope('**').base).toBe('');
    });
  });

  describe('extension extraction', () => {
    test('"src/**/*.ts" → extensions [".ts"]', () => {
      expect(extractGlobScope('src/**/*.ts').extensions).toEqual(['.ts']);
    });

    test('"src/**/*.tsx" → extensions [".tsx"]', () => {
      expect(extractGlobScope('src/**/*.tsx').extensions).toEqual(['.tsx']);
    });

    test('"**/*.test.ts" → extensions include ".test.ts" and ".ts"', () => {
      const exts = extractGlobScope('**/*.test.ts').extensions;
      expect(exts).toContain('.test.ts');
      expect(exts).toContain('.ts');
    });

    test('"**/*.config.ts" → extensions include ".config.ts" and ".ts"', () => {
      const exts = extractGlobScope('**/*.config.ts').extensions;
      expect(exts).toContain('.config.ts');
      expect(exts).toContain('.ts');
    });

    test('"src/**" → extensions null', () => {
      expect(extractGlobScope('src/**').extensions).toBeNull();
    });

    test('"**" → extensions null', () => {
      expect(extractGlobScope('**').extensions).toBeNull();
    });

    test('"src/**/*.{ts,tsx}" → extensions [".ts", ".tsx"]', () => {
      expect(extractGlobScope('src/**/*.{ts,tsx}').extensions).toEqual([
        '.ts',
        '.tsx',
      ]);
    });

    test('"*.config.ts" → extensions include ".config.ts" and ".ts"', () => {
      const exts = extractGlobScope('*.config.ts').extensions;
      expect(exts).toContain('.config.ts');
      expect(exts).toContain('.ts');
    });
  });

  describe('original preservation', () => {
    test('preserves original pattern string', () => {
      expect(extractGlobScope('src/**/*.ts').original).toBe('src/**/*.ts');
    });
  });
});

// --- globPatternsOverlap — overlapping pairs ---

describe('globPatternsOverlap — overlapping pairs', () => {
  // "src/components/Button.ts" matches both
  test('"src/**" vs "src/components/**" → true (prefix containment)', () => {
    expect(globPatternsOverlap('src/**', 'src/components/**')).toBe(true);
  });

  // "src/components/Button.ts" matches both
  test('"src/**/*.ts" vs "src/components/**" → true (scoped extension in broader dir)', () => {
    expect(globPatternsOverlap('src/**/*.ts', 'src/components/**')).toBe(true);
  });

  // "src/utils/helpers.test.ts" matches both (.test.ts ends in .ts)
  test('"**/*.test.ts" vs "src/**/*.ts" → true (compound extension)', () => {
    expect(globPatternsOverlap('**/*.test.ts', 'src/**/*.ts')).toBe(true);
  });

  // "anything.ts" matches both
  test('"**" vs "src/**/*.ts" → true (global overlaps everything)', () => {
    expect(globPatternsOverlap('**', 'src/**/*.ts')).toBe(true);
  });

  // "src/app.ts" matches both
  test('"src/**/*.ts" vs "src/**/*.ts" → true (identical patterns)', () => {
    expect(globPatternsOverlap('src/**/*.ts', 'src/**/*.ts')).toBe(true);
  });

  // "src/app.ts" matches both
  test('"src/**" vs "**/*.ts" → true (dir-scoped meets extension-scoped)', () => {
    expect(globPatternsOverlap('src/**', '**/*.ts')).toBe(true);
  });

  // "src/lib/util.ts" matches both
  test('"src/**/*.ts" vs "src/lib/**" → true (extension + subdir)', () => {
    expect(globPatternsOverlap('src/**/*.ts', 'src/lib/**')).toBe(true);
  });

  // "app.ts" matches both (** matches root too)
  test('"**/*.ts" vs "**/*.ts" → true (identical global)', () => {
    expect(globPatternsOverlap('**/*.ts', '**/*.ts')).toBe(true);
  });

  // "src/app.config.ts" matches both (.config.ts ends in .ts)
  test('"src/**/*.config.ts" vs "src/**/*.ts" → true (compound sub-extension)', () => {
    expect(
      globPatternsOverlap('src/**/*.config.ts', 'src/**/*.ts'),
    ).toBe(true);
  });
});

// --- globPatternsOverlap — non-overlapping pairs ---

describe('globPatternsOverlap — non-overlapping pairs', () => {
  // .ts files never end in .tsx and vice versa
  test('"src/**/*.ts" vs "src/**/*.tsx" → false (different extensions)', () => {
    expect(globPatternsOverlap('src/**/*.ts', 'src/**/*.tsx')).toBe(false);
  });

  // completely disjoint directories
  test('"backend/**" vs "frontend/**" → false (disjoint dirs)', () => {
    expect(globPatternsOverlap('backend/**', 'frontend/**')).toBe(false);
  });

  // different dir AND different extension
  test('"src/**/*.ts" vs "backend/**/*.py" → false (disjoint everything)', () => {
    expect(globPatternsOverlap('src/**/*.ts', 'backend/**/*.py')).toBe(false);
  });

  // no path can be in both docs/ and src/
  test('"docs/**/*.md" vs "src/**/*.ts" → false (disjoint dirs + extensions)', () => {
    expect(globPatternsOverlap('docs/**/*.md', 'src/**/*.ts')).toBe(false);
  });

  // top-level separation
  test('"tests/**" vs "src/**" → false (disjoint top-level)', () => {
    expect(globPatternsOverlap('tests/**', 'src/**')).toBe(false);
  });

  // .css and .ts never match
  test('"**/*.css" vs "**/*.ts" → false (global dirs but different extensions)', () => {
    expect(globPatternsOverlap('**/*.css', '**/*.ts')).toBe(false);
  });

  // different immediate directories under src
  test('"src/api/**" vs "src/components/**" → false (disjoint subdirs)', () => {
    expect(globPatternsOverlap('src/api/**', 'src/components/**')).toBe(false);
  });
});

// --- globArraysOverlap ---

describe('globArraysOverlap', () => {
  test('empty vs scoped → true (empty = global)', () => {
    expect(globArraysOverlap([], ['src/**/*.ts'])).toBe(true);
  });

  test('empty vs empty → true (both global)', () => {
    expect(globArraysOverlap([], [])).toBe(true);
  });

  test('one overlapping pair in arrays → true', () => {
    expect(
      globArraysOverlap(['src/**/*.ts'], ['src/components/**']),
    ).toBe(true);
  });

  test('no overlapping pairs → false', () => {
    expect(
      globArraysOverlap(['src/**/*.ts'], ['backend/**/*.py']),
    ).toBe(false);
  });

  test('multi-glob arrays with one overlap → true', () => {
    expect(
      globArraysOverlap(
        ['docs/**/*.md', 'src/**/*.ts'],
        ['backend/**/*.py', 'src/lib/**'],
      ),
    ).toBe(true);
  });
});

// --- extractRuleScope ---

describe('extractRuleScope', () => {
  function makeRule(overrides: Partial<ParsedRule>): ParsedRule {
    return {
      filePath: '/test/rules/example.md',
      frontmatter: {},
      hasFrontmatter: true,
      content: 'Some rule content',
      matchedFiles: [],
      isDead: false,
      ...overrides,
    };
  }

  test('no frontmatter → global/no-frontmatter', () => {
    const scope = extractRuleScope(makeRule({ hasFrontmatter: false }));
    expect(scope).toEqual({ type: 'global', reason: 'no-frontmatter' });
  });

  test('alwaysApply: true with globs → global/always-apply', () => {
    const scope = extractRuleScope(
      makeRule({
        frontmatter: { alwaysApply: true, globs: ['src/**'] },
      }),
    );
    expect(scope).toEqual({ type: 'global', reason: 'always-apply' });
  });

  test('alwaysApply: true without globs → global/always-apply', () => {
    const scope = extractRuleScope(
      makeRule({ frontmatter: { alwaysApply: true } }),
    );
    expect(scope).toEqual({ type: 'global', reason: 'always-apply' });
  });

  test('frontmatter with only description → global/no-globs', () => {
    const scope = extractRuleScope(
      makeRule({ frontmatter: { description: 'A rule about things' } }),
    );
    expect(scope).toEqual({ type: 'global', reason: 'no-globs' });
  });

  test('frontmatter with globs: [] → dead', () => {
    const scope = extractRuleScope(
      makeRule({ frontmatter: { globs: [] } }),
    );
    expect(scope).toEqual({ type: 'dead', globs: [] });
  });

  test('frontmatter with valid globs, isDead: false → scoped', () => {
    const scope = extractRuleScope(
      makeRule({
        frontmatter: { globs: ['src/**/*.ts'] },
        matchedFiles: ['src/app.ts'],
        isDead: false,
      }),
    );
    expect(scope).toEqual({ type: 'scoped', globs: ['src/**/*.ts'] });
  });

  test('frontmatter with valid globs, isDead: true → dead', () => {
    const scope = extractRuleScope(
      makeRule({
        frontmatter: { globs: ['src/**/*.ts'] },
        matchedFiles: [],
        isDead: true,
      }),
    );
    expect(scope).toEqual({ type: 'dead', globs: ['src/**/*.ts'] });
  });

  test('frontmatter with paths (legacy) → scoped (uses paths when no globs)', () => {
    const scope = extractRuleScope(
      makeRule({
        frontmatter: { paths: ['backend/**/*.py'] },
        isDead: false,
      }),
    );
    expect(scope).toEqual({ type: 'scoped', globs: ['backend/**/*.py'] });
  });

  test('frontmatter with both globs and paths → scoped (globs takes precedence)', () => {
    const scope = extractRuleScope(
      makeRule({
        frontmatter: {
          globs: ['src/**/*.ts'],
          paths: ['backend/**/*.py'],
        },
        isDead: false,
      }),
    );
    expect(scope).toEqual({ type: 'scoped', globs: ['src/**/*.ts'] });
  });
});
