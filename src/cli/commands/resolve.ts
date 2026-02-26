import type { Command } from 'commander';
import { resolve as resolvePath } from 'path';
import { existsSync, statSync } from 'fs';
import { scan } from '../../core/scanner.js';
import { resolve } from '../../core/resolver.js';
import type { ParsedConfigLayers } from '../../core/resolver.js';
import { createExcluder } from '../../utils/excluder.js';
import { parseSettingsJson } from '../../parsers/settings-json.js';
import { parseMcpJson } from '../../parsers/mcp-json.js';
import { printResolvedConfig, printResolvedConfigJson } from '../output/terminal.js';

export function registerResolveCommand(program: Command): void {
  program
    .command('resolve')
    .description('Show effective merged configuration with origin tracking')
    .option('--permissions', 'Show only permissions')
    .option('--env', 'Show only environment variables')
    .option('--mcp', 'Show only MCP servers')
    .option('--model', 'Show only model configuration')
    .option('--sandbox', 'Show only sandbox configuration')
    .option('--all', 'Show all sections (default)')
    .action((options, cmd) => {
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
        permissions: showAll || options.permissions,
        env: showAll || options.env,
        mcp: showAll || options.mcp,
        model: showAll || options.model,
        sandbox: showAll || options.sandbox,
      };

      if (format === 'json') {
        printResolvedConfigJson(resolved, sections);
      } else {
        printResolvedConfig(resolved, sections);
      }
    });
}
