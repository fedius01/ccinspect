import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { parseClaudeMd } from '../../parsers/claude-md.js';
import { estimateTokens } from '../../utils/tokens.js';
import { readFileSync } from 'fs';

const DEFAULT_TOKEN_THRESHOLD = 500;
const DEFAULT_PERCENT_THRESHOLD = 40;
const DEFAULT_MIN_FILE_TOKENS = 200;

function existingFiles(files: (FileInfo | null)[]): FileInfo[] {
  return files.filter((f): f is FileInfo => f !== null && f.exists);
}

export const sectionTooLargeRule: LintRule = {
  id: 'memory/section-too-large',
  description: 'Flag individual CLAUDE.md sections that consume a disproportionate amount of tokens',
  severity: 'info',
  category: 'memory',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig, options?: Record<string, unknown>): LintIssue[] {
    const issues: LintIssue[] = [];
    const tokenThreshold = (options?.tokenThreshold as number) ?? DEFAULT_TOKEN_THRESHOLD;
    const percentThreshold = (options?.percentThreshold as number) ?? DEFAULT_PERCENT_THRESHOLD;
    const minFileTokens = (options?.minFileTokens as number) ?? DEFAULT_MIN_FILE_TOKENS;

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

      // Skip files under minimum token threshold
      if (parsed.tokenCount < minFileTokens) {
        continue;
      }

      // Skip files with only one section or no sections
      if (parsed.sections.length <= 1) {
        continue;
      }

      // Read file content to extract section text
      let content: string;
      try {
        content = readFileSync(file.path, 'utf-8');
      } catch {
        continue;
      }
      const lines = content.split('\n');

      for (const section of parsed.sections) {
        // Extract section text (lineStart and lineEnd are 1-indexed)
        const sectionLines = lines.slice(section.lineStart - 1, section.lineEnd);
        const sectionText = sectionLines.join('\n');
        const sectionTokens = estimateTokens(sectionText);
        const percentOfFile = Math.round((sectionTokens / parsed.tokenCount) * 100);

        const exceedsTokens = sectionTokens > tokenThreshold;
        const exceedsPercent = percentOfFile > percentThreshold;

        if (exceedsTokens || exceedsPercent) {
          issues.push({
            ruleId: 'memory/section-too-large',
            severity: 'info',
            category: 'memory',
            message: `Section "${'#'.repeat(section.level)} ${section.heading}" in ${file.relativePath} is ${sectionTokens.toLocaleString()} tokens (${percentOfFile}% of file). Large sections waste context when unrelated code is being edited.`,
            file: file.path,
            line: section.lineStart,
            suggestion: 'Consider extracting this section to a scoped rule file in .claude/rules/ with a paths filter, or to a separate file and @import it.',
            autoFixable: false,
          });
        }
      }
    }

    return issues;
  },
};
