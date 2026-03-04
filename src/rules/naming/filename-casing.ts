import { basename } from 'path';

import type { LintRule, LintIssue, ConfigInventory } from '../../types/index.js';
import type { ResolvedConfig } from '../../types/resolved.js';
import type { ConfigFileType, FileInfo } from '../../types/index.js';
import { getExpectedFilenames } from '../../utils/file-classifier.js';

interface SlotDef {
  getFiles: (inv: ConfigInventory) => (FileInfo | null)[];
  fileType: ConfigFileType;
}

const SLOTS_TO_CHECK: SlotDef[] = [
  { getFiles: inv => [inv.projectClaudeMd], fileType: 'claude-md' },
  { getFiles: inv => [inv.localClaudeMd], fileType: 'claude-md' },
  { getFiles: inv => [inv.globalClaudeMd], fileType: 'claude-md' },
  { getFiles: inv => inv.subdirClaudeMds, fileType: 'claude-md' },
  { getFiles: inv => [inv.autoMemory], fileType: 'claude-md' },
  { getFiles: inv => [inv.projectSettings], fileType: 'settings-json' },
  { getFiles: inv => [inv.localSettings], fileType: 'settings-json' },
  { getFiles: inv => [inv.userSettings], fileType: 'settings-json' },
  { getFiles: inv => [inv.projectMcp], fileType: 'mcp-json' },
  { getFiles: inv => inv.projectSkills, fileType: 'skill-md' },
];

export const filenameCasingRule: LintRule = {
  id: 'naming/filename-casing',
  description: 'Config file has incorrect casing — Claude Code won\'t recognize it',
  severity: 'warning',
  category: 'naming',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    for (const slot of SLOTS_TO_CHECK) {
      const files = slot.getFiles(inventory);
      const expectedNames = getExpectedFilenames(slot.fileType);
      if (expectedNames.length === 0) continue;

      for (const fileInfo of files) {
        if (!fileInfo || !fileInfo.exists) continue;

        const actualName = basename(fileInfo.path);

        // Already correctly named — skip
        if (expectedNames.includes(actualName)) continue;

        // Check if it's a casing mismatch (same name modulo casing)
        const expected = expectedNames.find(
          e => e.toLowerCase() === actualName.toLowerCase(),
        );
        if (expected) {
          issues.push({
            ruleId: 'naming/filename-casing',
            severity: 'warning',
            category: 'naming',
            message: `File "${actualName}" has incorrect casing — Claude Code expects "${expected}"`,
            file: fileInfo.path,
            suggestion: `Rename "${actualName}" to "${expected}" so Claude Code recognizes it`,
            autoFixable: false,
            evidence: [{
              file: fileInfo.path,
              content: `Actual: ${actualName} → Expected: ${expected}`,
            }],
          });
        }
      }
    }

    return issues;
  },
};
