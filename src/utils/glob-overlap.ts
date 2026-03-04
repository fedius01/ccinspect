import picomatch from 'picomatch';
import type { ParsedRule } from '../parsers/rules-md';

// --- Types ---

export interface GlobScope {
  base: string; // literal directory prefix (e.g., "src/components")
  glob: string; // the wildcard portion (e.g., "**/*.ts")
  extensions: string[] | null; // file extensions the pattern constrains to, null = any
  original: string; // the original pattern string
}

export type RuleScope =
  | { type: 'global'; reason: 'no-frontmatter' | 'no-globs' | 'always-apply' }
  | { type: 'scoped'; globs: string[] }
  | { type: 'dead'; globs: string[] };

// --- extractGlobScope ---

/**
 * Decompose a glob pattern into its structural components using picomatch.scan().
 * Extracts the literal directory prefix, wildcard portion, and constrained file extensions.
 */
export function extractGlobScope(pattern: string): GlobScope {
  const scanned = picomatch.scan(pattern);
  const base = scanned.base === '.' ? '' : scanned.base;
  const glob = scanned.glob;
  const extensions = extractExtensions(glob);
  return { base, glob, extensions, original: pattern };
}

/**
 * Extract file extensions from the glob portion of a pattern.
 *
 * Rules:
 * - "**\/*.ts" → [".ts"]
 * - "**\/*.test.ts" → [".test.ts", ".ts"] (compound: .test.ts also ends in .ts)
 * - "**\/*.{ts,tsx}" → [".ts", ".tsx"]
 * - "**" → null (matches any file)
 * - "*" → null (matches any file)
 */
function extractExtensions(glob: string): string[] | null {
  // Handle brace expansion: *.{ts,tsx} or **/*.{ts,tsx}
  const braceMatch = glob.match(/\.\{([^}]+)\}$/);
  if (braceMatch) {
    const alternatives = braceMatch[1].split(',').map((s) => s.trim());
    return alternatives.map((alt) => `.${alt}`);
  }

  // Find the extension after the last wildcard character (* or **)
  // Look for the pattern: (last * or **) followed by characters containing a dot
  const lastStarIdx = glob.lastIndexOf('*');
  if (lastStarIdx === -1) {
    // No wildcard — check if the whole glob has an extension
    const dotIdx = glob.indexOf('.');
    if (dotIdx >= 0) {
      return extractCompoundExtensions(glob.slice(dotIdx));
    }
    return null;
  }

  const afterStar = glob.slice(lastStarIdx + 1);
  const dotIdx = afterStar.indexOf('.');
  if (dotIdx === -1) {
    // No dot after the last * → matches any file type
    return null;
  }

  const extPart = afterStar.slice(dotIdx); // e.g., ".test.ts" or ".ts"
  return extractCompoundExtensions(extPart);
}

/**
 * For a compound extension like ".test.ts", return both ".test.ts" and ".ts".
 * For a simple extension like ".ts", return just [".ts"].
 */
function extractCompoundExtensions(extPart: string): string[] {
  const result: string[] = [extPart];

  // Find the final simple extension (last dot segment)
  const lastDotIdx = extPart.lastIndexOf('.');
  if (lastDotIdx > 0) {
    // There's more than one dot — extract the final simple extension
    const simpleExt = extPart.slice(lastDotIdx);
    if (simpleExt !== extPart) {
      result.push(simpleExt);
    }
  }

  return result;
}

// --- globPatternsOverlap ---

// Default filenames for probes when a pattern matches any extension
const DEFAULT_FILENAMES = [
  'f.ts',
  'f.tsx',
  'f.js',
  'f.md',
  'f.py',
  'f.json',
  'f.css',
  'f.txt',
];

/**
 * Determine whether two glob patterns can match any common path.
 * Uses cross-pollinated probe generation with picomatch verification.
 */
export function globPatternsOverlap(patternA: string, patternB: string): boolean {
  const scopeA = extractGlobScope(patternA);
  const scopeB = extractGlobScope(patternB);

  // Step 1: Quick structural pre-check on bases
  if (!basesCompatible(scopeA.base, scopeB.base)) {
    return false;
  }

  // Step 2: Generate cross-pollinated probes
  const probes = generateProbes(scopeA, scopeB);

  // Step 3: Verify with picomatch (compile each pattern once)
  const matcherA = picomatch(patternA);
  const matcherB = picomatch(patternB);

  return probes.some((probe) => matcherA(probe) && matcherB(probe));
}

/**
 * Check if two base paths are compatible (one is a prefix of the other, or either is empty).
 */
