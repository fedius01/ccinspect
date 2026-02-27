import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { readFileSync } from 'fs';

interface SensitivePathGroup {
  name: string;
  patterns: string[];
  description: string;
}

const SENSITIVE_PATH_GROUPS: SensitivePathGroup[] = [
  {
    name: 'SSH credentials',
    patterns: ['Read(./.ssh/**)', 'Write(./.ssh/**)'],
    description: 'SSH keys and configuration',
  },
  {
    name: 'AWS credentials',
    patterns: ['Read(./.aws/**)', 'Write(./.aws/**)'],
    description: 'AWS access keys and configuration',
  },
  {
    name: 'GCloud credentials',
    patterns: ['Read(./.config/gcloud/**)', 'Write(./.config/gcloud/**)'],
    description: 'Google Cloud credentials',
  },
  {
    name: '.gitignore files from modification',
    patterns: ['Write(**/.gitignore)'],
    description: '.gitignore modifications could expose sensitive files',
  },
  {
    name: '.npmrc from modification',
    patterns: ['Write(./.npmrc)'],
    description: '.npmrc may contain auth tokens',
  },
];

function existingFiles(files: (FileInfo | null)[]): FileInfo[] {
  return files.filter((f): f is FileInfo => f !== null && f.exists);
}

function isPatternCovered(pattern: string, denyList: string[]): boolean {
  // Exact match
  if (denyList.includes(pattern)) {
    return true;
  }

  // Check if a broader pattern covers it
  // Extract the tool and path: "Read(./.ssh/**)" → tool="Read", path="./.ssh/**"
  const match = pattern.match(/^(\w+)\((.+)\)$/);
  if (!match) {
    return false;
  }

  const [, tool, path] = match;

  for (const deny of denyList) {
    const denyMatch = deny.match(/^(\w+)\((.+)\)$/);
    if (!denyMatch) {
      continue;
    }

    const [, denyTool, denyPath] = denyMatch;

    // Same tool with a broader path
    if (denyTool === tool) {
      // "Read(**)" covers "Read(./.ssh/**)"
      if (denyPath === '**' || denyPath === '.**' || denyPath === './**') {
        return true;
      }

      // "Read(./.*)" covers "Read(./.ssh/**)"
      if (denyPath === './.**' || denyPath === '.**') {
        return true;
      }

      // Direct parent glob: "Read(./.ssh/*)" or "Read(./.ssh/**)" covers "Read(./.ssh/**)"
      if (denyPath === path) {
        return true;
      }
    }

    // Bare tool name covers everything: "Read" covers "Read(./.ssh/**)"
    if (deny === tool) {
      return true;
    }
  }

  return false;
}

export const denySensitivePathsRule: LintRule = {
  id: 'settings/deny-sensitive-paths',
  description: 'Recommend deny rules for sensitive credential paths',
  severity: 'info',
  category: 'settings',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    // Collect all deny patterns from all settings levels
    const allDenyPatterns: string[] = [];

    const settingsFiles = existingFiles([
      inventory.managedSettings,
      inventory.localSettings,
      inventory.projectSettings,
      inventory.userSettings,
    ]);

    for (const file of settingsFiles) {
      try {
        const content = readFileSync(file.path, 'utf-8');
        const parsed = JSON.parse(content) as Record<string, unknown>;
        const perms = parsed.permissions as Record<string, unknown> | undefined;
        if (Array.isArray(perms?.deny)) {
          allDenyPatterns.push(...(perms.deny as string[]));
        }
      } catch {
        // skip
      }
    }

    // Check each sensitive path group
    for (const group of SENSITIVE_PATH_GROUPS) {
      const missingPatterns = group.patterns.filter(
        (pattern) => !isPatternCovered(pattern, allDenyPatterns),
      );

      if (missingPatterns.length === group.patterns.length) {
        // All patterns missing — report the group
        issues.push({
          ruleId: 'settings/deny-sensitive-paths',
          severity: 'info',
          category: 'settings',
          message: `No deny rule protects ${group.name}. Consider adding: ${group.patterns.join(', ')}`,
          suggestion: `Add to your settings.json deny list: ${group.patterns.map((p) => '"' + p + '"').join(', ')}`,
          autoFixable: false,
        });
      }
    }

    return issues;
  },
};
