import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { readFileSync } from 'fs';

interface DangerousPattern {
  pattern: string;
  description: string;
  suggestion: string;
}

const DANGEROUS_PATTERNS: DangerousPattern[] = [
  {
    pattern: 'Bash',
    description: 'grants unrestricted shell access',
    suggestion: 'Consider scoping: Bash(npm run *), Bash(git *)',
  },
  {
    pattern: 'Write',
    description: 'allows writing to any file',
    suggestion: 'Consider scoping: Write(src/**)',
  },
  {
    pattern: 'Edit',
    description: 'allows editing any file',
    suggestion: 'Consider scoping: Edit(src/**)',
  },
  {
    pattern: 'Task',
    description: 'allows spawning any sub-agent',
    suggestion: 'Consider scoping: Task(AgentName)',
  },
];

function existingFiles(files: (FileInfo | null)[]): FileInfo[] {
  return files.filter((f): f is FileInfo => f !== null && f.exists);
}

function isBarePattern(allowEntry: string, pattern: string): boolean {
  return allowEntry === pattern;
}

function isMcpWildcard(allowEntry: string): boolean {
  return allowEntry === 'mcp__*';
}

export const dangerousAllowRule: LintRule = {
  id: 'settings/dangerous-allow',
  description: 'Flag overly permissive allow patterns that are security risks',
  severity: 'warning',
  category: 'settings',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

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

        if (!Array.isArray(perms?.allow)) {
          continue;
        }

        const allowList = perms.allow as string[];

        for (const entry of allowList) {
          // Check bare dangerous patterns
          for (const dangerous of DANGEROUS_PATTERNS) {
            if (isBarePattern(entry, dangerous.pattern)) {
              issues.push({
                ruleId: 'settings/dangerous-allow',
                severity: 'warning',
                category: 'settings',
                message: `Dangerous allow pattern "${entry}" ${dangerous.description}. ${dangerous.suggestion}`,
                file: file.path,
                suggestion: dangerous.suggestion,
                autoFixable: false,
              });
            }
          }

          // Check mcp__* wildcard
          if (isMcpWildcard(entry)) {
            issues.push({
              ruleId: 'settings/dangerous-allow',
              severity: 'warning',
              category: 'settings',
              message: `Dangerous allow pattern "mcp__*" allows all tools from all MCP servers. Consider scoping: mcp__servername__*`,
              file: file.path,
              suggestion: 'Consider scoping: mcp__servername__*',
              autoFixable: false,
            });
          }
        }
      } catch {
        // skip unparseable files
      }
    }

    return issues;
  },
};
