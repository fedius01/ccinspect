import type { Command } from 'commander';
import { resolve as resolvePath } from 'path';
import { existsSync, statSync, writeFileSync } from 'fs';
import { scan } from '../../core/scanner.js';
import { buildDependencyGraph } from '../../core/graph-builder.js';
import { createExcluder } from '../../utils/excluder.js';
import { runHistoryReconstruction } from '../../core/history-integration.js';
import { loadConfig } from '../../utils/config.js';
import {
  formatGraphMermaid,
  formatGraphHtml,
  formatGraphText,
  formatGraphJson,
} from '../output/graph-formatters.js';

const VALID_FORMATS = ['text', 'mermaid', 'html', 'json'] as const;
type GraphFormat = (typeof VALID_FORMATS)[number];

export function registerGraphCommand(program: Command): void {
  program
    .command('graph')
    .description('Visualize configuration dependency graph')
    .option('--format <format>', `Output format: ${VALID_FORMATS.join(', ')}`, 'text')
    .option('-o, --output <file>', 'Write output to file instead of stdout')
    .action(async (options, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const projectDir = globalOpts.projectDir as string | undefined;
      const outputFile = options.output as string | undefined;

      // Commander.js routes --format to the global option (program-level -f/--format)
      // due to name collision, so options.format stays at its default 'text'.
      // Check globalOpts.format as fallback when subcommand value is the default.
      const subFormat = options.format as string;
      const globalFormat = globalOpts.format as string;
      let format: string;
      if (subFormat !== 'text') {
        format = subFormat;
      } else if (VALID_FORMATS.includes(globalFormat as GraphFormat)) {
        format = globalFormat;
      } else {
        format = 'text';
      }

      // Validate format
      if (!VALID_FORMATS.includes(format as GraphFormat)) {
        console.error(`Error: invalid format "${format}". Valid formats: ${VALID_FORMATS.join(', ')}`);
        process.exitCode = 1;
        return;
      }

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

      // Run history reconstruction
      const graphConfig = loadConfig(resolvedProjectDir);
      await runHistoryReconstruction(resolvedProjectDir, inventory, 'graph', graphConfig.history);

      const graph = buildDependencyGraph(inventory, resolvedProjectDir);

      let output: string;
      switch (format as GraphFormat) {
        case 'mermaid':
          output = formatGraphMermaid(graph);
          break;
        case 'html':
          output = formatGraphHtml(graph);
          break;
        case 'json':
          output = formatGraphJson(graph);
          break;
        case 'text':
        default:
          output = formatGraphText(graph);
          break;
      }

      if (outputFile) {
        writeFileSync(outputFile, output, 'utf-8');
        console.log(`Graph written to ${outputFile}`);
      } else if (format === 'html') {
        // HTML format without --output: write to default file
        const defaultFile = resolvePath('ccinspect-graph.html');
        writeFileSync(defaultFile, output, 'utf-8');
        console.log(`Graph written to ${defaultFile}`);
      } else {
        // Write directly to stdout — pipe-friendly, no extra noise
        process.stdout.write(output);
      }
    });
}
