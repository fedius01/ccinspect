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
            evidence: [
              { file: narrow.file, content: `${narrow.pattern} (redundant)` },
              { file: broad.file, content: `${broad.pattern} (already covers this)` },
            ],
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
                evidence: [
                  { file: narrow.file, content: `${narrow.pattern} (redundant)` },
                  { file: broad.file, content: `${broad.pattern} (already covers this)` },
                ],
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
              evidence: [
                { file: narrow.file, content: `${narrow.pattern} (redundant)` },
                { file: broad.file, content: `${broad.pattern} (already covers this)` },
              ],
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

function groupByBroadPattern(rawIssues: LintIssue[]): LintIssue[] {
  // Extract the broad pattern from each issue's message to use as grouping key.
  // Message format: 'Redundant permission: "narrow" is already covered by "broad" in file.'
  const groups = new Map<string, LintIssue[]>();

  for (const issue of rawIssues) {
    const broadMatch = issue.message.match(/covered by "([^"]+)"/);
    const key = broadMatch ? broadMatch[1] : issue.message;

    const group = groups.get(key) ?? [];
    group.push(issue);
    groups.set(key, group);
  }

  const result: LintIssue[] = [];

  for (const [broadPattern, groupIssues] of groups) {
    if (groupIssues.length <= 3) {
      // Small group — keep individual issues (not worth grouping)
      result.push(...groupIssues);
    } else {
      // Large group — collapse into single issue with sample evidence
      const sampleSize = 5;

      // Extract the narrow patterns from the individual issues
      const narrowPatterns = groupIssues.map(issue => {
        const match = issue.message.match(/Redundant permission: "([^"]+)"/);
        return match ? match[1] : 'unknown';
      });

      const samplePatterns = narrowPatterns.slice(0, sampleSize);
      const remaining = groupIssues.length - sampleSize;

      const evidence = [
        ...samplePatterns.map(p => ({
          file: groupIssues[0].file!,
          content: `${p} (redundant)`,
        })),
        {
          file: groupIssues[0].file!,
          content: remaining > 0
            ? `...and ${remaining} more patterns, all covered by "${broadPattern}"`
            : `All covered by "${broadPattern}"`,
        },
      ];

      result.push({
        ruleId: 'settings/redundant-permissions',
        severity: 'info',
        category: 'settings',
        message: `${groupIssues.length} permissions are redundant — all covered by "${broadPattern}" in ${groupIssues[0].file}.`,
        file: groupIssues[0].file,
        suggestion: `Remove the ${groupIssues.length} narrower patterns. The broad pattern "${broadPattern}" already covers them all.`,
        autoFixable: false,
        evidence,
      });
    }
  }

  return result;
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

    const rawIssues = [
      ...findRedundancies(allAllow),
      ...findRedundancies(allDeny),
    ];

    // Group issues by their broad (subsuming) pattern to reduce noise.
    // Instead of 67 issues for "X covered by mcp__*", emit 1 grouped issue.
    issues.push(...groupByBroadPattern(rawIssues));

    return issues;
  },
};