function basesCompatible(baseA: string, baseB: string): boolean {
  if (baseA === '' || baseB === '') return true;
  if (baseA === baseB) return true;

  // Check if one is a prefix of the other (with directory boundary)
  const aWithSlash = baseA.endsWith('/') ? baseA : `${baseA}/`;
  const bWithSlash = baseB.endsWith('/') ? baseB : `${baseB}/`;
  return aWithSlash.startsWith(bWithSlash) || bWithSlash.startsWith(aWithSlash);
}

/**
 * Generate probe paths that combine directory structure from one pattern
 * with file-naming constraints from the other.
 */
function generateProbes(scopeA: GlobScope, scopeB: GlobScope): string[] {
  const dirs = collectDirectoryCandidates(scopeA, scopeB);
  const filenames = collectFilenameCandidates(scopeA, scopeB);

  const probeSet = new Set<string>();
  for (const dir of dirs) {
    for (const filename of filenames) {
      if (dir === '') {
        probeSet.add(filename);
      } else {
        probeSet.add(`${dir}/${filename}`);
      }
    }
  }

  return [...probeSet];
}

/**
 * Collect directory candidates from both patterns' bases and their nested variants.
 */
function collectDirectoryCandidates(
  scopeA: GlobScope,
  scopeB: GlobScope,
): string[] {
  const dirs = new Set<string>();

  // Add both bases
  dirs.add(scopeA.base);
  dirs.add(scopeB.base);

  // If either glob contains **, add nested variants
  const hasGlobstarA = scopeA.glob.includes('**');
  const hasGlobstarB = scopeB.glob.includes('**');

  if (hasGlobstarA || hasGlobstarB) {
    for (const base of [scopeA.base, scopeB.base]) {
      if (base === '') {
        dirs.add('d');
        dirs.add('d/sub');
      } else {
        dirs.add(`${base}/d`);
        dirs.add(`${base}/d/sub`);
      }
    }
  }

  // If one base is longer (more specific), add it as a subdir of the shorter
  if (
    scopeA.base &&
    scopeB.base &&
    scopeA.base !== scopeB.base
  ) {
    const shorter =
      scopeA.base.length < scopeB.base.length ? scopeA.base : scopeB.base;
    const longer =
      scopeA.base.length < scopeB.base.length ? scopeB.base : scopeA.base;
    if (longer.startsWith(shorter)) {
      dirs.add(longer);
    }
  }

  return [...dirs];
}

/**
 * Collect filename candidates from both patterns' extensions, cross-pollinating.
 */
function collectFilenameCandidates(
  scopeA: GlobScope,
  scopeB: GlobScope,
): string[] {
  const filenames = new Set<string>();

  const addExtensionFilenames = (exts: string[] | null): void => {
    if (exts === null) {
      for (const f of DEFAULT_FILENAMES) filenames.add(f);
    } else {
      for (const ext of exts) {
        filenames.add(`f${ext}`);
      }
    }
  };

  // Add filenames from both patterns (cross-pollination)
  addExtensionFilenames(scopeA.extensions);
  addExtensionFilenames(scopeB.extensions);

  return [...filenames];
}

// --- globArraysOverlap ---

/**
 * Do two glob arrays overlap? Empty array = global scope (no constraint) = overlaps everything.
 */
export function globArraysOverlap(globsA: string[], globsB: string[]): boolean {
  // Empty = no scope constraint = global scope → overlaps everything
  if (globsA.length === 0 || globsB.length === 0) return true;

  for (const a of globsA) {
    for (const b of globsB) {
      if (globPatternsOverlap(a, b)) return true;
    }
  }
  return false;
}

// --- extractRuleScope ---

/**
 * Normalize a ParsedRule into a canonical RuleScope.
 * Order of checks matters — first match wins.
 */
export function extractRuleScope(parsed: ParsedRule): RuleScope {
  // 1. No frontmatter at all
  if (!parsed.hasFrontmatter) {
    return { type: 'global', reason: 'no-frontmatter' };
  }

  // 2. alwaysApply: true
  if (parsed.frontmatter.alwaysApply === true) {
    return { type: 'global', reason: 'always-apply' };
  }

  // 3. Check for globs or paths field
  const rawGlobs = parsed.frontmatter.globs ?? parsed.frontmatter.paths;
  if (rawGlobs === undefined || rawGlobs === null) {
    return { type: 'global', reason: 'no-globs' };
  }

  // 4. Validate the globs value is a non-empty string array
  if (!Array.isArray(rawGlobs)) {
    return { type: 'dead', globs: [] };
  }
  const globs = rawGlobs.filter((g): g is string => typeof g === 'string');
  if (globs.length === 0) {
    return { type: 'dead', globs: [] };
  }

  // 5-6. Valid globs — check if dead or scoped
  if (parsed.isDead) {
    return { type: 'dead', globs };
  }
  return { type: 'scoped', globs };
}
