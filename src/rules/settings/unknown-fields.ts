import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { readFileSync } from 'fs';

// Source: https://json.schemastore.org/claude-code-settings.json (retrieved 2026-03-01)
// Update this list when Claude Code adds new settings fields.
const KNOWN_FIELDS = new Set([
  '$schema',
  'apiKeyHelper',
  'attribution',
  'allowManagedHooksOnly',
  'allowManagedMcpServersOnly',
  'allowManagedPermissionRulesOnly',
  'allowedMcpServers',
  'alwaysThinkingEnabled',
  'autoMemoryEnabled',
  'autoUpdatesChannel',
  'availableModels',
  'awsAuthRefresh',
  'awsCredentialExport',
  'blockedMarketplaces',
  'cleanupPeriodDays',
  'companyAnnouncements',
  'deniedMcpServers',
  'disableAllHooks',
  'disabledMcpjsonServers',
  'effortLevel',
  'enableAllProjectMcpServers',
  'enabledMcpjsonServers',
  'enabledPlugins',
  'env',
  'extraKnownMarketplaces',
  'fastMode',
  'fileSuggestion',
  'forceLoginMethod',
  'forceLoginOrgUUID',
  'hooks',
  'includeCoAuthoredBy',
  'language',
  'model',
  'otelHeadersHelper',
  'outputStyle',
  'permissions',
  'plansDirectory',
  'pluginConfigs',
  'prefersReducedMotion',
  'respectGitignore',
  'sandbox',
  'showTurnDuration',
  'skipWebFetchPreflight',
  'skippedMarketplaces',
  'skippedPlugins',
  'spinnerTipsEnabled',
  'spinnerTipsOverride',
  'spinnerVerbs',
  'statusLine',
  'strictKnownMarketplaces',
  'teammateMode',
  'terminalProgressBarEnabled',
]);

const COMMON_TYPOS: Record<string, string> = {
  'sandBox': 'sandbox',
  'Sandbox': 'sandbox',
  'SANDBOX': 'sandbox',
  'permission': 'permissions',
  'Permission': 'permissions',
  'Permissions': 'permissions',
  'hook': 'hooks',
  'Hook': 'hooks',
  'Hooks': 'hooks',
  'envs': 'env',
  'environment': 'env',
  'models': 'model',
  'Model': 'model',
  'enabledplugins': 'enabledPlugins',
  'enabled_plugins': 'enabledPlugins',
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

function valuePreview(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return `"${value.length > 50 ? value.slice(0, 47) + '...' : value}"`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[...] (${value.length} items)`;
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    return `{ ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', ...' : ''} } (${keys.length} keys)`;
  }
  return String(value);
}

export const unknownFieldsRule: LintRule = {
  id: 'settings/unknown-fields',
  description: 'Flag unknown top-level keys in settings.json files that are likely typos',
  severity: 'warning',
  category: 'settings',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    // Only lint project-scoped settings files (hand-authored, typos possible).
    // User (~/.claude/settings.json) and managed (enterprise) settings are
    // client-managed — fields are written by tools, not typed by humans.
    const settingsFiles = existingFiles([
      inventory.projectSettings,
      inventory.localSettings,
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
              evidence: [{
                file: file.path,
                content: `"${key}": ${valuePreview(parsed[key])}`,
              }],
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
