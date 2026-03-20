import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { readFileSync } from 'fs';

const MIN_RECOMMENDED_DAYS = 90;

function existingFiles(files: (FileInfo | null)[]): FileInfo[] {
  return files.filter((f): f is FileInfo => f !== null && f.exists);
}

export const lowTranscriptRetentionRule: LintRule = {
  id: 'settings/low-transcript-retention',
  description: 'Warn when transcript retention (cleanupPeriodDays) is too low for effective auditing',
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

    // Look for cleanupPeriodDays across all settings levels
    let found = false;
    let effectiveValue: number | undefined;
    let effectiveSource: string | undefined;

    for (const file of settingsFiles) {
      try {
        const content = readFileSync(file.path, 'utf-8');
        const parsed = JSON.parse(content) as Record<string, unknown>;
        if ('cleanupPeriodDays' in parsed) {
          const value = parsed.cleanupPeriodDays;
          if (typeof value === 'number') {
            found = true;
            // Higher-precedence file wins (settingsFiles is in precedence order)
            if (effectiveValue === undefined) {
              effectiveValue = value;
              effectiveSource = file.path;
            }
          }
        }
      } catch {
        // skip unparseable files
      }
    }

    if (!found) {
      // Not set anywhere — default is 30 days, which is below recommended
      issues.push({
        ruleId: 'settings/low-transcript-retention',
        severity: 'info',
        category: 'settings',
        message: `cleanupPeriodDays is not set (default: 30 days). Short retention limits cci audit and cci history data.`,
        suggestion: `Set "cleanupPeriodDays": 99999 in ~/.claude/settings.json to retain transcripts indefinitely.`,
        autoFixable: false,
      });
      return issues;
    }

    // Value of 0 disables transcript writing entirely (CC bug #23710)
    if (effectiveValue === 0) {
      issues.push({
        ruleId: 'settings/low-transcript-retention',
        severity: 'warning',
        category: 'settings',
        message: `cleanupPeriodDays is 0 — this disables transcript writing entirely (Claude Code bug #23710).`,
        file: effectiveSource,
        suggestion: `Set "cleanupPeriodDays": 99999 to retain transcripts. A value of 0 prevents any transcript data from being written.`,
        autoFixable: false,
      });
      return issues;
    }

    if (effectiveValue! < MIN_RECOMMENDED_DAYS) {
      issues.push({
        ruleId: 'settings/low-transcript-retention',
        severity: 'info',
        category: 'settings',
        message: `cleanupPeriodDays is ${effectiveValue} (recommended: ≥${MIN_RECOMMENDED_DAYS}). Short retention limits cci audit and cci history data.`,
        file: effectiveSource,
        suggestion: `Set "cleanupPeriodDays": 99999 in ~/.claude/settings.json to retain transcripts indefinitely.`,
        autoFixable: false,
      });
    }

    return issues;
  },
};
