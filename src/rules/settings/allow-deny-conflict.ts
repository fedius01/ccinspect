import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { readFileSync } from 'fs';

function existingFiles(files: (FileInfo | null)[]): FileInfo[] {
  return files.filter((f): f is FileInfo => f !== null && f.exists);
}

/** Extract tool name and optional glob from a permission pattern */
function parsePattern(pattern: string): { tool: string; glob: string | null } {
  const match = pattern.match(/^([\w*]+)\((.+)\)$/);
  if (match) {
    return { tool: match[1], glob: match[2] };
  }
  return { tool: pattern, glob: null };
}

export const allowDenyConflictRule: LintRule = {
  id: 'settings/allow-deny-conflict',
  description: 'Flag same or overlapping patterns in both allow and deny within a single settings file',
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
      try {
        const content = readFileSync(file.path, 'utf-8');
        const parsed = JSON.parse(content) as Record<string, unknown>;
        const perms = parsed.permissions as Record<string, unknown> | undefined;

        const allowList = Array.isArray(perms?.allow) ? (perms.allow as string[]) : [];
        const denyList = Array.isArray(perms?.deny) ? (perms.deny as string[]) : [];

        if (allowList.length === 0 || denyList.length === 0) {
          continue;
        }

        for (const allowEntry of allowList) {
          const allowParsed = parsePattern(allowEntry);

          for (const denyEntry of denyList) {
            const denyParsed = parsePattern(denyEntry);

            // Exact match: same pattern in both allow and deny
            if (allowEntry === denyEntry) {
              issues.push({
                ruleId: 'settings/allow-deny-conflict',
                severity: 'warning',
                category: 'settings',
                message: `Pattern "${allowEntry}" appears in both allow and deny in ${file.relativePath}. Deny takes precedence — the allow is ineffective.`,
                file: file.path,
                suggestion: 'Remove from allow if you intend to deny, or remove from deny if you intend to allow.',
                autoFixable: false,
              });
              continue;
            }

            // Bare tool in deny + scoped in allow → confusing (deny of bare overrides)
            // e.g. deny: "Bash", allow: "Bash(npm run *)" → flag
            if (denyParsed.glob === null && allowParsed.glob !== null && denyParsed.tool === allowParsed.tool) {
              issues.push({
                ruleId: 'settings/allow-deny-conflict',
                severity: 'warning',
                category: 'settings',
                message: `"${allowEntry}" in allow is overridden by bare deny "${denyEntry}" in ${file.relativePath}. The deny blocks all ${denyParsed.tool} usage — the scoped allow is ineffective.`,
                file: file.path,
                suggestion: `Remove "${allowEntry}" from allow, or replace "${denyEntry}" in deny with specific scoped patterns.`,
                autoFixable: false,
              });
              continue;
            }

            // Same bare MCP pattern in both allow and deny
            if (
              allowParsed.glob === null &&
              denyParsed.glob === null &&
              allowParsed.tool === denyParsed.tool &&
              allowParsed.tool.includes('__')
            ) {
              // This is already caught by exact match above, but let's be safe
              continue;
            }
          }
        }
      } catch {
        // skip unparseable files
      }
    }

    return issues;
  },
};
