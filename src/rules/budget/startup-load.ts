import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';

const DEFAULT_WARN = 5000;
const DEFAULT_ERROR = 10000;
const SYSTEM_OVERHEAD = 500;

export const startupLoadRule: LintRule = {
  id: 'budget/startup-load',
  description: 'Check total startup token load against recommended limits',
  severity: 'warning',
  category: 'budget',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    const totalWithOverhead = inventory.totalStartupTokens + SYSTEM_OVERHEAD;

    if (totalWithOverhead > DEFAULT_ERROR) {
      issues.push({
        ruleId: 'budget/startup-load',
        severity: 'error',
        category: 'budget',
        message: `Total startup token load is ~${totalWithOverhead} tokens (limit: ${DEFAULT_ERROR}). This significantly reduces available context for actual work.`,
        suggestion: `Reduce startup-loaded files. Current breakdown: ${inventory.totalStartupTokens} file tokens + ${SYSTEM_OVERHEAD} system overhead. Consider trimming CLAUDE.md files and MEMORY.md.`,
        autoFixable: false,
      });
    } else if (totalWithOverhead > DEFAULT_WARN) {
      issues.push({
        ruleId: 'budget/startup-load',
        severity: 'warning',
        category: 'budget',
        message: `Total startup token load is ~${totalWithOverhead} tokens (recommended: <${DEFAULT_WARN}).`,
        suggestion: `Consider optimizing your startup-loaded files to free up context for actual work.`,
        autoFixable: false,
      });
    }

    return issues;
  },
};
