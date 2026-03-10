import type { Command } from 'commander';
import { resolve as resolvePath } from 'path';
import { existsSync, readFileSync, statSync } from 'fs';
import { scan } from '../../core/scanner.js';
import { resolve } from '../../core/resolver.js';
import type { ParsedConfigLayers } from '../../core/resolver.js';
import type { ConfigInventory } from '../../types/index.js';
import { createExcluder } from '../../utils/excluder.js';
import { parseSettingsJson } from '../../parsers/settings-json.js';
import { parseMcpJson } from '../../parsers/mcp-json.js';
import {
  printResolvedConfig,
  printResolvedConfigJson,
  buildSourceLegend,
  buildSettingsTable,
  printBlameSettings,
  printBlameSettingsJson,
} from '../output/terminal.js';
import type { RawSettingsLayer } from '../output/terminal.js';

interface BlameOptions {
  permissions?: boolean;
  env?: boolean;
  mcp?: boolean;
  model?: boolean;
  sandbox?: boolean;
  all?: boolean;
  verbose?: boolean;
}

export function runBlame(options: BlameOptions, cmd: Command): void {
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

  // Determine which sections to show
  const showAll = options.all || (!options.permissions && !options.env && !options.mcp && !options.model && !options.sandbox);
  const sections = {
    permissions: !!(showAll || options.permissions),
    env: !!(showAll || options.env),
    mcp: !!(showAll || options.mcp),
    model: !!(showAll || options.model),
    sandbox: !!(showAll || options.sandbox),
  };

  if (format === 'json') {
    printResolvedConfigJson(resolved, sections);
  } else {
    printResolvedConfig(resolved, sections, {
      projectRoot: resolvedProjectDir,
      inventory,
      verbose: options.verbose,
    });
  }
}

function readRawSettingsLayers(inventory: ConfigInventory): RawSettingsLayer[] {
  const layers: RawSettingsLayer[] = [];

  // Highest precedence first
  const sources = [
    inventory.managedSettings,
    inventory.localSettings,
    inventory.projectSettings,
    inventory.userSettings,
  ];

  for (const file of sources) {
    if (!file?.exists) continue;
    try {
      const raw = JSON.parse(readFileSync(file.path, 'utf-8')) as unknown;
      if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
        layers.push({ path: file.path, data: raw as Record<string, unknown> });
      }
    } catch {
      // Skip unparseable files — lint will catch them
    }
  }

  return layers;
}

export function runBlameSettings(options: BlameOptions, cmd: Command): void {
  const globalOpts = cmd.optsWithGlobals();
  const projectDir = globalOpts.projectDir as string | undefined;
  const format = globalOpts.format as string | undefined;
  const verbose = !!options.verbose;

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

  const rawLayers = readRawSettingsLayers(inventory);
  const { badgeMap, legend } = buildSourceLegend(inventory, resolvedProjectDir);

  // Filter legend to settings files only (not MCP files)
  const settingsLegend = legend.filter(
    (e) => e.badge === '[E]' || e.badge === '[L]' || e.badge === '[P]' || e.badge === '[G]',
  ).filter((e) => !e.shortPath.includes('mcp'));

  const rows = buildSettingsTable(rawLayers, badgeMap, verbose);

  if (format === 'json') {
    printBlameSettingsJson(rows);
  } else {
    printBlameSettings(rows, settingsLegend, verbose);
  }
}

export function registerBlameCommand(program: Command): void {
  program
    .command('blame [topic]')
    .description('Show effective merged configuration with origin and precedence blame')
    .option('--permissions', 'Show only permissions')
    .option('--env', 'Show only environment variables')
    .option('--mcp', 'Show only MCP servers')
    .option('--model', 'Show only model configuration')
    .option('--sandbox', 'Show only sandbox configuration')
    .option('--all', 'Show all sections (default)')
    .option('-v, --verbose', 'Expand collapsed sections (e.g., global allow patterns)')
    .action((topic: string | undefined, options: BlameOptions, cmd: Command) => {
      if (topic === 'settings') {
        runBlameSettings(options, cmd);
      } else if (topic && topic !== 'settings') {
        console.error(`Unknown blame topic: "${topic}". Available: settings`);
        process.exitCode = 1;
      } else {
        runBlame(options, cmd);
      }
    });
}
