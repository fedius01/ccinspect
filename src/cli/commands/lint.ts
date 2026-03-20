import type { Command } from 'commander';
import { resolve as resolvePath, basename } from 'path';
import { existsSync, statSync } from 'fs';
import chalk from 'chalk';
import { scan } from '../../core/scanner.js';
import { resolve } from '../../core/resolver.js';
import type { ParsedConfigLayers } from '../../core/resolver.js';
import { Linter } from '../../core/linter.js';
import { getAllRules } from '../../rules/index.js';
import { createExcluder } from '../../utils/excluder.js';
import { printLintResult } from '../output/terminal.js';
import { printLintResultJson, enrichLintIssues } from '../output/json.js';
import { printLintResultMarkdown } from '../output/markdown.js';
import { parseSettingsJson } from '../../parsers/settings-json.js';
import { parseMcpJson } from '../../parsers/mcp-json.js';
import { loadConfig, toLintConfig } from '../../utils/config.js';
import { buildSingleFileInventory } from '../../utils/single-file-inventory.js';
import { runHistoryReconstruction } from '../../core/history-integration.js';
import type { ConfigFileType, LintResult, Severity } from '../../types/index.js';

const FILE_TYPE_LABELS: Record<ConfigFileType, string> = {
  'claude-md': 'memory',
  'settings-json': 'settings',
  'mcp-json': 'MCP',
  'rule-md': 'rule',
  'agent-md': 'agent',
  'skill-md': 'skill',
  'command-md': 'command',
};

const SUPPORTED_TYPES_DISPLAY = [
  'CLAUDE.md',
  'settings.json',
  '.mcp.json',
  '.claude/rules/*.md',
  '.claude/agents/*.md',
  'SKILL.md',
  '.claude/commands/*.md',
];

export function registerLintCommand(program: Command): void {
  program
    .command('lint [target]')
    .description('Validate configuration against best practices')
    .option('-v, --verbose', 'Show expanded output with all issues and full evidence')
    .option('--min-severity <level>', 'Minimum severity to display (error, warning, info)', 'info')
    .action(async (target: string | undefined, _options: unknown, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      const format = globalOpts.format as string | undefined;
      const verbose = globalOpts.verbose as boolean | undefined;
      const minSeverity = parseSeverity(globalOpts.minSeverity as string | undefined);

      // Determine if target is a file
      if (target) {
        const resolvedTarget = resolvePath(target);

        if (!existsSync(resolvedTarget)) {
          console.error(`Error: file or directory not found: ${resolvedTarget}`);
          process.exitCode = 1;
          return;
        }

        if (statSync(resolvedTarget).isFile()) {
          // === SINGLE-FILE MODE ===
          await runSingleFileMode(resolvedTarget, format, verbose, minSeverity);
          return;
        }

        // Target is a directory — feed into the existing flow as projectDir
        runDirectoryMode(resolvedTarget, globalOpts, minSeverity);
        return;
      }

      // === DIRECTORY MODE (existing code, unchanged) ===
      const projectDir = globalOpts.projectDir as string | undefined;
      const resolvedProjectDir = resolvePath(projectDir || process.cwd());
      runDirectoryMode(resolvedProjectDir, globalOpts, minSeverity);
    });
}

