/**
 * Path exclusion logic for ccinspect scanner and linter.
 *
 * Three layers of exclusion (applied in order):
 * 1. Built-in defaults — always excluded, not configurable
 * 2. .ccinspectignore  — per-project ignore file (like .gitignore)
 * 3. --exclude CLI flag — ad-hoc overrides
 *
 * Usage in scanner:
 *   const excluder = createExcluder(projectDir, cliExcludePatterns);
 *   if (excluder.isExcluded(filePath)) continue;
 */

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import picomatch from 'picomatch';

// ─── Built-in defaults ────────────────────────────────────────────────────────
// These are ALWAYS excluded. They represent paths that should never appear
// in scan/lint results under any circumstances.
const BUILTIN_EXCLUDE_DIRS = [
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'coverage',
  '__pycache__',
  '.next',
  '.nuxt',
];

// Subdirectory patterns that look like test fixtures and contain
// Claude Code config files (CLAUDE.md, settings.json, etc.) intentionally.
// These would generate false positives in scan results.
const BUILTIN_EXCLUDE_PATTERNS = [
  'tests/fixtures/**',
  'test/fixtures/**',
  '__tests__/fixtures/**',
  'spec/fixtures/**',
];

// ─── .ccinspectignore loader ──────────────────────────────────────────────────
const IGNORE_FILENAME = '.ccinspectignore';

function loadIgnoreFile(projectDir: string): string[] {
  const ignorePath = path.join(projectDir, IGNORE_FILENAME);
  if (!existsSync(ignorePath)) return [];

  return readFileSync(ignorePath, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

// ─── Core exclusion check ─────────────────────────────────────────────────────

export interface Excluder {
  /** Check if a file path should be excluded from scan/lint results */
  isExcluded(absolutePath: string): boolean;
  /** Get all active exclude patterns (for debugging / --verbose output) */
  activePatterns(): { builtin: string[]; ignore: string[]; cli: string[] };
}

export interface ExcluderOptions {
  /** Extra patterns from --exclude CLI flag */
  cliPatterns?: string[];
  /** Skip loading .ccinspectignore (useful for tests) */
  skipIgnoreFile?: boolean;
  /** Override built-in patterns (useful for tests) */
  builtinPatterns?: string[];
}

export function createExcluder(
  projectDir: string,
  options: ExcluderOptions = {},
): Excluder {
  const {
    cliPatterns = [],
    skipIgnoreFile = false,
    builtinPatterns,
  } = options;

  // Layer 1: Built-in defaults
  const builtinDirPatterns = BUILTIN_EXCLUDE_DIRS.map((d) => `**/${d}/**`);
  const allBuiltin = builtinPatterns ?? [
    ...builtinDirPatterns,
    ...BUILTIN_EXCLUDE_PATTERNS,
  ];

  // Layer 2: .ccinspectignore
  const ignorePatterns = skipIgnoreFile ? [] : loadIgnoreFile(projectDir);

  // Layer 3: CLI --exclude
  const cliExclude = [...cliPatterns];

  // Combine all patterns and compile a single matcher for performance
  const allPatterns = [...allBuiltin, ...ignorePatterns, ...cliExclude];
  const isMatch = picomatch(allPatterns, { dot: true });

  function isExcluded(absolutePath: string): boolean {
    const relativePath = path.relative(projectDir, absolutePath);

    // Fast path: check if any path segment is a built-in excluded dir
    const segments = relativePath.split(path.sep);
    if (segments.some((seg) => BUILTIN_EXCLUDE_DIRS.includes(seg))) {
      return true;
    }

    // Glob match against all compiled patterns
    return isMatch(relativePath);
  }

  return {
    isExcluded,
    activePatterns: () => ({
      builtin: allBuiltin,
      ignore: ignorePatterns,
      cli: cliExclude,
    }),
  };
}

// ─── Exports for testing ──────────────────────────────────────────────────────
export {
  BUILTIN_EXCLUDE_DIRS,
  BUILTIN_EXCLUDE_PATTERNS,
  IGNORE_FILENAME,
  loadIgnoreFile,
};  // knip:ignore