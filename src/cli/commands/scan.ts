import type { Command } from 'commander';
import { resolve as resolvePath } from 'path';
import { existsSync, statSync } from 'fs';
import { scan } from '../../core/scanner.js';
import { createExcluder } from '../../utils/excluder.js';
import { printInventory } from '../output/terminal.js';
import { printInventoryJson } from '../output/json.js';

export function registerScanCommand(program: Command): void {
  program
    .command('scan')
    .description('Discover all Claude Code configuration files and show inventory')
    .action((_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const projectDir = globalOpts.projectDir as string | undefined;
      const format = globalOpts.format as string | undefined;

      const resolvedProjectDir = resolvePath(projectDir || process.cwd());

      if (projectDir && (!existsSync(resolvedProjectDir) || !statSync(resolvedProjectDir).isDirectory())) {
        console.error(`Error: directory not found: ${resolvedProjectDir}`);
        process.exitCode = 1;
        return;
      }
      const excluder = createExcluder(resolvedProjectDir, {
        cliPatterns: globalOpts.exclude ?? [],
      });

      const inventory = scan({ projectDir, excluder });

      if (format === 'json') {
        printInventoryJson(inventory);
      } else {
        printInventory(inventory);
      }
    });
}
