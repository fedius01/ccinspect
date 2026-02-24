import type { Command } from 'commander';
import { gatherRuntimeInfo } from '../../core/runtime.js';
import { printRuntimeInfo } from '../output/terminal.js';
import { printRuntimeInfoJson } from '../output/json.js';

export function registerInfoCommand(program: Command): void {
  program
    .command('info')
    .description('Show Claude Code runtime information (CLI version, model, auth)')
    .action(async (_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const format = globalOpts.format as string | undefined;

      const info = await gatherRuntimeInfo();

      if (format === 'json') {
        printRuntimeInfoJson(info);
      } else {
        printRuntimeInfo(info);
      }
    });
}
