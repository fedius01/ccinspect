import type { Command } from 'commander';
import { resolve as resolvePath, relative } from 'path';
import { existsSync, statSync } from 'fs';
import chalk from 'chalk';
import { scan } from '../../core/scanner.js';
import { getHistory } from '../../core/history-reconstructor.js';
import { diffVersions, resolveVersion } from '../../core/snapshot-diff.js';
import { runHistoryReconstruction } from '../../core/history-integration.js';
import { createExcluder } from '../../utils/excluder.js';
import { loadConfig } from '../../utils/config.js';
import type { FileDiff, DiffHunk, HistoryEntry, DiffResult } from '../../types/history.js';

export function registerDiffCommand(program: Command): void {
  program
    .command('diff')
    .argument('<v1>', 'First version (e.g., "v1", "1", or "current")')
    .argument('<v2>', 'Second version (e.g., "v2", "2", or "current")')
    .argument('[config-path]', 'Restrict diff to a single config file')
    .description('Compare two config versions side by side')
    .action(async (v1Arg: string, v2Arg: string, configPath: string | undefined, _options: Record<string, unknown>, cmd: Command) => {
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

      // Run scanner to get current inventory
      const inventory = scan({ projectDir, excluder });

      // Ensure history is up to date
      const config = loadConfig(resolvedProjectDir);
      await runHistoryReconstruction(resolvedProjectDir, inventory, 'diff', config.history);

      const entries = getHistory(resolvedProjectDir);
      if (entries.length === 0) {
        console.error('No config history found. Run other cci commands first to build history.');
        process.exitCode = 1;
        return;
      }

      // Resolve version arguments
      const versionA = resolveVersion(resolvedProjectDir, v1Arg, inventory.gitRoot);
      const versionB = resolveVersion(resolvedProjectDir, v2Arg, inventory.gitRoot);

      if (!versionA) {
        console.error(`Error: version "${v1Arg}" not found`);
        process.exitCode = 1;
        return;
      }
      if (!versionB) {
        console.error(`Error: version "${v2Arg}" not found`);
        process.exitCode = 1;
        return;
      }

      // Resolve config-path to relative
      let relConfigPath: string | undefined;
      if (configPath) {
        const absConfigPath = resolvePath(configPath);
        relConfigPath = inventory.gitRoot
          ? relative(inventory.gitRoot, absConfigPath)
          : relative(resolvedProjectDir, absConfigPath);
      }

      // Compute diff
      const result = diffVersions(resolvedProjectDir, versionA, versionB, relConfigPath);

      // Find entry metadata for header display
      const entryA = findEntry(entries, v1Arg, versionA.version);
      const entryB = findEntry(entries, v2Arg, versionB.version);

      if (format === 'json') {
        printDiffJson(result, v1Arg, v2Arg, versionA.version, versionB.version, entryA, entryB);
      } else {
        printDiffTerminal(result, v1Arg, v2Arg, entryA, entryB);
      }
    });
}

function findEntry(
  entries: HistoryEntry[],
  arg: string,
  version: number,
): HistoryEntry | undefined {
  if (arg === 'current') return undefined;
  return entries.find((e) => e.version === version);
}

function printDiffTerminal(
  result: DiffResult,
  v1Label: string,
  v2Label: string,
  entryA: HistoryEntry | undefined,
  entryB: HistoryEntry | undefined,
): void {
  const { summary, files } = result;

  if (summary.filesChanged === 0) {
    console.log(chalk.dim('No differences between versions.'));
    return;
  }

  // Summary header
  console.log();
  console.log(
    chalk.bold('Config diff') +
    `  ·  ${formatVersionLabel(v1Label, entryA)} → ${formatVersionLabel(v2Label, entryB)}`,
  );

  const parts: string[] = [];
  if (summary.filesChanged > 0) parts.push(`${summary.filesChanged} file(s) changed`);
  if (summary.linesAdded > 0) parts.push(chalk.green(`+${summary.linesAdded}`));
  if (summary.linesRemoved > 0) parts.push(chalk.red(`-${summary.linesRemoved}`));
  if (summary.tokenDelta !== 0) {
    const sign = summary.tokenDelta > 0 ? '+' : '';
    parts.push(`${sign}${summary.tokenDelta} tokens`);
  }
  console.log(chalk.dim(parts.join('  ·  ')));
  console.log();

  // Per-file diffs
  for (const file of files) {
    if (file.status === 'unchanged') continue;
    printFileDiff(file);
  }
}

function printFileDiff(file: FileDiff): void {
  // File header
  let statusBadge = chalk.yellow('[modified]');
  if (file.status === 'added') statusBadge = chalk.green('[added]');
  else if (file.status === 'removed') statusBadge = chalk.red('[removed]');

  console.log(chalk.bold(`--- ${file.path}`) + '  ' + statusBadge);

  // Token info
  const tokenParts: string[] = [];
  if (file.oldTokens !== undefined) tokenParts.push(`${file.oldTokens} tokens`);
  if (file.newTokens !== undefined) {
    if (file.oldTokens !== undefined) {
      tokenParts.push(`→ ${file.newTokens} tokens`);
    } else {
      tokenParts.push(`${file.newTokens} tokens`);
    }
  }
  if (tokenParts.length > 0) {
    console.log(chalk.dim(`    ${tokenParts.join(' ')}`));
  }

  // Hunks
  for (const hunk of file.hunks) {
    printHunk(hunk);
  }

  console.log();
}

function printHunk(hunk: DiffHunk): void {
  // Hunk header
  console.log(
    chalk.cyan(
      `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
    ),
  );

  for (const line of hunk.lines) {
    if (line.type === 'add') {
      console.log(chalk.green(`+${line.content}`));
    } else if (line.type === 'remove') {
      console.log(chalk.red(`-${line.content}`));
    } else {
      console.log(chalk.dim(` ${line.content}`));
    }
  }
}

function formatVersionLabel(arg: string, entry: HistoryEntry | undefined): string {
  if (arg === 'current') return chalk.yellow('current (disk)');
  if (!entry) return `v${arg.replace(/^v/i, '')}`;

  const vNum = `v${entry.version}`;
  const date = formatDate(entry.timestamp);
  const source = entry.source === 'git' && entry.gitCommit
    ? `git ${entry.gitCommit.hash.slice(0, 7)}`
    : entry.source;
  return `${vNum} (${date}, ${source})`;
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

function printDiffJson(
  result: DiffResult,
  v1Arg: string,
  v2Arg: string,
  v1Num: number,
  v2Num: number,
  entryA: HistoryEntry | undefined,
  entryB: HistoryEntry | undefined,
): void {
  const output = {
    versionA: {
      version: v1Arg === 'current' ? 'current' : v1Num,
      timestamp: entryA?.timestamp ?? new Date().toISOString(),
      source: v1Arg === 'current' ? 'disk' : entryA?.source,
    },
    versionB: {
      version: v2Arg === 'current' ? 'current' : v2Num,
      timestamp: entryB?.timestamp ?? new Date().toISOString(),
      source: v2Arg === 'current' ? 'disk' : entryB?.source,
    },
    summary: result.summary,
    files: result.files.map((f) => ({
      path: f.path,
      status: f.status,
      oldTokens: f.oldTokens,
      newTokens: f.newTokens,
      hunks: f.hunks,
    })),
  };
  console.log(JSON.stringify(output, null, 2));
}
