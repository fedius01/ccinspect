import { Command } from 'commander';
import { registerScanCommand } from './commands/scan.js';
import { registerInfoCommand } from './commands/info.js';
import { registerLintCommand } from './commands/lint.js';
import { registerResolveCommand } from './commands/resolve.js';
import { registerCompareCommand } from './commands/compare.js';

const program = new Command();

program
  .name('ccinspect')
  .description('Claude Code Configuration Inspector — analyze, lint, and resolve Claude Code configs')
  .version('0.1.0')
  .option('-p, --project-dir <path>', 'Project directory to analyze (defaults to cwd)')
  .option('-f, --format <format>', 'Output format: terminal, json', 'terminal')
  .option('-e, --exclude <patterns...>', 'Glob patterns to exclude from scan/lint (repeatable)');

registerScanCommand(program);
registerInfoCommand(program);
registerLintCommand(program);
registerResolveCommand(program);
registerCompareCommand(program);

program.parse();
