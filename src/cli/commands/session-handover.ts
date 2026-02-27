import type { Command } from 'commander';
import { resolve as resolvePath, dirname } from 'path';
import { existsSync, statSync, mkdirSync, writeFileSync } from 'fs';
import { generateHandover } from '../../core/session-handover.js';
import type { HandoverConfig } from '../../core/session-handover.js';
import { renderHandover } from '../../core/session-handover-renderer.js';
import { loadConfig } from '../../utils/config.js';

export function registerSessionHandoverCommand(program: Command): void {
  program
    .command('session-handover')
    .description('Generate session status document')
    .option('--test-command <cmd>', 'Test command to run')
    .option('--typecheck-command <cmd>', 'Typecheck command to run')
    .option('--smells-command <cmd>', 'Code smells command to run')
    .option('--output <path>', 'Output file path')
    .option('--diff-base <ref>', 'Git ref to diff against')
    .option('--dry-run', 'Print to stdout instead of writing file')
    .option('--skip-tests', 'Skip running test command')
    .option('--skip-typecheck', 'Skip running typecheck command')
    .action(async (options, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const projectDir = globalOpts.projectDir as string | undefined;
      const resolvedProjectDir = resolvePath(projectDir || process.cwd());

      if (projectDir && (!existsSync(resolvedProjectDir) || !statSync(resolvedProjectDir).isDirectory())) {
        console.error(`Error: directory not found: ${resolvedProjectDir}`);
        process.exitCode = 1;
        return;
      }

      // Load .ccinspect.json config
      const ccinspectConfig = loadConfig(resolvedProjectDir);
      const handoverSection = ccinspectConfig.sessionHandover;

      // Build config: CLI flags > .ccinspect.json > defaults
      const config: HandoverConfig = {
        testCommand: options.testCommand ?? handoverSection?.testCommand ?? 'npm run test',
        typecheckCommand: options.typecheckCommand ?? handoverSection?.typecheckCommand ?? 'npx tsc --noEmit',
        smellsCommand: options.smellsCommand ?? handoverSection?.smellsCommand ?? 'npm run smells',
        statusFile: options.output ?? handoverSection?.statusFile ?? 'docs/status.md',
        diffBase: options.diffBase ?? 'HEAD',
        skipTests: options.skipTests ?? false,
        skipTypecheck: options.skipTypecheck ?? false,
        projectDir: resolvedProjectDir,
      };

      const result = await generateHandover(config);
      const markdown = renderHandover(result);

      if (options.dryRun) {
        console.log(markdown);
        return;
      }

      // Write to file
      const outputPath = resolvePath(resolvedProjectDir, config.statusFile);
      const outputDir = dirname(outputPath);
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }
      writeFileSync(outputPath, markdown, 'utf-8');

      console.log(`Session status written to ${config.statusFile}`);
    });
}
