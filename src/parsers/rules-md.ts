import { readFileSync } from 'fs';
import matter from 'gray-matter';
import fg from 'fast-glob';

export interface ParsedRule {
  filePath: string;
  frontmatter: Record<string, unknown>;
  hasFrontmatter: boolean;
  content: string;
  matchedFiles: string[];
  isDead: boolean;
}

export function parseRuleMd(filePath: string, projectRoot: string): ParsedRule | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = matter(raw);

    const frontmatter = parsed.data as Record<string, unknown>;
    const hasFrontmatter = Object.keys(frontmatter).length > 0;
    const content = parsed.content;

    // Evaluate path globs if present
    let matchedFiles: string[] = [];
    const paths = frontmatter.paths;
    if (Array.isArray(paths) && paths.length > 0) {
      const patterns = paths.filter((p): p is string => typeof p === 'string');
      if (patterns.length > 0) {
        matchedFiles = fg.sync(patterns, {
          cwd: projectRoot,
          dot: false,
          onlyFiles: true,
          absolute: false,
        });
      }
    }

    const isDead = hasFrontmatter && Array.isArray(paths) && paths.length > 0 && matchedFiles.length === 0;

    return {
      filePath,
      frontmatter,
      hasFrontmatter,
      content,
      matchedFiles,
      isDead,
    };
  } catch {
    return null;
  }
}
