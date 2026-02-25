import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';

const DEFAULT_MAX_LINES = 200;

export const autoMemorySizeRule: LintRule = {
  id: 'memory/auto-memory-size',
  description: 'Check MEMORY.md line count since only the first 200 lines are loaded at startup',
  severity: 'warning',
  category: 'memory',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig, options?: Record<string, unknown>): LintIssue[] {
    const issues: LintIssue[] = [];
    const maxLines = (options?.maxLines as number) ?? DEFAULT_MAX_LINES;

    if (!inventory.autoMemory || !inventory.autoMemory.exists) {
      return issues;
    }

    if (inventory.autoMemory.lineCount > maxLines) {
      issues.push({
        ruleId: 'memory/auto-memory-size',
        severity: 'warning',
        category: 'memory',
        message: `MEMORY.md has ${inventory.autoMemory.lineCount} lines but only the first ${maxLines} lines are loaded at startup. Content beyond line ${maxLines} will not be visible to Claude.`,
        file: inventory.autoMemory.path,
        suggestion: `Keep MEMORY.md under ${maxLines} lines. Move older or less important entries to topic-specific memory files.`,
        autoFixable: false,
      });
    }

    return issues;
  },
};
