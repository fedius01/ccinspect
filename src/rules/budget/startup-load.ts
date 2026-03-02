import type { LintRule, LintIssue, LintEvidence, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';

const DEFAULT_WARN = 5000;
const DEFAULT_ERROR = 10000;
const SYSTEM_OVERHEAD = 500;
const MAX_EVIDENCE_FILES = 10;

function collectStartupFiles(inventory: ConfigInventory): Array<{ path: string; relativePath: string; tokens: number }> {
  const files: Array<{ path: string; relativePath: string; tokens: number }> = [];
  const startupSources: (FileInfo | null)[] = [
    inventory.globalClaudeMd,
    inventory.projectClaudeMd,
    inventory.localClaudeMd,
  ];
  for (const f of startupSources) {
    if (f && f.exists && f.estimatedTokens > 0) {
      files.push({ path: f.path, relativePath: f.relativePath, tokens: f.estimatedTokens });
    }
  }
  if (inventory.autoMemory?.exists && inventory.autoMemory.estimatedTokens > 0) {
    files.push({
      path: inventory.autoMemory.path,
      relativePath: inventory.autoMemory.relativePath,
      tokens: inventory.autoMemory.estimatedTokens,
    });
  }
  return files.sort((a, b) => b.tokens - a.tokens);
}

export const startupLoadRule: LintRule = {
  id: 'budget/startup-load',
  description: 'Check total startup token load against recommended limits',
  severity: 'warning',
  category: 'budget',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig, options?: Record<string, unknown>): LintIssue[] {
    const issues: LintIssue[] = [];
    const warnThreshold = (options?.warn as number) ?? DEFAULT_WARN;
    const errorThreshold = (options?.error as number) ?? DEFAULT_ERROR;

    const totalWithOverhead = inventory.totalStartupTokens + SYSTEM_OVERHEAD;

    if (totalWithOverhead > errorThreshold || totalWithOverhead > warnThreshold) {
      const startupFiles = collectStartupFiles(inventory);
      const evidence: LintEvidence[] = startupFiles
        .slice(0, MAX_EVIDENCE_FILES)
        .map(f => ({
          file: f.path,
          content: `${f.tokens} tokens`,
        }));

      if (totalWithOverhead > errorThreshold) {
        issues.push({
          ruleId: 'budget/startup-load',
          severity: 'error',
          category: 'budget',
          message: `Total startup token load is ~${totalWithOverhead} tokens (limit: ${errorThreshold}). This significantly reduces available context for actual work.`,
          suggestion: `Reduce startup-loaded files. Current breakdown: ${inventory.totalStartupTokens} file tokens + ${SYSTEM_OVERHEAD} system overhead. Consider trimming CLAUDE.md files and MEMORY.md.`,
          autoFixable: false,
          evidence: evidence.length > 0 ? evidence : undefined,
        });
      } else {
        issues.push({
          ruleId: 'budget/startup-load',
          severity: 'warning',
          category: 'budget',
          message: `Total startup token load is ~${totalWithOverhead} tokens (recommended: <${warnThreshold}).`,
          suggestion: `Consider optimizing your startup-loaded files to free up context for actual work.`,
          autoFixable: false,
          evidence: evidence.length > 0 ? evidence : undefined,
        });
      }
    }

    return issues;
  },
};
