import type { Command } from 'commander';
import { scan } from '../../core/scanner.js';
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

      const inventory = scan({ projectDir });

      if (format === 'json') {
        printInventoryJson(inventory);
      } else {
        printInventory(inventory);
      }
    });
}
