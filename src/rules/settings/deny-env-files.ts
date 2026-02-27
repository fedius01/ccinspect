import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { readFileSync } from 'fs';

const RECOMMENDED_DENY_PATTERNS = [
  'Read(./.env)',
  'Read(./.env.*)',
];

function existingFiles(files: (FileInfo | null)[]): FileInfo[] {
  return files.filter((f): f is FileInfo => f !== null && f.exists);
}

export const denyEnvFilesRule: LintRule = {
  id: 'settings/deny-env-files',
  description: 'Warn if .env files are not in deny rules',
  severity: 'warning',
  category: 'settings',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    // Collect all deny patterns from all settings levels
    const allDenyPatterns: string[] = [];

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
        if (Array.isArray(perms?.deny)) {
          allDenyPatterns.push(...(perms.deny as string[]));
        }
      } catch {
        // skip
      }
    }

    // Check if recommended patterns are present
    const missing = RECOMMENDED_DENY_PATTERNS.filter(
      (pattern) => !allDenyPatterns.some((deny) => deny === pattern || deny.includes('.env')),
    );

    if (missing.length > 0) {
      issues.push({
        ruleId: 'settings/deny-env-files',
        severity: 'warning',
        category: 'settings',
        message: `Missing deny rules for env files. Recommended patterns not found: ${missing.join(', ')}`,
        suggestion: `Add to your project settings.json: { "permissions": { "deny": [${missing.map((p) => '"' + p + '"').join(', ')}] } }`,
        autoFixable: true,
      });
    }

    return issues;
  },
};
