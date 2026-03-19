import type { Command } from 'commander';
import { resolve as resolvePath, relative } from 'path';
import { existsSync, statSync } from 'fs';
import chalk from 'chalk';
import { scan } from '../../core/scanner.js';
import { getHistory, getVersion, computeLineage } from '../../core/history-reconstructor.js';
import { runHistoryReconstruction } from '../../core/history-integration.js';
import { createExcluder } from '../../utils/excluder.js';
import { loadConfig } from '../../utils/config.js';
import type { HistoryEntry } from '../../types/history.js';

export function registerHistoryCommand(program: Command): void {
  program
    .command('history')
    .argument('[config-path]', 'Config file path to show history for (optional)')
    .description('Show config version timeline mined from git history and disk state')
    .option('--last <n>', 'Show only last N versions')
    .option('--lineage', 'Show only versions in the active ancestry')
    .option('--all', 'Show all versions including superseded (default)')
    .action(async (configPath: string | undefined, _options: Record<string, unknown>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      const projectDir = globalOpts.projectDir as string | undefined;
      const format = globalOpts.format as string | undefined;
      const last = _options.last ? parseInt(_options.last as string, 10) : undefined;
      const lineageOnly = _options.lineage as boolean | undefined;

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

      // Run reconstruction to ensure history is up to date
      const config = loadConfig(resolvedProjectDir);
      await runHistoryReconstruction(resolvedProjectDir, inventory, 'history', config.history);

      // Read the full history
      const entries = getHistory(resolvedProjectDir);

      if (entries.length === 0) {
        console.log(chalk.dim('No config history found. Config files may not be tracked in git.'));
        return;
      }

      // Filter for single-file mode
      let filtered = entries;
      if (configPath) {
        const resolvedConfigPath = resolvePath(configPath);
        const relPath = inventory.gitRoot
          ? relative(inventory.gitRoot, resolvedConfigPath)
          : relative(resolvedProjectDir, resolvedConfigPath);

        filtered = filterByFile(entries, resolvedProjectDir, relPath);
      }

      // Apply lineage filter
      const lineage = computeLineage(entries);
      if (lineageOnly) {
        filtered = filtered.filter((e) => lineage.has(e.version));
      }

      // Apply --last
      if (last && last > 0) {
        filtered = filtered.slice(-last);
      }

      if (format === 'json') {
        printHistoryJson(filtered, lineage, configPath);
      } else if (configPath) {
        printSingleFileHistory(filtered, lineage, configPath, entries.length);
      } else {
        printAllFilesHistory(filtered, lineage, resolvedProjectDir);
      }
    });
}

function filterByFile(
  entries: HistoryEntry[],
  projectRoot: string,
  relPath: string,
): HistoryEntry[] {
  // Filter entries to those that contain the file in their version snapshot.
  // We check: summary text (fast path), restore versions (always include),
  // and fall back to loading the version snapshot for accurate file-level filtering.
  return entries.filter((e) => {
    // Fast path: summary mentions the file
    if (e.summary.includes(relPath)) return true;
    // Restore versions always appear (they restore all files in scope)
    if (e.restoredFrom !== undefined) return true;
    // Initial version always included
    if (e.version === 1) return true;
    // Fallback: load version snapshot and check file list
    const version = getVersion(projectRoot, e.version);
    if (version) {
      return version.files.some((f) => f.relativePath === relPath);
    }
    return false;
  });
}

