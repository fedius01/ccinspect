import type { Command } from 'commander';
import { resolve as resolvePath } from 'path';
import { gatherRuntimeInfo } from '../../core/runtime.js';
import { scan } from '../../core/scanner.js';
import { createExcluder } from '../../utils/excluder.js';
import { loadConfig } from '../../utils/config.js';
import { runHistoryReconstruction } from '../../core/history-integration.js';
import { printRuntimeInfo } from '../output/terminal.js';
import { printRuntimeInfoJson } from '../output/json.js';

export function registerInfoCommand(program: Command): void {
  program
    .command('info')
    .description('Show Claude Code runtime information (CLI version, model, auth)')
    .action(async (_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const projectDir = globalOpts.projectDir as string | undefined;
      const format = globalOpts.format as string | undefined;

      // Run history reconstruction in background (non-blocking)
      const resolvedProjectDir = resolvePath(projectDir || process.cwd());
      const excluder = createExcluder(resolvedProjectDir, {
        cliPatterns: globalOpts.exclude ?? [],
      });
      const inventory = scan({ projectDir, excluder });
      const config = loadConfig(resolvedProjectDir);
      await runHistoryReconstruction(resolvedProjectDir, inventory, 'info', config.history);

      const info = await gatherRuntimeInfo();

      if (format === 'json') {
        printRuntimeInfoJson(info);
      } else {
        printRuntimeInfo(info);
      }
    });
}
