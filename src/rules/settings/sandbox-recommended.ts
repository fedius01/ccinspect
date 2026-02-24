import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { readFileSync } from 'fs';

function existingFiles(files: (FileInfo | null)[]): FileInfo[] {
  return files.filter((f): f is FileInfo => f !== null && f.exists);
}

export const sandboxRecommendedRule: LintRule = {
  id: 'settings/sandbox-recommended',
  description: 'Warn if sandbox is not enabled in any settings level',
  severity: 'warning',
  category: 'settings',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    // Check all settings files for sandbox.enabled
    const settingsFiles = existingFiles([
      inventory.managedSettings,
      inventory.localSettings,
      inventory.projectSettings,
      inventory.userSettings,
    ]);

    let sandboxEnabled = false;

    for (const file of settingsFiles) {
      try {
        const content = readFileSync(file.path, 'utf-8');
        const parsed = JSON.parse(content) as Record<string, unknown>;
        const sandbox = parsed.sandbox as Record<string, unknown> | undefined;
        if (sandbox?.enabled === true) {
          sandboxEnabled = true;
          break;
        }
      } catch {
        // skip unparseable files
      }
    }

    if (!sandboxEnabled) {
      issues.push({
        ruleId: 'settings/sandbox-recommended',
        severity: 'warning',
        category: 'settings',
        message: 'Sandbox is not enabled. Without sandbox, deny rules only block built-in tools — Bash commands can bypass them.',
        suggestion: 'Enable sandbox in your settings: { "sandbox": { "enabled": true } }',
        autoFixable: false,
      });
    }

    return issues;
  },
};
