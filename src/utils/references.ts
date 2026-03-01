import { readFileSync } from 'fs';

/**
 * Read raw markdown content from a file.
 * Used for skills and commands where we only need text content, not agent-specific parsing.
 */
export function readMarkdownContent(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Scan text content for agent name references.
 * Uses word-boundary regex to avoid false positives (e.g., "test" matching "testing").
 *
 * Patterns matched:
 * - "the <name> agent"
 * - "delegate/delegates/delegating to <name> [agent]"
 * - "use/uses <name> agent"
 *
 * @returns Set of lowercase agent names found in the text.
 */
export function findAgentReferences(text: string): Set<string> {
  const refs = new Set<string>();
  // All patterns use non-capturing groups except for the name — group 1 is always the name
  const patterns = [
    /\bthe\s+([\w-]+)\s+agent\b/gi,
    /\bdelegat(?:e|es|ing)\s+to\s+(?:the\s+)?([\w-]+)(?:\s+agent)?\b/gi,
    /\bus(?:e|es|ing)\s+(?:the\s+)?([\w-]+)\s+agent\b/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      refs.add(match[1].toLowerCase());
    }
  }
  return refs;
}

/**
 * Scan text content for skill name references.
 * Uses word-boundary regex to avoid false positives.
 *
 * Patterns matched:
 * - "the <name> skill"
 * - "use/uses <name> skill"
 * - "delegate/delegates/delegating to <name> [skill]"
 *
 * @returns Set of lowercase skill names found in the text.
 */
export function findSkillReferences(text: string): Set<string> {
  const refs = new Set<string>();
  // All patterns use non-capturing groups except for the name — group 1 is always the name
  const patterns = [
    /\bthe\s+([\w-]+)\s+skill\b/gi,
    /\bus(?:e|es|ing)\s+(?:the\s+)?([\w-]+)\s+skill\b/gi,
    /\bdelegat(?:e|es|ing)\s+to\s+(?:the\s+)?([\w-]+)(?:\s+skill)?\b/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      refs.add(match[1].toLowerCase());
    }
  }
  return refs;
}

/**
 * Check if a specific name is mentioned in text using word-boundary matching.
 * Escapes regex special characters in the name to prevent regex injection.
 *
 * IMPORTANT: Do NOT use `text.includes(name)` — it produces false positives
 * (e.g., "test" matches "testing"). Always use this function instead.
 */
export function nameMatchesInText(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
  return pattern.test(text);
}
