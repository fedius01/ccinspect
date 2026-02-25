import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';
import { existsSync } from 'fs';
import { resolve, isAbsolute } from 'path';

export const hookScriptsExistRule: LintRule = {
  id: 'settings/hook-scripts-exist',
  description: 'Verify that hook command scripts exist on disk',
  severity: 'error',
  category: 'settings',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    for (const hook of inventory.hooks) {
      if (hook.type !== 'command' || !hook.command) {
        continue;
      }

      // Extract the actual script/binary from the command string
      // The command may include arguments, so take the first token
      const commandTokens = hook.command.trim().split(/\s+/);
      const scriptPath = commandTokens[0];

      // Resolve relative paths against project root
      const resolvedPath = isAbsolute(scriptPath)
        ? scriptPath
        : resolve(inventory.projectRoot, scriptPath);

      if (!existsSync(resolvedPath)) {
        issues.push({
          ruleId: 'settings/hook-scripts-exist',
          severity: 'error',
          category: 'settings',
          message: `Hook "${hook.event}/${hook.matcher}" references command "${hook.command}" but the script was not found at "${resolvedPath}".`,
          file: hook.source,
          suggestion: `Hook script '${hook.command}' not found. Create the script or update the hook configuration.`,
          autoFixable: false,
        });
      }
    }

    return issues;
  },
};
