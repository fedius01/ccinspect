import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';

const DEFAULT_WARN = 150;
const DEFAULT_ERROR = 300;

function existingFiles(files: (FileInfo | null)[]): FileInfo[] {
  return files.filter((f): f is FileInfo => f !== null && f.exists);
}

export const lineCountRule: LintRule = {
  id: 'memory/line-count',
  description: 'Check CLAUDE.md line count against recommended limits',
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
      if (file.lineCount > DEFAULT_ERROR) {
        issues.push({
          ruleId: 'memory/line-count',
          severity: 'error',
          category: 'memory',
          message: `${file.relativePath} has ${file.lineCount} lines (limit: ${DEFAULT_ERROR}). Instruction-following degrades significantly beyond this.`,
          file: file.path,
          suggestion: `Reduce to <${DEFAULT_WARN} lines. Move detailed docs to separate files and use @imports.`,
          autoFixable: false,
        });
      } else if (file.lineCount > DEFAULT_WARN) {
        issues.push({
          ruleId: 'memory/line-count',
          severity: 'warning',
          category: 'memory',
          message: `${file.relativePath} has ${file.lineCount} lines (recommended: <${DEFAULT_WARN}).`,
          file: file.path,
          suggestion: `Consider moving verbose sections to docs/ and referencing via @imports.`,
          autoFixable: false,
        });
      }
    }

    return issues;
  },
};