function printSingleFileHistory(
  entries: HistoryEntry[],
  lineage: Set<number>,
  configPath: string,
  totalVersions: number,
): void {
  const lineageCount = entries.filter((e) => lineage.has(e.version)).length;
  console.log();
  console.log(
    chalk.bold('Config history') +
    `  ·  ${configPath}  ·  ${entries.length} versions` +
    (lineageCount < entries.length ? ` (${lineageCount} in lineage)` : ''),
  );
  console.log();

  // The ACTIVE version is the latest in the filtered set that is also in the lineage
  const latestLineageVersion = [...entries].reverse().find((e) => lineage.has(e.version))?.version;

  // Print timeline in reverse (newest first)
  const reversed = [...entries].reverse();

  for (let i = 0; i < reversed.length; i++) {
    const entry = reversed[i];
    const inLineage = lineage.has(entry.version);
    const isLatest = entry.version === latestLineageVersion;
    const isFirst = entry.version === 1;

    printTimelineEntry(entry, inLineage, isLatest, isFirst);
  }

  // Print lineage summary
  const lineageEntries = entries.filter((e) => lineage.has(e.version));
  if (lineageEntries.length > 1) {
    const chain = lineageEntries
      .reverse()
      .map((e) => `v${e.version}`)
      .join(' ← ');
    console.log(chalk.dim(`Active lineage: ${chain}`));
  }

  if (totalVersions > entries.length) {
    console.log(chalk.dim(`Tip: cci history  show all files  ·  cci history --lineage  hide superseded`));
  }
}

function printTimelineEntry(
  entry: HistoryEntry,
  inLineage: boolean,
  isLatest: boolean,
  isFirst: boolean,
): void {
  // Node symbol
  const nodeSymbol = isFirst ? '○' : '●';
  const nodeColor = inLineage ? chalk.green : chalk.dim;
  const connector = inLineage ? '│' : '┊';

  // Badges
  const badges: string[] = [];
  if (isLatest) badges.push(chalk.green('ACTIVE'));
  if (isFirst) badges.push(chalk.gray('INITIAL'));

  // Source badge
  const sourceBadge = formatSourceBadge(entry);

  // Date
  const date = formatDate(entry.timestamp);

  // First line: node + version + badges + date + source + author
  const parts: string[] = [
    nodeColor(nodeSymbol),
    chalk.bold(`v${entry.version}`),
    ...badges,
    chalk.dim(date),
    sourceBadge,
  ];

  if (entry.gitCommit?.author) {
    parts.push(chalk.dim(`by ${entry.gitCommit.author}`));
  }

  console.log(parts.join('  '));

  // Second line: summary/commit message
  const summary = entry.source === 'git' && entry.gitCommit
    ? `"${entry.gitCommit.message}"`
    : entry.summary;
  console.log(`${nodeColor(connector)}  ${summary}`);

  // Third line: diff stats
  if (entry.linesAdded > 0 || entry.linesRemoved > 0) {
    const diffParts: string[] = [];
    if (entry.linesAdded > 0) diffParts.push(chalk.green(`+${entry.linesAdded}`));
    if (entry.linesRemoved > 0) diffParts.push(chalk.red(`-${entry.linesRemoved}`));
    diffParts.push('lines');
    if (entry.tokenCount > 0) diffParts.push(`·  ${formatTokenCount(entry.tokenCount)} tokens`);
    console.log(`${nodeColor(connector)}  ${diffParts.join(' ')}`);
  }

  console.log(nodeColor(connector));
}

