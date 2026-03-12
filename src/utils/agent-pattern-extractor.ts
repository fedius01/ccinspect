/**
 * Extracts matchable command/path patterns from agent markdown files.
 * Used by `cci audit` to detect agent-bypass discrepancies — when Claude
 * runs an agent's commands directly via Bash instead of delegating.
 *
 * Pure function module. No filesystem access. No CLI/UI imports.
 */

/** Patterns extracted from an agent's markdown body and description. */
export interface AgentPatterns {
  /** Agent name from frontmatter. */
  agentName: string;
  /** Command fragments extracted from code spans and code blocks.
   *  E.g., ["pytest", "python -m pytest tests/ -v --tb=short"] */
  commandPatterns: string[];
  /** Path prefixes extracted from body. E.g., ["backend/", "tests/"] */
  pathPrefixes: string[];
  /** Whether any matchable patterns were found at all. */
  hasPatterns: boolean;
}

/**
 * Commands that appear in nearly every session and would produce false matches.
 * These are filtered out as the "first meaningful token" of a command line.
 */
const STOP_LIST = new Set([
  'cd', 'echo', 'ls', 'cat', 'head', 'tail', 'grep', 'mkdir', 'rm', 'cp', 'mv',
  'source', 'export', 'set', 'unset', 'pwd', 'true', 'false', 'sleep', 'wait',
  'kill', 'chmod', 'chown', 'touch', 'which', 'type', 'man', 'clear', 'history',
]);

/**
 * Runtime/interpreter tokens that are too generic to match alone.
 * "python" matches every Python session; "npm" matches every JS session.
 * These are only useful as part of a full command string (e.g., "python -m pytest").
 */
const TOO_GENERIC_ALONE = new Set([
  'python', 'python3', 'node', 'ruby', 'java', 'php',
  'perl', 'lua', 'bash', 'sh', 'zsh',
]);

/**
 * Check if a string looks like a relative path (contains `/`, not a URL).
 */
function isRelativePath(s: string): boolean {
  if (s.startsWith('http://') || s.startsWith('https://')) return false;
  if (s.startsWith('-')) return false;
  return s.includes('/');
}

/**
 * Extract all non-flag, non-stop-listed tokens from a command string.
 * For `python -m pytest tests/ -v`, returns ["python", "pytest"].
 * Path-like tokens (containing `/`) are skipped — they're handled by path extraction.
 */
function extractMeaningfulTokens(command: string): string[] {
  const tokens = command.trim().split(/\s+/);
  const result: string[] = [];
  for (const token of tokens) {
    if (token === '') continue;
    if (token.startsWith('-')) continue;
    if (STOP_LIST.has(token.toLowerCase())) continue;
    if (isRelativePath(token)) continue;
    result.push(token);
  }
  return result;
}

/**
 * Extract the directory prefix from a path-like string (up to and including last `/`).
 */
function extractDirPrefix(s: string): string | null {
  const lastSlash = s.lastIndexOf('/');
  if (lastSlash < 0) return null;
  return s.substring(0, lastSlash + 1);
}

/**
 * Extract path prefixes from text. Matches strings containing `/` that
 * look like relative paths (not URLs, not flags).
 */
function extractPaths(text: string): string[] {
  const paths: string[] = [];
  // Match path-like tokens: word chars, dots, dashes, slashes, asterisks
  const pathRegex = /(?:^|\s)([\w./*-]+\/[\w./*-]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pathRegex.exec(text)) !== null) {
    const candidate = match[1];
    if (!isRelativePath(candidate)) continue;
    const prefix = extractDirPrefix(candidate);
    if (prefix) {
      paths.push(prefix);
    }
  }
  return paths;
}

/**
 * Split a command line on shell operators (&&, |, ;) into individual commands.
 */
function splitShellCommands(line: string): string[] {
  return line.split(/\s*(?:&&|\|{1,2}|;)\s*/).filter(s => s.trim().length > 0);
}

/**
 * Process a single command string: extract first meaningful token and optionally
 * the full command (if it looks like a multi-word shell command).
 */
function processCommand(command: string, commands: Set<string>, paths: string[]) {
  const trimmed = command.trim();
  if (!trimmed) return;

  const tokens = extractMeaningfulTokens(trimmed);
  for (const token of tokens) {
    if (!TOO_GENERIC_ALONE.has(token.toLowerCase())) {
      commands.add(token);
    }
  }

  // If it looks like a multi-word shell command with meaningful tokens, keep the full content too
  if (trimmed.includes(' ') && tokens.length > 0) {
    commands.add(trimmed);
  }

  // Extract paths from the command
  for (const p of extractPaths(trimmed)) {
    paths.push(p);
  }
}

/**
 * Extract matchable command and path patterns from an agent's markdown content.
 *
 * @param name - Agent name (from frontmatter or filename)
 * @param description - Agent description string (from frontmatter)
 * @param body - Markdown body below frontmatter
 * @returns Extracted patterns for bypass detection
 */
export function extractAgentPatterns(
  name: string,
  description: string,
  body: string,
): AgentPatterns {
  const commands = new Set<string>();
  const paths: string[] = [];

  // 1. Extract from inline code spans (single backtick, not triple)
  //    Negative lookbehind/ahead for ` to avoid matching inside fenced blocks
  const inlineCodeRegex = /(?<!`)(`[^`]+`)(?!`)/g;
  let match: RegExpExecArray | null;

  // Process body code spans
  while ((match = inlineCodeRegex.exec(body)) !== null) {
    const content = match[1].slice(1, -1).trim(); // Strip backticks
    if (!content) continue;

    // Split on shell operators for multi-command spans
    const subCommands = splitShellCommands(content);
    for (const sub of subCommands) {
      processCommand(sub, commands, paths);
    }
  }

  // 2. Extract from fenced code blocks (triple backtick)
  const fencedBlockRegex = /```[^\n]*\n([\s\S]*?)```/g;
  while ((match = fencedBlockRegex.exec(body)) !== null) {
    const blockContent = match[1];
    const lines = blockContent.split('\n');
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith('#')) continue;

      const subCommands = splitShellCommands(trimmedLine);
      for (const sub of subCommands) {
        processCommand(sub, commands, paths);
      }
    }
  }

  // 3. Extract from description (only inline code spans)
  const descInlineRegex = /(?<!`)(`[^`]+`)(?!`)/g;
  while ((match = descInlineRegex.exec(description)) !== null) {
    const content = match[1].slice(1, -1).trim();
    if (!content) continue;

    const subCommands = splitShellCommands(content);
    for (const sub of subCommands) {
      processCommand(sub, commands, paths);
    }
  }

  // 4. Extract paths from body text (outside code spans/blocks)
  // We extract from the full body since extractPaths already handles filtering
  for (const p of extractPaths(body)) {
    paths.push(p);
  }

  // 5. Deduplicate
  const dedupedCommands = [...new Set(commands)];
  const dedupedPaths = [...new Set(paths)];

  return {
    agentName: name,
    commandPatterns: dedupedCommands,
    pathPrefixes: dedupedPaths,
    hasPatterns: dedupedCommands.length > 0 || dedupedPaths.length > 0,
  };
}
