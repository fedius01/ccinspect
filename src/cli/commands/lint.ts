import type { Command } from 'commander';
import { resolve as resolvePath } from 'path';
import { scan } from '../../core/scanner.js';
import { resolve } from '../../core/resolver.js';
import type { ParsedConfigLayers } from '../../core/resolver.js';
import { Linter } from '../../core/linter.js';
import { getAllRules } from '../../rules/index.js';
import { createExcluder } from '../../utils/excluder.js';
import { printLintResult } from '../output/terminal.js';
import { printLintResultJson } from '../output/json.js';
import { printLintResultMarkdown } from '../output/markdown.js';
import { parseSettingsJson } from '../../parsers/settings-json.js';
import { parseMcpJson } from '../../parsers/mcp-json.js';
import { loadConfig, toLintConfig } from '../../utils/config.js';

export function registerLintCommand(program: Command): void {
  program
    .command('lint')
    .description('Validate configuration against best practices')
    .action((_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const projectDir = globalOpts.projectDir as string | undefined;
      const format = globalOpts.format as string | undefined;

      const resolvedProjectDir = resolvePath(projectDir || process.cwd());
      const excluder = createExcluder(resolvedProjectDir, {
        cliPatterns: globalOpts.exclude ?? [],
      });

      const inventory = scan({ projectDir, excluder });

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

      if (format === 'json') {
        printLintResultJson(result);
      } else if (format === 'md') {
        console.log(printLintResultMarkdown(result));
      } else {
        printLintResult(result);
      }

      // Exit with non-zero if there are errors
      if (result.stats.errors > 0) {
        process.exitCode = 1;
      }
    });
}
