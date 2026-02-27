import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { Command } from 'commander';
import { registerScanCommand } from './commands/scan.js';
import { registerInfoCommand } from './commands/info.js';
import { registerLintCommand } from './commands/lint.js';
import { registerResolveCommand } from './commands/resolve.js';
import { registerCompareCommand } from './commands/compare.js';

declare const PKG_VERSION: string | undefined;

function getVersion(): string {
  if (typeof PKG_VERSION === 'string') return PKG_VERSION;
  // Dev mode fallback: read from package.json at runtime
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const pkgPath = resolve(__dirname, '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  return pkg.version;
}

const program = new Command();

program
  .name('ccinspect')
  .description('Claude Code Configuration Inspector — analyze, lint, and resolve Claude Code configs')
  .version(getVersion())
  .option('-p, --project-dir <path>', 'Project directory to analyze (defaults to cwd)')
  .option('-f, --format <format>', 'Output format: terminal, json', 'terminal')
  .option('-e, --exclude <patterns...>', 'Glob patterns to exclude from scan/lint (repeatable)');

registerScanCommand(program);
registerInfoCommand(program);
registerLintCommand(program);
registerResolveCommand(program);
registerCompareCommand(program);

program.parse();
