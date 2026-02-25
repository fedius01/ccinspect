import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { parseClaudeMd } from '../../parsers/claude-md.js';

const MAX_IMPORT_DEPTH = 5;

function existingFiles(files: (FileInfo | null)[]): FileInfo[] {
  return files.filter((f): f is FileInfo => f !== null && f.exists);
}

export const importDepthRule: LintRule = {
  id: 'memory/import-depth',
  description: 'Check @import recursion depth does not exceed maximum allowed depth',
  severity: 'error',
  category: 'memory',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig, options?: Record<string, unknown>): LintIssue[] {
    const issues: LintIssue[] = [];
    const maxDepth = (options?.maxDepth as number) ?? MAX_IMPORT_DEPTH;

    const claudeMdFiles = existingFiles([
      inventory.globalClaudeMd,
      inventory.projectClaudeMd,
      inventory.localClaudeMd,
      ...inventory.subdirClaudeMds,
    ]);

    for (const file of claudeMdFiles) {
      const parsed = parseClaudeMd(file.path);
      if (!parsed) {
        continue;
      }

      if (parsed.maxImportDepth > maxDepth) {
        issues.push({
          ruleId: 'memory/import-depth',
          severity: 'error',
          category: 'memory',
          message: `${file.relativePath} has @import chain depth of ${parsed.maxImportDepth} (max: ${maxDepth}). Deep import chains increase startup token load and can cause circular references.`,
          file: file.path,
          suggestion: `Flatten the import chain to at most ${maxDepth} levels. Consider consolidating deeply nested files.`,
          autoFixable: false,
        });
      }
    }

    return issues;
  },
};
