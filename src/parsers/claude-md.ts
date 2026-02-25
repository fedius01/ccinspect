import { readFileSync, existsSync } from 'fs';
import { dirname, resolve, isAbsolute } from 'path';
import { estimateTokens } from '../utils/tokens.js';

export interface ClaudeMdSection {
  heading: string;
  level: number;
  lineStart: number;
  lineEnd: number;
}

export interface ImportRef {
  path: string;
  line: number;
}

export interface GenericInstruction {
  text: string;
  line: number;
}

export interface ImportChainEntry {
  path: string;
  depth: number;
  resolvedPath: string | null;
}

export interface ParsedClaudeMd {
  filePath: string;
  content: string;
  lineCount: number;
  tokenCount: number;
  sections: ClaudeMdSection[];
  imports: ImportRef[];
  hasOverview: boolean;
  hasCommands: boolean;
  hasArchitecture: boolean;
  hasTechStack: boolean;
  genericInstructions: GenericInstruction[];
  importChain: ImportChainEntry[];
  maxImportDepth: number;
}

const SECTION_KEYWORDS: Record<string, string[]> = {
  overview: ['overview', 'description', 'about', 'introduction', 'project overview', 'summary'],
  commands: ['commands', 'key commands', 'scripts', 'available commands', 'build commands'],
  architecture: ['architecture', 'structure', 'file structure', 'project structure', 'modules'],
  techStack: ['tech stack', 'technology', 'stack', 'dependencies', 'tooling'],
};

const GENERIC_PHRASES: string[] = [
  'follow best practices',
  'write clean code',
  'be consistent',
  'use meaningful names',
  'use meaningful variable names',
  'keep it simple',
  'follow standards',
  'follow the standards',
  'use proper error handling',
  'write readable code',
  'follow the style guide',
  'ensure code quality',
  'follow industry best practices',
  'write self-documenting code',
  'use appropriate design patterns',
  'keep the codebase maintainable',
  'follow the coding standards',
  'keep functions small and focused',
  'follow the dry principle',
  'follow solid principles',
  'make sure code is well-documented',
  'ensure code quality is high',
  'handle edge cases appropriately',
];

function matchesSectionKeywords(heading: string, keywords: string[]): boolean {
  const lower = heading.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

function detectGenericInstructions(lines: string[]): GenericInstruction[] {
  const results: GenericInstruction[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    for (const phrase of GENERIC_PHRASES) {
      if (lower.includes(phrase)) {
        results.push({
          text: lines[i].trim().replace(/^[-*]\s*/, ''),
          line: i + 1,
        });
        break; // one match per line is enough
      }
    }
  }
  return results;
}

function resolveImportChain(
  filePath: string,
  maxDepth: number,
  visited: Set<string>,
  currentDepth: number,
): ImportChainEntry[] {
  if (currentDepth > maxDepth || visited.has(filePath)) {
    return [];
  }
  visited.add(filePath);

  const entries: ImportChainEntry[] = [];
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const dir = dirname(filePath);

    for (const line of lines) {
      const importMatch = line.match(/@([\w./\-]+\.md)/);
      if (importMatch) {
        const importPath = importMatch[1];
        const resolved = isAbsolute(importPath) ? importPath : resolve(dir, importPath);
        const resolvedPath = existsSync(resolved) ? resolved : null;

        entries.push({
          path: importPath,
          depth: currentDepth,
          resolvedPath,
        });

        if (resolvedPath && !visited.has(resolvedPath)) {
          const childEntries = resolveImportChain(resolvedPath, maxDepth, visited, currentDepth + 1);
          entries.push(...childEntries);
        }
      }
    }
  } catch {
    // file read error — stop recursion for this branch
  }

  return entries;
}

export function parseClaudeMd(filePath: string): ParsedClaudeMd | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const lineCount = lines.length;
    const tokenCount = estimateTokens(content);

    // Extract sections (markdown headings)
    const sections: ClaudeMdSection[] = [];
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(#{1,6})\s+(.+)/);
      if (match) {
        // Close previous section
        if (sections.length > 0) {
          sections[sections.length - 1].lineEnd = i - 1;
        }
        sections.push({
          heading: match[2].trim(),
          level: match[1].length,
          lineStart: i + 1, // 1-indexed
          lineEnd: lines.length,
        });
      }
    }
    // Close last section
    if (sections.length > 0) {
      sections[sections.length - 1].lineEnd = lines.length;
    }

    // Extract @imports
    const imports: ImportRef[] = [];
    for (let i = 0; i < lines.length; i++) {
      const importMatch = lines[i].match(/@([\w./\-]+\.md)/);
      if (importMatch) {
        imports.push({
          path: importMatch[1],
          line: i + 1, // 1-indexed
        });
      }
    }

    // Check for recommended sections
    const allHeadings = sections.map((s) => s.heading);
    const hasOverview = allHeadings.some((h) => matchesSectionKeywords(h, SECTION_KEYWORDS.overview));
    const hasCommands = allHeadings.some((h) => matchesSectionKeywords(h, SECTION_KEYWORDS.commands));
    const hasArchitecture = allHeadings.some((h) =>
      matchesSectionKeywords(h, SECTION_KEYWORDS.architecture),
    );
    const hasTechStack = allHeadings.some((h) =>
      matchesSectionKeywords(h, SECTION_KEYWORDS.techStack),
    );

    // Detect generic instructions
    const genericInstructions = detectGenericInstructions(lines);

    // Resolve import chain
    const visited = new Set<string>();
    const importChain = resolveImportChain(filePath, 5, visited, 1);
    const maxImportDepth = importChain.length > 0
      ? Math.max(...importChain.map((e) => e.depth))
      : 0;

    return {
      filePath,
      content,
      lineCount,
      tokenCount,
      sections,
      imports,
      hasOverview,
      hasCommands,
      hasArchitecture,
      hasTechStack,
      genericInstructions,
      importChain,
      maxImportDepth,
    };
  } catch {
    return null;
  }
}
