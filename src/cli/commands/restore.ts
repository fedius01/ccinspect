import type { Command } from 'commander';
import { resolve as resolvePath, dirname } from 'path';
import { existsSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { createInterface } from 'readline';
import chalk from 'chalk';
import { scan } from '../../core/scanner.js';
import {
  getHistory,
  computeLineage,
  appendRestoreVersion,
} from '../../core/history-reconstructor.js';
import { diffVersions, resolveVersion } from '../../core/snapshot-diff.js';
import { runHistoryReconstruction } from '../../core/history-integration.js';
import { hashFiles } from '../../utils/content-hash.js';
import { createExcluder } from '../../utils/excluder.js';
import { loadConfig } from '../../utils/config.js';
import type { ConfigVersion, HistoryEntry } from '../../types/history.js';

export function registerRestoreCommand(program: Command): void {
  program
    .command('restore')
    .argument('<version>', 'Version to restore (e.g., "v3" or "3")')
    .argument('[config-path]', 'Restrict restore to a single config file')
    .description('Restore config files to a previous version')
    .option('--dry-run', 'Show what would change without writing')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (versionArg: string, configPath: string | undefined, options: Record<string, unknown>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      const projectDir = globalOpts.projectDir as string | undefined;
      const format = globalOpts.format as string | undefined;
      const dryRun = options.dryRun as boolean | undefined;
      const skipConfirm = options.yes as boolean | undefined;

      const resolvedProjectDir = resolvePath(projectDir || process.cwd());

      if (projectDir && (!existsSync(resolvedProjectDir) || !statSync(resolvedProjectDir).isDirectory())) {
        console.error(`Error: directory not found: ${resolvedProjectDir}`);
        process.exitCode = 1;
        return;
      }

      const excluder = createExcluder(resolvedProjectDir, {
        cliPatterns: globalOpts.exclude ?? [],
      });

      // Run scanner to get current inventory
      const inventory = scan({ projectDir, excluder });

      // Ensure history is up to date
      const config = loadConfig(resolvedProjectDir);
      await runHistoryReconstruction(resolvedProjectDir, inventory, 'restore', config.history);

      // Parse version argument
      if (versionArg === 'current') {
        console.error('Error: cannot restore to "current" — that is already the disk state');
        process.exitCode = 1;
        return;
      }

      const targetVersion = resolveVersion(resolvedProjectDir, versionArg, inventory.gitRoot);
      if (!targetVersion) {
        console.error(`Error: version "${versionArg}" not found`);
        process.exitCode = 1;
        return;
      }

      // Build current version for comparison
      const currentVersion = resolveVersion(resolvedProjectDir, 'current', inventory.gitRoot);
      if (!currentVersion) {
        console.error('Error: could not read current disk state');
        process.exitCode = 1;
        return;
      }

      // Determine which files to restore
      let filesToRestore = targetVersion.files;
      if (configPath) {
        const absConfigPath = resolvePath(configPath);
        filesToRestore = targetVersion.files.filter(
          (f) => f.absolutePath === absConfigPath || f.relativePath === configPath,
        );
        if (filesToRestore.length === 0) {
          console.error(`Error: file "${configPath}" not found in version ${targetVersion.version}`);
          process.exitCode = 1;
          return;
        }
      }

      // Compute diff: current → target (what will change)
      const diff = diffVersions(resolvedProjectDir, currentVersion, targetVersion, configPath);

      if (diff.summary.filesChanged === 0) {
        console.log(chalk.dim('No differences — disk state already matches the target version.'));
        return;
      }

      // Show what will change
      const entries = getHistory(resolvedProjectDir);
      const targetEntry = entries.find((e) => e.version === targetVersion.version);

      console.log();
      console.log(chalk.bold('Restore preview') + `  ·  → v${targetVersion.version}`);
      if (targetEntry) {
        console.log(
          chalk.dim(
            `  Source: ${formatSource(targetEntry)}  ·  ${formatDate(targetEntry.timestamp)}`,
          ),
        );
      }
      console.log();

      // Show file changes
      for (const file of diff.files) {
        if (file.status === 'unchanged') continue;

        let statusIcon = chalk.yellow('~');
        if (file.status === 'added') statusIcon = chalk.green('+');
        else if (file.status === 'removed') statusIcon = chalk.red('-');

        const tokenInfo =
          file.oldTokens !== undefined && file.newTokens !== undefined
            ? chalk.dim(`  (${file.oldTokens} → ${file.newTokens} tokens)`)
            : '';

        console.log(`  ${statusIcon} ${file.path}${tokenInfo}`);
      }

      console.log();
      console.log(
        chalk.dim(
          `  ${diff.summary.filesChanged} file(s) changed  ·  ` +
          chalk.green(`+${diff.summary.linesAdded}`) + ' ' +
          chalk.red(`-${diff.summary.linesRemoved}`) + ' lines',
        ),
      );

      // Show lineage impact
      const lineage = computeLineage(entries);
      const supersededCount = entries.filter(
        (e) => e.version > targetVersion.version && lineage.has(e.version),
      ).length;
      if (supersededCount > 0) {
        console.log(
          chalk.yellow(
            `  ${supersededCount} version(s) after v${targetVersion.version} will become superseded`,
          ),
        );
      }

      if (dryRun) {
        console.log();
        console.log(chalk.dim('Dry run — no changes written.'));
        return;
      }

      // Confirm
      if (!skipConfirm) {
        const confirmed = await promptConfirm(
          `Restore to v${targetVersion.version}? [y/N] `,
        );
        if (!confirmed) {
          console.log(chalk.dim('Restore cancelled.'));
          return;
        }
      }

      // Write restored files to disk
      let filesWritten = 0;
      for (const file of filesToRestore) {
        const absPath = file.absolutePath;

        // Ensure parent directory exists
        const dir = dirname(absPath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        try {
          writeFileSync(absPath, file.content, 'utf-8');
          filesWritten++;
        } catch (err) {
          console.error(chalk.red(`  Failed to write ${file.relativePath}: ${err}`));
        }
      }

      // Create restore version in history
      const restoreVersion: ConfigVersion = {
        version: 0, // assigned by appendRestoreVersion
        parentVersion: targetVersion.version,
        restoredFrom: targetVersion.version,
        timestamp: new Date().toISOString(),
        source: 'restore',
        trigger: 'restore',
        contentHash: hashFiles(filesToRestore),
        tokenCount: filesToRestore.reduce((sum, f) => sum + f.estimatedTokens, 0),
        files: filesToRestore,
      };

      const assignedVersion = appendRestoreVersion(resolvedProjectDir, restoreVersion);

      console.log();
      console.log(
        chalk.green(`Restored ${filesWritten} file(s) to v${targetVersion.version} state`) +
        chalk.dim(` → recorded as v${assignedVersion}`),
      );

      if (format === 'json') {
        const output = {
          restoredFrom: targetVersion.version,
          newVersion: assignedVersion,
          filesWritten,
          summary: diff.summary,
        };
        console.log(JSON.stringify(output, null, 2));
      }
    });
}

function formatSource(entry: HistoryEntry): string {
  if (entry.source === 'git' && entry.gitCommit) {
    return `git ${entry.gitCommit.hash.slice(0, 7)} by ${entry.gitCommit.author}`;
  }
  if (entry.source === 'transcript' && entry.transcriptSession) {
    return `Claude Code (session ${entry.transcriptSession.sessionId.slice(0, 8)})`;
  }
  if (entry.source === 'restore') {
    return `restored from v${entry.restoredFrom ?? '?'}`;
  }
  return entry.source;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hour = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day} ${hour}:${min}`;
  } catch {
    return iso.slice(0, 16);
  }
}

function promptConfirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}
