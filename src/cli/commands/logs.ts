import type { Command } from 'commander';
import { resolve as resolvePath } from 'path';
import chalk from 'chalk';
import type { AggregateStats, FileActivity, TokenEconomicsReport } from '../../types/transcript.js';
import { analyzeTranscriptsWithResults, analyzeTokenEconomics } from '../../core/transcript-analyzer.js';
import { scan } from '../../core/scanner.js';
import { runHistoryReconstruction } from '../../core/history-integration.js';
import { loadConfig } from '../../utils/config.js';
import { shortenPath } from '../output/terminal.js';

export function registerLogsCommand(program: Command): void {
  const logs = program
    .command('logs')
    .description('Transcript-based session analytics');

  logs
    .command('stats')
    .description('Aggregate statistics across Claude Code sessions')
    .option('--days <n>', 'Analyze sessions from last N days', '30')
    .option('--session <uuid>', 'Analyze a specific session')
    .option('--cost', 'Show token economics analysis (startup cost, cache efficiency, cost estimates)')
    .action(async (_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const projectDir = globalOpts.projectDir as string | undefined;
      const format = globalOpts.format as string | undefined;
      const days = parseInt(_options.days as string, 10);
      const sessionId = _options.session as string | undefined;
      const showCost = _options.cost as boolean | undefined;

      const resolvedProjectDir = resolvePath(projectDir || process.cwd());

      const { stats, parseResults } = await analyzeTranscriptsWithResults({
        projectRoot: resolvedProjectDir,
        days: isNaN(days) ? 30 : days,
        sessionId,
      });

      // Token economics analysis (only when --cost and we have data)
      let tokenEconomics: TokenEconomicsReport | null = null;
      if (showCost && parseResults.length > 0) {
        // Get estimated startup tokens from scanner
        let estimatedStartup = 0;
        try {
          const inventory = scan({ projectDir: resolvedProjectDir });
          const logsConfig = loadConfig(resolvedProjectDir);
          await runHistoryReconstruction(resolvedProjectDir, inventory, 'logs-stats', logsConfig.history);
          estimatedStartup = inventory.totalStartupTokens;
        } catch {
          // Scanner failure is non-fatal for cost analysis
        }
        tokenEconomics = analyzeTokenEconomics(parseResults, estimatedStartup);
      }

      if (format === 'json') {
        printStatsJson(stats, tokenEconomics);
      } else {
        printStatsTerminal(stats, resolvedProjectDir, tokenEconomics);
      }
    });
}

// ---- Terminal output ----

