import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

interface LocalFile {
  relativePath: string;
  description: string;
}

const LOCAL_FILES: LocalFile[] = [
  {
    relativePath: '.claude/settings.local.json',
    description: 'Local settings contain machine-specific config and should be gitignored',
  },
  {
    relativePath: 'CLAUDE.local.md',
    description: 'Local memory contains personal preferences and should be gitignored',
  },
];

function isGitTracked(filePath: string, gitRoot: string): boolean {
  try {
    execSync(`git ls-files --error-unmatch "${filePath}"`, {
      cwd: gitRoot,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

export const localSettingsTrackedRule: LintRule = {
  id: 'git/local-settings-tracked',
  description: 'Warn if local-scope config files are tracked in git',
  severity: 'warning',
  category: 'git',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    // Skip if not a git repo
    if (!inventory.gitRoot) {
      return issues;
    }

    for (const localFile of LOCAL_FILES) {
      const absolutePath = join(inventory.projectRoot, localFile.relativePath);

      // Only check files that exist
      if (!existsSync(absolutePath)) {
        continue;
      }

      if (isGitTracked(absolutePath, inventory.gitRoot)) {
        issues.push({
          ruleId: 'git/local-settings-tracked',
          severity: 'warning',
          category: 'git',
          message: `${localFile.relativePath} is tracked in git. ${localFile.description}.`,
          file: absolutePath,
          suggestion: `Add to .gitignore: ${localFile.relativePath}`,
          autoFixable: false,
        });
      }
    }

    return issues;
  },
};
