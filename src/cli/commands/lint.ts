import type { Command } from 'commander';
import { scan } from '../../core/scanner.js';
import { resolve } from '../../core/resolver.js';
import { Linter } from '../../core/linter.js';
import { getAllRules } from '../../rules/index.js';
import { printLintResult } from '../output/terminal.js';
import { printLintResultJson } from '../output/json.js';

export function registerLintCommand(program: Command): void {
  program
    .command('lint')
    .description('Validate configuration against best practices')
    .action((_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const projectDir = globalOpts.projectDir as string | undefined;
      const format = globalOpts.format as string | undefined;

      const inventory = scan({ projectDir });
      const resolved = resolve(inventory);

      const linter = new Linter();
      linter.registerRules(getAllRules());

      const result = linter.run(inventory, resolved);

      if (format === 'json') {
        printLintResultJson(result);
      } else {
        printLintResult(result);
      }

      // Exit with non-zero if there are errors
      if (result.stats.errors > 0) {
        process.exitCode = 1;
      }
    });
}
