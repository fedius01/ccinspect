import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { readFileSync } from 'fs';
import picomatch from 'picomatch';

function existingFiles(files: (FileInfo | null)[]): FileInfo[] {
  return files.filter((f): f is FileInfo => f !== null && f.exists);
}

/** Extract tool name and optional glob from a permission pattern like "Bash(npm run *)" */
function parsePattern(pattern: string): { tool: string; glob: string | null } {
  const match = pattern.match(/^([\w*]+)\((.+)\)$/);
  if (match) {
    return { tool: match[1], glob: match[2] };
  }
  return { tool: pattern, glob: null };
}

interface PermEntry {
  pattern: string;
  file: string;
}

function findRedundancies(entries: PermEntry[]): LintIssue[] {
  const issues: LintIssue[] = [];

  for (const narrow of entries) {
    const narrowParsed = parsePattern(narrow.pattern);

    for (const broad of entries) {
      if (narrow === broad) continue;
      const broadParsed = parsePattern(broad.pattern);

      // Case 1: Bare tool subsumes scoped tool
      // e.g. "Bash" covers "Bash(npm run *)"
      if (broadParsed.glob === null && narrowParsed.glob !== null) {
        if (broadParsed.tool === narrowParsed.tool) {
          issues.push({
            ruleId: 'settings/redundant-permissions',
            severity: 'info',
            category: 'settings',
            message: `Redundant permission: "${narrow.pattern}" is already covered by "${broad.pattern}" in ${broad.file}.`,
            file: narrow.file,
            suggestion: 'Remove the narrower pattern to reduce clutter.',
            autoFixable: false,
          });
          break; // one redundancy per narrow pattern is enough
        }
      }

      // Case 2: Wildcard MCP subsumes specific MCP
      // e.g. "mcp__*" covers "mcp__github__*", or "mcp__server__*" covers "mcp__server__tool"
      if (broadParsed.glob === null && narrowParsed.glob === null) {
        if (broadParsed.tool !== narrowParsed.tool && broadParsed.tool.includes('*')) {
          try {
            const isMatch = picomatch(broadParsed.tool);
            if (isMatch(narrowParsed.tool)) {
              issues.push({
                ruleId: 'settings/redundant-permissions',
                severity: 'info',
                category: 'settings',
                message: `Redundant permission: "${narrow.pattern}" is already covered by "${broad.pattern}" in ${broad.file}.`,
                file: narrow.file,
                suggestion: 'Remove the narrower pattern to reduce clutter.',
                autoFixable: false,
              });
              break;
            }
          } catch {
            // picomatch parse error, skip
          }
        }
      }

      // Case 3: Glob subsumption within same tool
      // e.g. "Bash(npm run *)" covers "Bash(npm run test)"
      if (
        broadParsed.glob !== null &&
        narrowParsed.glob !== null &&
        broadParsed.tool === narrowParsed.tool &&
        broadParsed.glob !== narrowParsed.glob
      ) {
        try {
          const isMatch = picomatch(broadParsed.glob);
          if (isMatch(narrowParsed.glob)) {
            issues.push({
              ruleId: 'settings/redundant-permissions',
              severity: 'info',
              category: 'settings',
              message: `Redundant permission: "${narrow.pattern}" is already covered by "${broad.pattern}" in ${broad.file}.`,
              file: narrow.file,
              suggestion: 'Remove the narrower pattern to reduce clutter.',
              autoFixable: false,
            });
            break;
          }
        } catch {
          // picomatch parse error, skip
        }
      }
    }
  }

  return issues;
}

export const redundantPermissionsRule: LintRule = {
  id: 'settings/redundant-permissions',
  description: 'Flag permission patterns already covered by a broader pattern',
  severity: 'info',
  category: 'settings',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    const settingsFiles = existingFiles([
      inventory.managedSettings,
      inventory.localSettings,
      inventory.projectSettings,
      inventory.userSettings,
    ]);

    // Collect all patterns per array type (allow, deny) across all files
    const allAllow: PermEntry[] = [];
    const allDeny: PermEntry[] = [];

    for (const file of settingsFiles) {
      try {
        const content = readFileSync(file.path, 'utf-8');
        const parsed = JSON.parse(content) as Record<string, unknown>;
        const perms = parsed.permissions as Record<string, unknown> | undefined;

        if (Array.isArray(perms?.allow)) {
          for (const pattern of perms.allow as string[]) {
            allAllow.push({ pattern, file: file.relativePath });
          }
        }
        if (Array.isArray(perms?.deny)) {
          for (const pattern of perms.deny as string[]) {
            allDeny.push({ pattern, file: file.relativePath });
          }
        }
      } catch {
        // skip unparseable files
      }
    }

    issues.push(...findRedundancies(allAllow));
    issues.push(...findRedundancies(allDeny));

    return issues;
  },
};
