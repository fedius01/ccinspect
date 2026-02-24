import { readFileSync } from 'fs';
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
}

const SECTION_KEYWORDS: Record<string, string[]> = {
  overview: ['overview', 'description', 'about', 'introduction', 'project overview', 'summary'],
  commands: ['commands', 'key commands', 'scripts', 'available commands', 'build commands'],
  architecture: ['architecture', 'structure', 'file structure', 'project structure', 'modules'],
  techStack: ['tech stack', 'technology', 'stack', 'dependencies', 'tooling'],
};

function matchesSectionKeywords(heading: string, keywords: string[]): boolean {
  const lower = heading.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
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
    };
  } catch {
    return null;
  }
}