function printStatsTerminal(
  stats: AggregateStats,
  projectRoot: string,
  tokenEconomics: TokenEconomicsReport | null,
): void {
  console.log();
  console.log(chalk.bold('ccinspect logs stats'));
  console.log();

  if (stats.sessionsAnalyzed === 0) {
    console.log(
      chalk.yellow('No transcript files found for this project.'),
    );
    console.log(
      chalk.dim('Claude Code transcripts are stored in ~/.claude/projects/.'),
    );
    console.log();
    return;
  }

  // Data quality header
  const parts: string[] = [];
  parts.push(`${stats.sessionsAnalyzed} session${stats.sessionsAnalyzed === 1 ? '' : 's'}`);

  const qualityParts: string[] = [];
  if (stats.sessionsExact > 0) qualityParts.push(`${stats.sessionsExact} exact`);
  if (stats.sessionsPartial > 0) qualityParts.push(`${stats.sessionsPartial} partial`);
  if (stats.sessionsDamaged > 0) qualityParts.push(chalk.red(`${stats.sessionsDamaged} damaged`));
  if (qualityParts.length > 0) parts.push(qualityParts.join(', '));

  // Date range
  const fromStr = formatDate(stats.dateRange.from);
  const toStr = formatDate(stats.dateRange.to);
  if (fromStr === toStr) {
    parts.push(fromStr);
  } else {
    parts.push(`${fromStr} – ${toStr}`);
  }

  console.log(chalk.cyan(`Session Statistics`) + `  (${parts.join(' · ')})`);
  console.log();

  // Sessions summary
  const avgDuration = computeAvgDurationMinutes(stats);
  const avgTurns = stats.sessionsAnalyzed > 0
    ? Math.round(stats.totalTurns / stats.sessionsAnalyzed)
    : 0;

  const sessionParts = [`${stats.sessionsAnalyzed} total`];
  if (avgDuration !== null) sessionParts.push(`avg ${avgDuration} min`);
  sessionParts.push(`avg ${avgTurns} turns`);
  console.log(`  ${chalk.bold('Sessions')}       ${sessionParts.join('  ·  ')}`);

  // Tool distribution
  if (stats.totalToolCalls > 0) {
    console.log(`  ${chalk.bold('Tool calls')}     ${stats.totalToolCalls} total`);
    printToolDistribution(stats.toolDistribution, stats.totalToolCalls);
  } else {
    console.log(`  ${chalk.bold('Tool calls')}     No tool calls recorded`);
  }
  console.log();

  // Top files by edits
  const topFiles = getTopFilesByEdits(stats.fileActivity, 5);
  if (topFiles.length > 0) {
    console.log(`  ${chalk.bold('Top files by edits:')}`);
    const maxPathLen = Math.min(
      50,
      Math.max(...topFiles.map(([p]) => shortenPath(p, projectRoot).length)),
    );
    for (const [filePath, activity] of topFiles) {
      const short = shortenPath(filePath, projectRoot);
      const padded = short.padEnd(maxPathLen + 2);
      const sessCount = activity.sessions.size;
      console.log(
        `    ${padded}${activity.editCount} edit${activity.editCount === 1 ? '' : 's'} across ${sessCount} session${sessCount === 1 ? '' : 's'}`,
      );
    }
    console.log();
  }

  // Delegations
  if (stats.delegations.length > 0) {
    console.log(`  ${chalk.bold('Delegations:')}`);
    const delParts = stats.delegations.map(
      (d) => `${d.agentName} (${d.count})`,
    );
    console.log(`    ${delParts.join('  ·  ')}`);
    console.log();
  }

  // Skill activations
  if (stats.skillActivations.length > 0) {
    console.log(`  ${chalk.bold('Skills:')}`);
    const skillParts = stats.skillActivations.map(
      (s) => `/${s.skillName} (${s.explicitCount + s.autoCount})`,
    );
    console.log(`    ${skillParts.join('  ·  ')}`);
    console.log();
  }

  // Token usage
  const tu = stats.tokenUsage;
  if (tu.sessionsWithData > 0) {
    const prefix = tu.completeness === 'estimated' ? '~' : '';
    const metaNote = `(${tu.sessionsWithData}/${tu.sessionsTotal} sessions had metadata${tu.completeness === 'estimated' ? ' · estimates marked ~' : ''})`;
    console.log(`  ${chalk.bold('Tokens')}  ${chalk.dim(metaNote)}`);

    // Total input = marginal new + cache read + cache creation (full context window)
    const totalInput = tu.inputTokens + tu.cacheReadTokens + tu.cacheCreationTokens;
    const cacheTotal = tu.cacheReadTokens + tu.cacheCreationTokens;
    const cachePct = totalInput > 0 ? Math.round((tu.cacheReadTokens / totalInput) * 100) : 0;

    const cacheSuffix = cachePct > 0 ? '  (' + cachePct + '% served from cache)' : '';
    console.log(`    ${prefix}Total input:       ${formatNumber(totalInput)} tokens${cacheSuffix}`);
    console.log(`    ${prefix}Total output:      ${formatNumber(tu.outputTokens)} tokens`);

    if (cacheTotal > 0) {
      console.log(`    ${prefix}Cache breakdown:   ${formatNumber(tu.cacheReadTokens)} read  ·  ${formatNumber(tu.cacheCreationTokens)} created  ·  ${formatNumber(tu.inputTokens)} new`);
    }
    console.log();
  }

  // Token economics (--cost flag)
  if (tokenEconomics) {
    printTokenEconomicsTerminal(tokenEconomics);
  }
}

