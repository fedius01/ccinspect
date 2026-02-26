import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { readFileSync } from 'fs';

const KNOWN_FIELDS = new Set([
  'permissions',
  'sandbox',
  'env',
  'hooks',
  'model',
  'mcpServers',
  'allowedTools',
  'enableAllProjectMcpServers',
  'enableMcpServerCreation',
  'apiKeyHelper',
  'cliAutoUpdaterStatus',
  'projects',
  'autoUpdaterStatus',
  'customApiKeyResponses',
  'hasCompletedOnboarding',
  'lastOnboardingVersion',
  'oauthAccount',
  'numStartups',
  'theme',
  'lastReleaseNotesSeen',
  'preferredNotifChannel',
  'plugins',
  'enabledPlugins',
  'feedbackSurveyState',
]);

const COMMON_TYPOS: Record<string, string> = {
  'sandbox': 'sandbox',
  'sandBox': 'sandbox',
  'Sandbox': 'sandbox',
  'SANDBOX': 'sandbox',
  'permission': 'permissions',
  'Permission': 'permissions',
  'Permissions': 'permissions',
  'mcpservers': 'mcpServers',
  'mcpServer': 'mcpServers',
  'MCP_Servers': 'mcpServers',
  'mcpserver': 'mcpServers',
  'Mcpservers': 'mcpServers',
  'allowedTool': 'allowedTools',
  'AllowedTools': 'allowedTools',
  'allowed_tools': 'allowedTools',
  'hook': 'hooks',
  'Hook': 'hooks',
  'Hooks': 'hooks',
  'envs': 'env',
  'environment': 'env',
  'models': 'model',
  'Model': 'model',
  'plugin': 'plugins',
  'Plugin': 'plugins',
  'Plugins': 'plugins',
};

function existingFiles(files: (FileInfo | null)[]): FileInfo[] {
  return files.filter((f): f is FileInfo => f !== null && f.exists);
}

function findClosestField(field: string): string | null {
  // Check common typos first
  if (COMMON_TYPOS[field]) {
    return COMMON_TYPOS[field];
  }

  // Simple case-insensitive match
  const lower = field.toLowerCase();
  for (const known of KNOWN_FIELDS) {
    if (known.toLowerCase() === lower) {
      return known;
    }
  }

  // Simple Levenshtein-like check: fields within edit distance 2
  for (const known of KNOWN_FIELDS) {
    if (levenshtein(lower, known.toLowerCase()) <= 2) {
      return known;
    }
  }

  return null;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array.from({ length: n + 1 }, () => 0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  return dp[m][n];
}

export const unknownFieldsRule: LintRule = {
  id: 'settings/unknown-fields',
  description: 'Flag unknown top-level keys in settings.json files that are likely typos',
  severity: 'warning',
  category: 'settings',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    // Check all settings files but NOT preferences (~/.claude.json)
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

        for (const key of Object.keys(parsed)) {
          if (!KNOWN_FIELDS.has(key)) {
            const closest = findClosestField(key);
            const didYouMean = closest ? ` Did you mean "${closest}"?` : '';

            issues.push({
              ruleId: 'settings/unknown-fields',
              severity: 'warning',
              category: 'settings',
              message: `Unknown field "${key}" in ${file.relativePath}.${didYouMean}`,
              file: file.path,
              suggestion: closest
                ? `Rename "${key}" to "${closest}".`
                : `Remove unknown field "${key}" or check Claude Code documentation for valid settings.`,
              autoFixable: false,
            });
          }
        }
      } catch {
        // skip unparseable files
      }
    }

    return issues;
  },
};
