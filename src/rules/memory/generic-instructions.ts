import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { parseClaudeMd } from '../../parsers/claude-md.js';

function existingFiles(files: (FileInfo | null)[]): FileInfo[] {
  return files.filter((f): f is FileInfo => f !== null && f.exists);
}

export const genericInstructionsRule: LintRule = {
  id: 'memory/generic-instructions',
  description: 'Detect vague or generic instructions in CLAUDE.md files',
  severity: 'warning',
  category: 'memory',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig, options?: Record<string, unknown>): LintIssue[] {
    const issues: LintIssue[] = [];

    const extraPatterns = (options?.extraPatterns as string[] | undefined) ?? [];
    const ignorePatterns = (options?.ignorePatterns as string[] | undefined) ?? [];
    const ignoreSet = new Set(ignorePatterns.map((p) => p.toLowerCase()));

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

      // Check built-in generic instructions from the parser
      for (const instruction of parsed.genericInstructions) {
        // Skip if the instruction text matches any ignore pattern
        const lowerText = instruction.text.toLowerCase();
        if (ignoreSet.size > 0 && [...ignoreSet].some((pattern) => lowerText.includes(pattern))) {
          continue;
        }

        issues.push({
          ruleId: 'memory/generic-instructions',
          severity: 'warning',
          category: 'memory',
          message: `Generic instruction found in ${file.relativePath} at line ${instruction.line}: "${instruction.text}"`,
          file: file.path,
          line: instruction.line,
          suggestion: 'Remove vague instruction and replace with specific, actionable guidance',
          autoFixable: false,
        });
      }

      // Check extra patterns provided via options
      if (extraPatterns.length > 0) {
        const lines = parsed.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const lowerLine = lines[i].toLowerCase();
          for (const pattern of extraPatterns) {
            if (lowerLine.includes(pattern.toLowerCase())) {
              const lineText = lines[i].trim().replace(/^[-*]\s*/, '');

              // Skip if matches ignore patterns
              if (ignoreSet.size > 0 && [...ignoreSet].some((ip) => lowerLine.includes(ip))) {
                continue;
              }

              issues.push({
                ruleId: 'memory/generic-instructions',
                severity: 'warning',
                category: 'memory',
                message: `Generic instruction found in ${file.relativePath} at line ${i + 1}: "${lineText}"`,
                file: file.path,
                line: i + 1,
                suggestion: 'Remove vague instruction and replace with specific, actionable guidance',
                autoFixable: false,
              });
              break; // one match per line is enough
            }
          }
        }
      }
    }

    return issues;
  },
};