function printTokenEconomicsTerminal(report: TokenEconomicsReport): void {
  const metaNote = `(${report.sessionsWithTokenData}/${report.sessionsTotal} sessions had token metadata)`;
  console.log(`  ${chalk.bold(chalk.cyan('Token Economics'))}  ${chalk.dim(metaNote)}`);
  console.log();

  // Startup cost comparison
  if (report.estimatedStartupTokens > 0 || report.actualFirstMessageTokens > 0) {
    console.log(`    ${chalk.bold('Startup context:')}`);
    console.log(`      Your config (estimated):      ${formatNumber(report.estimatedStartupTokens)} tokens`);
    console.log(`      Total startup (actual):       ${formatNumber(report.actualFirstMessageTokens)} tokens`);
    const baseContext = Math.max(0, report.actualFirstMessageTokens - report.estimatedStartupTokens);
    console.log(`      Claude Code base context:    ~${formatNumber(baseContext)} tokens  ${chalk.dim('(system prompt, tools, built-in instructions)')}`);
    if (report.actualFirstMessageTokens > 0) {
      const configShare = Math.round((report.estimatedStartupTokens / report.actualFirstMessageTokens) * 100);
      const shareNote = chalk.dim('Your config is ' + configShare + '% of startup context');
      console.log('      ' + shareNote);
    }
    console.log();
  }

  // Cost estimate
  if (report.sessionsWithTokenData > 0) {
    console.log(`    ${chalk.bold('Cost estimate (API-equivalent):')}`);
    console.log(`      ~Total:               ${formatCost(report.totalEstimatedCost)} across ${report.sessionsTotal} sessions`);
    console.log(`      ~Average per session:  ${formatCost(report.avgCostPerSession)}`);

    if (report.costByModel.size > 0) {
      const modelParts = [...report.costByModel.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([model, cost]) => `${formatModelName(model)} (${formatCost(cost)})`);
      console.log(`      By model:  ${modelParts.join('  ·  ')}`);
      console.log(chalk.gray('      Note: Subscription plans (Max/Pro/Team) are not billed per-token'));
    }
    console.log();
  }

  // Cache analysis
  if (report.overallCacheEfficiency > 0 || report.cacheMissBreakdown.ttlTimeoutCount > 0) {
    console.log(`    ${chalk.bold('Cache analysis:')}`);
    console.log(`      Efficiency: ${report.overallCacheEfficiency}% read ratio`);

    const miss = report.cacheMissBreakdown;
    const totalMisses = miss.ttlTimeoutCount + miss.configChangeCount + miss.unknownCount;
    if (totalMisses > 0) {
      const missParts: string[] = [];
      if (miss.ttlTimeoutCount > 0) {
        const pct = Math.round((miss.ttlTimeoutCount / totalMisses) * 100);
        missParts.push(`${pct}% TTL timeout (gaps >5min)`);
      }
      if (miss.configChangeCount > 0) {
        const pct = Math.round((miss.configChangeCount / totalMisses) * 100);
        missParts.push(`${pct}% new content`);
      }
      if (miss.unknownCount > 0) {
        const pct = Math.round((miss.unknownCount / totalMisses) * 100);
        missParts.push(`${pct}% unknown`);
      }
      console.log(`      Miss breakdown: ${missParts.join('  ·  ')}`);
    }
    console.log();
  }

  // Compaction
  if (report.totalCompactions > 0) {
    const pct = report.sessionsTotal > 0
      ? Math.round((report.sessionsWithCompaction / report.sessionsTotal) * 100)
      : 0;
    console.log(`    ${chalk.bold('Context compactions:')} ${report.totalCompactions} across ${report.sessionsTotal} sessions (${pct}% of sessions)`);
    console.log();
  }
}

function printToolDistribution(
  distribution: Map<string, number>,
  total: number,
): void {
  // Sort by count descending
  const sorted = [...distribution.entries()].sort((a, b) => b[1] - a[1]);

  // Show top 6, group the rest as "Other"
  const TOP_N = 6;
  let otherCount = 0;

  for (let i = 0; i < sorted.length; i++) {
    if (i < TOP_N) {
      const [name, count] = sorted[i];
      const pct = Math.round((count / total) * 100);
      console.log(`    ${name.padEnd(14)} ${String(count).padStart(5)}  (${pct}%)`);
    } else {
      otherCount += sorted[i][1];
    }
  }

  if (otherCount > 0) {
    const pct = Math.round((otherCount / total) * 100);
    console.log(`    ${'Other'.padEnd(14)} ${String(otherCount).padStart(5)}  (${pct}%)`);
  }
}

function getTopFilesByEdits(
  activity: Map<string, FileActivity>,
  n: number,
): [string, FileActivity][] {
  return [...activity.entries()]
    .filter(([, a]) => a.editCount > 0)
    .sort((a, b) => b[1].editCount - a[1].editCount)
    .slice(0, n);
}

