import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';

const DEFAULT_WARN = 5000;
const DEFAULT_ERROR = 10000;
const SYSTEM_OVERHEAD = 500;

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

    if (totalWithOverhead > errorThreshold) {
      issues.push({
        ruleId: 'budget/startup-load',
        severity: 'error',
        category: 'budget',
        message: `Total startup token load is ~${totalWithOverhead} tokens (limit: ${errorThreshold}). This significantly reduces available context for actual work.`,
        suggestion: `Reduce startup-loaded files. Current breakdown: ${inventory.totalStartupTokens} file tokens + ${SYSTEM_OVERHEAD} system overhead. Consider trimming CLAUDE.md files and MEMORY.md.`,
        autoFixable: false,
      });
    } else if (totalWithOverhead > warnThreshold) {
      issues.push({
        ruleId: 'budget/startup-load',
        severity: 'warning',
        category: 'budget',
        message: `Total startup token load is ~${totalWithOverhead} tokens (recommended: <${warnThreshold}).`,
        suggestion: `Consider optimizing your startup-loaded files to free up context for actual work.`,
        autoFixable: false,
      });
    }

    return issues;
  },
};