function printAllFilesHistory(
  entries: HistoryEntry[],
  lineage: Set<number>,
  projectRoot: string,
): void {
  const lineageCount = entries.filter((e) => lineage.has(e.version)).length;
  const totalVersions = entries.length;

  // Build per-file summary by loading version snapshots for accurate file lists
  const fileStats = new Map<string, {
    versions: number;
    lineageVersions: number;
    latestTimestamp: string;
    latestTokens: number;
    sources: { git: number; transcript: number; disk: number; restore: number };
  }>();

  for (const entry of entries) {
    const inLin = lineage.has(entry.version);

    // Try to extract file names from summary first (fast path)
    let files = extractFilesFromSummary(entry);

    // If summary doesn't contain file names, load the version snapshot
    if (files.length === 0) {
      const version = getVersion(projectRoot, entry.version);
      if (version) {
        files = version.files.map((f) => f.relativePath);
      }
    }

    for (const file of files) {
      const stat = fileStats.get(file) ?? {
        versions: 0,
        lineageVersions: 0,
        latestTimestamp: '',
        latestTokens: 0,
        sources: { git: 0, transcript: 0, disk: 0, restore: 0 },
      };
      stat.versions++;
      if (inLin) stat.lineageVersions++;
      if (!stat.latestTimestamp || entry.timestamp > stat.latestTimestamp) {
        stat.latestTimestamp = entry.timestamp;
      }
      stat.sources[entry.source]++;
      fileStats.set(file, stat);
    }
  }

  // Get per-file token counts from the latest version snapshot
  const latestEntry = entries[entries.length - 1];
  if (latestEntry) {
    const latestVersion = getVersion(projectRoot, latestEntry.version);
    if (latestVersion) {
      for (const file of latestVersion.files) {
        const stat = fileStats.get(file.relativePath);
        if (stat) {
          stat.latestTokens = file.estimatedTokens;
        }
      }
    }
  }

  console.log();
  console.log(
    chalk.bold('Config history') +
    `  ·  ${fileStats.size} config files  ·  ${totalVersions} total versions` +
    (lineageCount < totalVersions ? ` (${lineageCount} in lineage)` : ''),
  );
  console.log();

  // Table header
  const headers = ['FILE', 'VERSIONS', 'LINEAGE', 'LATEST', 'TOKENS', 'SOURCES'];
  const widths = [40, 10, 10, 18, 10, 30];

  console.log(
    headers.map((h, i) => chalk.dim(h.padEnd(widths[i]))).join(''),
  );

  // Table rows sorted by latest timestamp descending
  const sorted = [...fileStats.entries()]
    .sort(([, a], [, b]) => b.latestTimestamp.localeCompare(a.latestTimestamp));

  for (const [file, stat] of sorted) {
    const sourceParts: string[] = [];
    if (stat.sources.git > 0) sourceParts.push(`git(${stat.sources.git})`);
    if (stat.sources.transcript > 0) sourceParts.push(`cc(${stat.sources.transcript})`);
    if (stat.sources.disk > 0) sourceParts.push(`disk(${stat.sources.disk})`);
    if (stat.sources.restore > 0) sourceParts.push(`restore(${stat.sources.restore})`);

    const row = [
      file.padEnd(widths[0]),
      String(stat.versions).padEnd(widths[1]),
      String(stat.lineageVersions).padEnd(widths[2]),
      formatDate(stat.latestTimestamp).padEnd(widths[3]),
      formatTokenCount(stat.latestTokens).padEnd(widths[4]),
      sourceParts.join(' '),
    ];

    console.log(row.join(''));
  }

  console.log();
  console.log(chalk.dim('Tip: cci history <config-path>  show file timeline  ·  cci history --lineage  hide superseded'));
}

function printHistoryJson(
  entries: HistoryEntry[],
  lineage: Set<number>,
  configPath?: string,
): void {
  const output = {
    configPath: configPath ?? null,
    totalVersions: entries.length,
    lineage: [...lineage].sort((a, b) => a - b),
    entries,
  };
  console.log(JSON.stringify(output, null, 2));
}

// ---- Formatting helpers ----

function formatSourceBadge(entry: HistoryEntry): string {
  switch (entry.source) {
    case 'git':
      return chalk.cyan(`git ${entry.gitCommit?.hash.slice(0, 7) ?? '?'}`);
    case 'transcript':
      return chalk.magenta(`transcript (session ${entry.transcriptSession?.sessionId.slice(0, 4) ?? '?'})`);
    case 'disk':
      return chalk.yellow('disk (detected)');
    case 'restore':
      return chalk.red(`RESTORED from v${entry.restoredFrom ?? '?'}`);
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hour = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${min}`;
  } catch {
    return iso.slice(0, 16);
  }
}

function formatTokenCount(tokens: number): string {
  if (tokens === 0) return '-';
  if (tokens < 1000) return `${tokens}`;
  return `${(tokens / 1000).toFixed(1)}k`;
}

function extractFilesFromSummary(entry: HistoryEntry): string[] {
  const summary = entry.summary;

  // "Changed: file1, file2, file3"
  if (summary.startsWith('Changed: ')) {
    return summary.slice('Changed: '.length).split(', ').map((s) => s.trim());
  }

  // "Claude Code edit: file1, file2"
  if (summary.startsWith('Claude Code edit: ')) {
    return summary.slice('Claude Code edit: '.length).split(', ').map((s) => s.trim());
  }

  // For git commits, we can't extract file names from just the message
  // Return empty array — the all-files view will use the generic fallback
  return [];
}
