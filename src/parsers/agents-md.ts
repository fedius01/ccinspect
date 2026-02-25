import { readFileSync } from 'fs';
import matter from 'gray-matter';

export interface ParsedAgentOrSkill {
  filePath: string;
  frontmatter: Record<string, unknown>;
  hasFrontmatter: boolean;
  content: string;
}

export function parseAgentMd(filePath: string): ParsedAgentOrSkill | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = matter(raw);

    const frontmatter = parsed.data as Record<string, unknown>;
    const hasFrontmatter = Object.keys(frontmatter).length > 0;
    const content = parsed.content;

    return {
      filePath,
      frontmatter,
      hasFrontmatter,
      content,
    };
  } catch {
    return null;
  }
}
