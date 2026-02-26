import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { readFileSync, existsSync } from 'fs';
import { dirname, resolve, isAbsolute } from 'path';
import fg from 'fast-glob';

function existingFiles(files: (FileInfo | null)[]): FileInfo[] {
  return files.filter((f): f is FileInfo => f !== null && f.exists);
}

/** Check if a path looks like a URL */
function isUrl(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://');
}

/** Check if a path contains glob characters */
function isGlob(path: string): boolean {
  return path.includes('*') || path.includes('?') || path.includes('{');
}

export const staleImportsRule: LintRule = {
  id: 'memory/stale-imports',
  description: 'Flag @import directives in CLAUDE.md that point to non-existent files',
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
      try {
        const content = readFileSync(file.path, 'utf-8');
        const lines = content.split('\n');
        const dir = dirname(file.path);

        for (let i = 0; i < lines.length; i++) {
          // Match @import or @ followed by a relative/absolute path to a .md file
          // The Claude Code import syntax: @filepath.md or @./path/to/file.md
          const importMatch = lines[i].match(/@([\w./-]+\.md)\b/);
          if (!importMatch) continue;

          const importPath = importMatch[1];

          // Skip URLs
          if (isUrl(importPath)) continue;

          // Resolve the path relative to the CLAUDE.md file's directory
          const resolvedPath = isAbsolute(importPath) ? importPath : resolve(dir, importPath);

          if (isGlob(importPath)) {
            // For glob imports, check if any files match
            try {
              const matches = fg.sync(resolvedPath, { onlyFiles: true });
              if (matches.length === 0) {
                issues.push({
                  ruleId: 'memory/stale-imports',
                  severity: 'warning',
                  category: 'memory',
                  message: `Broken import in ${file.relativePath}: @${importPath} — no files match the glob pattern.`,
                  file: file.path,
                  line: i + 1,
                  suggestion: 'Update the import path or remove the @import directive. The imported content will not be loaded.',
                  autoFixable: false,
                });
              }
            } catch {
              // glob parse error, skip
            }
          } else {
            // Regular file path — check existence
            if (!existsSync(resolvedPath)) {
              issues.push({
                ruleId: 'memory/stale-imports',
                severity: 'warning',
                category: 'memory',
                message: `Broken import in ${file.relativePath}: @${importPath} — file not found.`,
                file: file.path,
                line: i + 1,
                suggestion: 'Update the import path or remove the @import directive. The imported content will not be loaded.',
                autoFixable: false,
              });
            }
          }
        }
      } catch {
        // skip unreadable files
      }
    }

    return issues;
  },
};
