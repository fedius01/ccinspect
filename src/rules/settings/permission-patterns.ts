import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { readFileSync } from 'fs';

const KNOWN_TOOLS = [
  'Bash',
  'Read',
  'Edit',
  'Write',
  'WebFetch',
  'WebSearch',
  'Grep',
  'Glob',
  'NotebookEdit',
  'Task',
];

const TOOL_PATTERN_REGEX = /^(\w+)\((.+)\)$/;
const BARE_IDENTIFIER_REGEX = /^[\w.]+$/;
// MCP patterns: mcp__*, mcp__name, mcp__name__*, mcp__name__tool
// Server/tool names may contain hyphens, alphanumerics, underscores
// eslint-disable-next-line sonarjs/slow-regex -- input is from local config files, not untrusted
const MCP_PATTERN_REGEX = /^mcp__(\*|[a-zA-Z0-9_-]+(__(\*|[a-zA-Z0-9_-]+))?)$/;
function existingFiles(files: (FileInfo | null)[]): FileInfo[] {
  return files.filter((f): f is FileInfo => f !== null && f.exists);
}

function extractPatterns(parsed: Record<string, unknown>): string[] {
  const patterns: string[] = [];
  const perms = parsed.permissions as Record<string, unknown> | undefined;
  if (!perms) {
    return patterns;
  }

  if (Array.isArray(perms.allow)) {
    patterns.push(...(perms.allow as string[]));
  }
  if (Array.isArray(perms.deny)) {
    patterns.push(...(perms.deny as string[]));
  }
  if (Array.isArray(perms.ask)) {
    patterns.push(...(perms.ask as string[]));
  }

  return patterns;
}

export const permissionPatternsRule: LintRule = {
  id: 'settings/permission-patterns',
  description: 'Validate permission pattern format and tool names',
  severity: 'warning',
  category: 'settings',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    const settingsFiles = existingFiles([
      inventory.managedSettings,
      inventory.localSettings,
      inventory.projectSettings,
      inventory.userSettings,
    ]);

    for (const file of settingsFiles) {
      let parsed: Record<string, unknown>;
      try {
        const content = readFileSync(file.path, 'utf-8');
        parsed = JSON.parse(content) as Record<string, unknown>;
      } catch {
        // Skip files that cannot be read or parsed
        continue;
      }

      const patterns = extractPatterns(parsed);

      for (const pattern of patterns) {
        if (typeof pattern !== 'string') {
          continue;
        }

        // MCP tool patterns (e.g. mcp__*, mcp__server__*, mcp__server__tool)
        if (pattern.startsWith('mcp__')) {
          if (!MCP_PATTERN_REGEX.test(pattern)) {
            issues.push({
              ruleId: 'settings/permission-patterns',
              severity: 'error',
              category: 'settings',
              message: `Malformed MCP permission pattern "${pattern}" in ${file.relativePath}. Expected format: mcp__<server>, mcp__<server>__<tool>, or mcp__<server>__*.`,
              file: file.path,
              suggestion: `MCP patterns use double underscores: "mcp__servername__*" (all tools) or "mcp__servername__toolname" (specific tool).`,
              autoFixable: false,
            });
          }
          continue;
        }

        // Accept bare identifiers (e.g. "Bash", "Read") as valid patterns
        if (BARE_IDENTIFIER_REGEX.test(pattern)) {
          // Bare identifier — valid format, check tool name for known built-in tools
          if (!KNOWN_TOOLS.includes(pattern)) {
            issues.push({
              ruleId: 'settings/permission-patterns',
              severity: 'warning',
              category: 'settings',
              message: `Unknown tool name "${pattern}" in permission pattern in ${file.relativePath}.`,
              file: file.path,
              suggestion: `Known tools are: ${KNOWN_TOOLS.join(', ')}. Check for typos or verify the tool name.`,
              autoFixable: false,
            });
          }
          continue;
        }

        const match = pattern.match(TOOL_PATTERN_REGEX);

        if (!match) {
          // Pattern does not match Tool(glob) format or bare identifier
          issues.push({
            ruleId: 'settings/permission-patterns',
            severity: 'error',
            category: 'settings',
            message: `Malformed permission pattern "${pattern}" in ${file.relativePath}. Expected format: ToolName(glob), bare tool name, or MCP pattern (mcp__server__tool).`,
            file: file.path,
            suggestion: `Fix the pattern to match the format "ToolName(glob)", e.g. "Bash(npm run *)" or "Read(./.env)", a bare tool name like "Bash", or an MCP pattern like "mcp__servername__*".`,
            autoFixable: false,
          });
          continue;
        }

        const toolName = match[1];
        if (!KNOWN_TOOLS.includes(toolName)) {
          issues.push({
            ruleId: 'settings/permission-patterns',
            severity: 'warning',
            category: 'settings',
            message: `Unknown tool name "${toolName}" in permission pattern "${pattern}" in ${file.relativePath}.`,
            file: file.path,
            suggestion: `Known tools are: ${KNOWN_TOOLS.join(', ')}. Check for typos or verify the tool name.`,
            autoFixable: false,
          });
        }
      }
    }

    return issues;
  },
};