function computeAvgDurationMinutes(stats: AggregateStats): number | null {
  if (stats.sessionsAnalyzed <= 1) {
    const rangeMs = stats.dateRange.to.getTime() - stats.dateRange.from.getTime();
    return rangeMs > 0 ? Math.round(rangeMs / 60000) : null;
  }
  return null;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function formatCost(cost: number): string {
  if (cost < 0.01) return '~$0.00';
  return `~$${cost.toFixed(2)}`;
}

function formatModelName(model: string): string {
  // Shorten long model IDs for display
  if (model.includes('sonnet')) return 'claude-sonnet';
  if (model.includes('opus')) return 'claude-opus';
  if (model.includes('haiku')) return 'claude-haiku';
  return model.length > 25 ? model.slice(0, 22) + '...' : model;
}

// ---- JSON output ----

function printStatsJson(
  stats: AggregateStats,
  tokenEconomics: TokenEconomicsReport | null,
): void {
  // Convert Maps/Sets to plain objects/arrays for JSON
  const toolDist: Record<string, number> = {};
  for (const [k, v] of stats.toolDistribution) {
    toolDist[k] = v;
  }

  const topFiles = getTopFilesByEdits(stats.fileActivity, 10).map(([path, a]) => ({
    path,
    edits: a.editCount,
    reads: a.readCount,
    writes: a.writeCount,
    sessions: a.sessions.size,
  }));

  const output: Record<string, unknown> = {
    dataQuality: {
      sessionsAnalyzed: stats.sessionsAnalyzed,
      sessionsExact: stats.sessionsExact,
      sessionsPartial: stats.sessionsPartial,
      sessionsDamaged: stats.sessionsDamaged,
      dateRange: {
        from: stats.dateRange.from.toISOString(),
        to: stats.dateRange.to.toISOString(),
      },
      tokenMetadataAvailable: stats.tokenUsage.sessionsWithData,
    },
    sessions: {
      total: stats.sessionsAnalyzed,
      avgTurns: stats.sessionsAnalyzed > 0
        ? Math.round(stats.totalTurns / stats.sessionsAnalyzed)
        : 0,
    },
    toolCalls: {
      total: stats.totalToolCalls,
      distribution: toolDist,
    },
    topFilesByEdits: topFiles,
    delegations: stats.delegations.map((d) => ({
      agent: d.agentName,
      count: d.count,
      sessions: d.sessionIds.length,
    })),
    skillActivations: stats.skillActivations.map((s) => ({
      skill: s.skillName,
      explicit: s.explicitCount,
      auto: s.autoCount,
      sessions: s.sessionIds.length,
    })),
    tokenUsage: {
      totalInputTokens: stats.tokenUsage.inputTokens + stats.tokenUsage.cacheReadTokens + stats.tokenUsage.cacheCreationTokens,
      newInputTokens: stats.tokenUsage.inputTokens,
      outputTokens: stats.tokenUsage.outputTokens,
      cacheReadTokens: stats.tokenUsage.cacheReadTokens,
      cacheCreationTokens: stats.tokenUsage.cacheCreationTokens,
      completeness: stats.tokenUsage.completeness,
      sessionsWithData: stats.tokenUsage.sessionsWithData,
    },
  };

  if (tokenEconomics) {
    const costByModel: Record<string, number> = {};
    for (const [k, v] of tokenEconomics.costByModel) {
      costByModel[k] = Math.round(v * 100) / 100;
    }

    output.tokenEconomics = {
      sessionsWithTokenData: tokenEconomics.sessionsWithTokenData,
      sessionsTotal: tokenEconomics.sessionsTotal,
      startupCost: {
        estimatedConfigTokens: tokenEconomics.estimatedStartupTokens,
        actualFirstMessageTokens: tokenEconomics.actualFirstMessageTokens,
        baseContextTokens: Math.max(0, tokenEconomics.actualFirstMessageTokens - tokenEconomics.estimatedStartupTokens),
        configSharePercent: tokenEconomics.actualFirstMessageTokens > 0
          ? Math.round((tokenEconomics.estimatedStartupTokens / tokenEconomics.actualFirstMessageTokens) * 100)
          : 0,
      },
      cost: {
        totalEstimated: Math.round(tokenEconomics.totalEstimatedCost * 100) / 100,
        avgPerSession: Math.round(tokenEconomics.avgCostPerSession * 100) / 100,
        byModel: costByModel,
      },
      cache: {
        efficiency: tokenEconomics.overallCacheEfficiency,
        missBreakdown: tokenEconomics.cacheMissBreakdown,
      },
      compactions: {
        total: tokenEconomics.totalCompactions,
        sessionsAffected: tokenEconomics.sessionsWithCompaction,
      },
      sessionSnapshots: tokenEconomics.sessionSnapshots.map((s) => ({
        sessionId: s.sessionId,
        date: s.date.toISOString(),
        totalInput: s.totalInput,
        totalOutput: s.totalOutput,
        cacheReadTokens: s.cacheReadTokens,
        cacheCreationTokens: s.cacheCreationTokens,
        newInputTokens: s.newInputTokens,
        model: s.model,
      })),
    };
  }

  console.log(JSON.stringify(output, null, 2));
}