async function runSingleFileMode(
  absolutePath: string,
  format: string | undefined,
  verbose: boolean | undefined,
  minSeverity: Severity,
): Promise<void> {
  let ctx;
  try {
    ctx = await buildSingleFileInventory(absolutePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Unrecognized config file type')) {
      console.error(
        `Error: unsupported file type: ${basename(absolutePath)}\n` +
          `Supported types: ${SUPPORTED_TYPES_DISPLAY.join(', ')}`,
      );
    } else {
      console.error(`Error: ${message}`);
    }
    process.exitCode = 1;
    return;
  }

  // Load .ccinspect.json config using the discovered project root
  const ccinspectConfig = loadConfig(ctx.inventory.projectRoot);
  const lintConfig = toLintConfig(ccinspectConfig);

  const linter = new Linter();
  linter.registerRules(getAllRules());

  const result = linter.run(ctx.inventory, ctx.resolved, lintConfig, ctx.fileType);

  const label = FILE_TYPE_LABELS[ctx.fileType];
  const displayName = basename(ctx.filePath);

  // Filter issues for display (stats remain unfiltered)
  const filteredResult = filterResult(result, minSeverity);

  if (format === 'json') {
    enrichLintIssues(filteredResult.issues, ctx.inventory.projectRoot);
    const output: Record<string, unknown> = {
      singleFileMode: {
        file: displayName,
        type: ctx.fileType,
        label,
      },
      ...filteredResult,
    };
    console.log(JSON.stringify(output, null, 2));
  } else if (format === 'md') {
    const banner = `> **Single-file mode**: \`${displayName}\` (${label}) — cross-file rules skipped\n`;
    console.log(banner + printLintResultMarkdown(filteredResult));
  } else {
    console.log();
    console.log(chalk.bold.cyan(`⚡ Single-file mode: ${displayName} (${label})`));
    console.log(chalk.dim('  Cross-file and project-level rules skipped'));
    printLintResult(filteredResult, { projectRoot: ctx.inventory.projectRoot, verbose, minSeverity });
  }

  if (result.stats.errors > 0) {
    process.exitCode = 1;
  }
}

async function runDirectoryMode(
  resolvedProjectDir: string,
  globalOpts: Record<string, unknown>,
  minSeverity: Severity,
): Promise<void> {
  const format = globalOpts.format as string | undefined;
  const verbose = globalOpts.verbose as boolean | undefined;

  if (
    !existsSync(resolvedProjectDir) ||
    !statSync(resolvedProjectDir).isDirectory()
  ) {
    console.error(`Error: directory not found: ${resolvedProjectDir}`);
    process.exitCode = 1;
    return;
  }

  const excluder = createExcluder(resolvedProjectDir, {
    cliPatterns: (globalOpts.exclude as string[]) ?? [],
  });

  const inventory = scan({ projectDir: resolvedProjectDir, excluder });

  // Run history reconstruction (non-blocking — errors are swallowed internally)
  const ccinspectConfigForHistory = loadConfig(resolvedProjectDir);
  await runHistoryReconstruction(resolvedProjectDir, inventory, 'lint', ccinspectConfigForHistory.history);

  // Parse config files for resolver
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

  // Load .ccinspect.json config
  const ccinspectConfig = loadConfig(inventory.projectRoot);
  const lintConfig = toLintConfig(ccinspectConfig);

  const linter = new Linter();
  linter.registerRules(getAllRules());

  const result = linter.run(inventory, resolved, lintConfig);

  // Filter issues for display (stats remain unfiltered)
  const filteredResult = filterResult(result, minSeverity);

  if (format === 'json') {
    printLintResultJson(filteredResult, resolvedProjectDir);
  } else if (format === 'md') {
    console.log(printLintResultMarkdown(filteredResult));
  } else {
    printLintResult(filteredResult, { projectRoot: resolvedProjectDir, verbose, minSeverity });
  }

  // Exit code based on unfiltered results
  if (result.stats.errors > 0) {
    process.exitCode = 1;
  }
}

// ---- Severity filtering helpers ----

const SEVERITY_LEVELS: Record<Severity, number> = { error: 2, warning: 1, info: 0 };

function parseSeverity(value: string | undefined): Severity {
  if (value === 'error' || value === 'warning' || value === 'info') return value;
  return 'info';
}

/** Filter issues by minimum severity. Stats reflect original (unfiltered) counts. */
function filterResult(result: LintResult, minSeverity: Severity): LintResult {
  if (minSeverity === 'info') return result; // no filtering needed
  const minLevel = SEVERITY_LEVELS[minSeverity];
  return {
    issues: result.issues.filter((i) => SEVERITY_LEVELS[i.severity] >= minLevel),
    stats: result.stats, // original counts preserved
  };
}
