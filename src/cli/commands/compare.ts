import type { Command } from 'commander';
import { resolve as resolvePath } from 'path';
import { existsSync, statSync } from 'fs';
import { scan } from '../../core/scanner.js';
import { resolve } from '../../core/resolver.js';
import type { ParsedConfigLayers } from '../../core/resolver.js';
import type { ResolvedConfig } from '../../types/index.js';
import { createExcluder } from '../../utils/excluder.js';
import { parseSettingsJson } from '../../parsers/settings-json.js';
import { parseMcpJson } from '../../parsers/mcp-json.js';
import { printComparison, printComparisonJson } from '../output/terminal.js';

export interface ProjectComparison {
  dir: string;
  resolved: ResolvedConfig;
  totalFiles: number;
  totalStartupTokens: number;
}

function scanAndResolve(projectDir: string, cliPatterns: string[] = []): ProjectComparison {
  const resolvedProjectDir = resolvePath(projectDir);
  const excluder = createExcluder(resolvedProjectDir, { cliPatterns });
  const inventory = scan({ projectDir, excluder });

  const layers: ParsedConfigLayers = {
    userSettings: inventory.userSettings?.exists
      ? parseSettingsJson(inventory.userSettings.path, inventory.userSettings.path)
      : null,
    projectSettings: inventory.projectSettings?.exists
      ? parseSettingsJson(inventory.projectSettings.path, inventory.projectSettings.path)
      : null,
    localSettings: inventory.localSettings?.exists
      ? parseSettingsJson(inventory.localSettings.path, inventory.localSettings.path)
      : null,
    managedSettings: inventory.managedSettings?.exists
      ? parseSettingsJson(inventory.managedSettings.path, inventory.managedSettings.path)
      : null,
    projectMcp: inventory.projectMcp?.exists
      ? parseMcpJson(inventory.projectMcp.path, inventory.projectMcp.path)
      : null,
    managedMcp: inventory.managedMcp?.exists
      ? parseMcpJson(inventory.managedMcp.path, inventory.managedMcp.path)
      : null,
  };

  const resolved = resolve(inventory, layers);

  return {
    dir: projectDir,
    resolved,
    totalFiles: inventory.totalFiles,
    totalStartupTokens: inventory.totalStartupTokens,
  };
}

export function registerCompareCommand(program: Command): void {
  program
    .command('compare')
    .description('Compare configurations across multiple projects')
    .argument('<dirs...>', 'Two or more project directories to compare')
    .action((dirs: string[], _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const format = globalOpts.format as string | undefined;

      if (dirs.length < 2) {
        console.error('Error: compare requires at least 2 directories');
        process.exitCode = 1;
        return;
      }

      for (const dir of dirs) {
        const resolved = resolvePath(dir);
        if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
          console.error(`Error: directory not found: ${resolved}`);
          process.exitCode = 1;
          return;
        }
      }

      const cliPatterns: string[] = globalOpts.exclude ?? [];
      const results = dirs.map((dir) => scanAndResolve(dir, cliPatterns));

      if (format === 'json') {
        printComparisonJson(results);
      } else {
        printComparison(results);
      }
    });
}
