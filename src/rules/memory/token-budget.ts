import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';

const DEFAULT_WARN = 1800;
const DEFAULT_ERROR = 4500;

function existingFiles(files: (FileInfo | null)[]): FileInfo[] {
  return files.filter((f): f is FileInfo => f !== null && f.exists);
}

export const tokenBudgetRule: LintRule = {
  id: 'memory/token-budget',
  description: 'Check CLAUDE.md token count against recommended limits',
  severity: 'warning',
  category: 'memory',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig, options?: Record<string, unknown>): LintIssue[] {
    const issues: LintIssue[] = [];
    const warnThreshold = (options?.warn as number) ?? DEFAULT_WARN;
    const errorThreshold = (options?.error as number) ?? DEFAULT_ERROR;

    const claudeMdFiles = existingFiles([
      inventory.globalClaudeMd,
      inventory.projectClaudeMd,
      inventory.localClaudeMd,
      ...inventory.subdirClaudeMds,
    ]);

    for (const file of claudeMdFiles) {
      if (file.estimatedTokens > errorThreshold) {
        issues.push({
          ruleId: 'memory/token-budget',
          severity: 'error',
          category: 'memory',
          message: `${file.relativePath} uses ~${file.estimatedTokens} tokens (limit: ${errorThreshold}). This consumes significant context on every prompt.`,
          file: file.path,
          suggestion: `Optimize to <${warnThreshold} tokens. Remove generic instructions, use concise phrasing, move verbose docs elsewhere.`,
          autoFixable: false,
        });
      } else if (file.estimatedTokens > warnThreshold) {
        issues.push({
          ruleId: 'memory/token-budget',
          severity: 'warning',
          category: 'memory',
          message: `${file.relativePath} uses ~${file.estimatedTokens} tokens (recommended: <${warnThreshold}).`,
          file: file.path,
          suggestion: `Consider optimizing for fewer tokens. Each token in CLAUDE.md is consumed on every single prompt.`,
          autoFixable: false,
        });
      }
    }

    return issues;
  },
};
