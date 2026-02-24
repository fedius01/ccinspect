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

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    const claudeMdFiles = existingFiles([
      inventory.globalClaudeMd,
      inventory.projectClaudeMd,
      inventory.localClaudeMd,
      ...inventory.subdirClaudeMds,
    ]);

    for (const file of claudeMdFiles) {
      if (file.estimatedTokens > DEFAULT_ERROR) {
        issues.push({
          ruleId: 'memory/token-budget',
          severity: 'error',
          category: 'memory',
          message: `${file.relativePath} uses ~${file.estimatedTokens} tokens (limit: ${DEFAULT_ERROR}). This consumes significant context on every prompt.`,
          file: file.path,
          suggestion: `Optimize to <${DEFAULT_WARN} tokens. Remove generic instructions, use concise phrasing, move verbose docs elsewhere.`,
          autoFixable: false,
        });
      } else if (file.estimatedTokens > DEFAULT_WARN) {
        issues.push({
          ruleId: 'memory/token-budget',
          severity: 'warning',
          category: 'memory',
          message: `${file.relativePath} uses ~${file.estimatedTokens} tokens (recommended: <${DEFAULT_WARN}).`,
          file: file.path,
          suggestion: `Consider optimizing for fewer tokens. Each token in CLAUDE.md is consumed on every single prompt.`,
          autoFixable: false,
        });
      }
    }

    return issues;
  },
};
