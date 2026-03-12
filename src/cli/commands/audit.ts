import type { Command } from 'commander';
import { resolve as resolvePath } from 'path';
import chalk from 'chalk';
import { scan } from '../../core/scanner.js';
import { analyzeTranscriptsWithResults } from '../../core/transcript-analyzer.js';
import {
  produceUtilizationReport,
  enrichWithCompliance,
  type UtilizationOptions,
} from '../../core/transcript-utilization.js';
import { detectDiscrepancies, detectAgentBypasses } from '../../core/transcript-discrepancies.js';
import { resolve } from '../../core/resolver.js';
import { Linter } from '../../core/linter.js';
import { getAllRules } from '../../rules/index.js';
import { loadConfig } from '../../utils/config.js';
import { analyzeFileHeatmap } from '../../core/transcript-file-heatmap.js';
import { shortenPath } from '../output/terminal.js';
import type {
  ConfigUtilization,
  DiscrepancyReport,
  FileHeatmapReport,
  RuleUtilization,
  UtilizationReport,
} from '../../types/transcript.js';

export function registerAuditCommand(program: Command): void {
  program
    .command('audit')
    .description(
      'Config utilization audit — shows which config components were used at runtime',
    )
    .option('--days <n>', 'Analyze sessions from last N days', '30')
    .option('--since <date>', 'Analyze sessions after this date (ISO format)')
    .option('--session <uuid>', 'Analyze a specific session only')
    .action(async (_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const projectDir = globalOpts.projectDir as string | undefined;
      const format = globalOpts.format as string | undefined;
      const sessionId = _options.session as string | undefined;

      const resolvedProjectDir = resolvePath(projectDir || process.cwd());

      // Resolve days from --days or --since
      let days = parseInt(_options.days as string, 10);
      if (_options.since) {
        const sinceDate = new Date(_options.since as string);
        if (!isNaN(sinceDate.getTime())) {
          const diffMs = Date.now() - sinceDate.getTime();
          days = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
        }
      }
      if (isNaN(days)) days = 30;

      // 1. Scan current project config
      const inventory = scan({ projectDir: resolvedProjectDir });

      // 2. Analyze transcripts (with raw parse results for compliance checking)
      const { stats, parseResults } = await analyzeTranscriptsWithResults({
        projectRoot: resolvedProjectDir,
        days,
        sessionId,
      });

      // 3. Produce utilization report
      const utilizationOpts: UtilizationOptions = { days };
      const report = produceUtilizationReport(inventory, stats, utilizationOpts);

      // 3b. Enrich unconditional rules with compliance check results
      const allToolCalls = parseResults.flatMap((r) => r.toolCalls);
      const allTasks = parseResults.flatMap((r) => r.tasks);
      enrichWithCompliance(report, allToolCalls, allTasks, stats.toolDistribution);

      // 4. Detect discrepancies (requires linter + resolver)
      const resolved = resolve(inventory);
      const lintConfig = loadConfig(resolvedProjectDir);
      const linter = new Linter();
      linter.registerRules(getAllRules());
      const lintResult = linter.run(inventory, resolved, lintConfig);
      const discrepancyReport = detectDiscrepancies(
        inventory,
        stats,
        report,
        lintResult,
      );

      // 4b. Detect agent bypass patterns (heuristic)
      const agentBypasses = detectAgentBypasses(inventory, parseResults);
      discrepancyReport.discrepancies.push(...agentBypasses);

      // 5. Compute file heatmap
      const fileHeatmap = analyzeFileHeatmap(stats, { maxResults: 5 });

      // 6. Format output
      if (format === 'json') {
        printAuditJson(report, discrepancyReport, fileHeatmap);
      } else {
        printAuditTerminal(report, discrepancyReport, fileHeatmap, resolvedProjectDir);
      }
    });
}

// ---- Terminal output ----

function printAuditTerminal(
  report: UtilizationReport,
  discrepancyReport: DiscrepancyReport,
  fileHeatmap: FileHeatmapReport,
  projectRoot: string,
): void {
  console.log();
  console.log(chalk.bold('ccinspect audit'));
  console.log();

  if (report.sessionsAnalyzed === 0) {
    console.log(
      chalk.yellow(
        'No transcript files found. Run Claude Code sessions first, then re-run cci audit.',
      ),
    );
    console.log(
      chalk.dim('Claude Code transcripts are stored in ~/.claude/projects/.'),
    );
    console.log();
    return;
  }

  // Data quality header
  const qualityParts: string[] = [];
  qualityParts.push(
    `${report.sessionsAnalyzed} session${report.sessionsAnalyzed === 1 ? '' : 's'}`,
  );

  const completeParts: string[] = [];
  if (report.sessionsExact > 0)
    completeParts.push(`${report.sessionsExact} exact`);
  if (report.sessionsPartial > 0)
    completeParts.push(`${report.sessionsPartial} partial`);
  if (report.sessionsDamaged > 0)
    completeParts.push(chalk.red(`${report.sessionsDamaged} damaged`));
  if (completeParts.length > 0) qualityParts.push(completeParts.join(', '));
  qualityParts.push(`last ${report.days} days`);

  console.log(
    chalk.cyan('Config Utilization') +
      `  (${qualityParts.join(' · ')})`,
  );
  console.log();

  // Count warnings/infos for the summary footer
  const warningCount =
    discrepancyReport.discrepancies.filter((d) => d.severity === 'warning').length +
    report.rules.pathScoped.filter((r) => r.writeBlindnessSessions > 0).length;
  const infoCount = discrepancyReport.discrepancies.filter((d) => d.severity === 'info').length;

  // Count which sections will actually render (for footer)
  const rulesTotal = report.rules.pathScoped.length + report.rules.unconditional.length;
  let surfacesRendered = 0;
  if (report.agents.length > 0) surfacesRendered++;
  if (report.skills.length > 0) surfacesRendered++;
  if (rulesTotal > 0) surfacesRendered++;
  if (report.mcpServers.length > 0) surfacesRendered++;
  if (report.commands.length > 0) surfacesRendered++;

  // Sections
  printUtilizationSection(
    'Agents',
    report.agents,
    'delegated',
    'delegation',
    projectRoot,
    {
      unusedHint: (item) => `→ Remove ${item.configFile || item.name} or update its description`,
    },
  );
  printUtilizationSection(
    'Skills',
    report.skills,
    'activated',
    'activation',
    projectRoot,
    { unusedHint: () => '→ Remove or update this skill if no longer needed' },
  );
  printRulesSection(report.rules, report.sessionsAnalyzed, projectRoot);
  printUtilizationSection(
    'MCP Servers',
    report.mcpServers,
    'used',
    'tool call',
    projectRoot,
    { ghostHint: '→ Add to .mcp.json or remove from Claude Code settings' },
  );
  printUtilizationSection(
    'Commands',
    report.commands,
    'used',
    'invocation',
    projectRoot,
    { unusedHint: () => '→ Remove or migrate to a skill (commands are legacy)' },
  );
  printFileHeatmapSection(fileHeatmap, report.sessionsAnalyzed, projectRoot);
  printDiscrepancySection(discrepancyReport);

  // Summary footer
  console.log(chalk.dim('  ──────────────────────────────────────────────────────────'));
  const footerParts: string[] = [];
  if (warningCount > 0)
    footerParts.push(chalk.yellow(`${warningCount} warning${warningCount !== 1 ? 's' : ''}`));
  if (infoCount > 0)
    footerParts.push(chalk.blue(`${infoCount} info`));
  if (footerParts.length === 0)
    footerParts.push(chalk.green('no issues'));
  footerParts.push(`${surfacesRendered} config surface${surfacesRendered !== 1 ? 's' : ''} audited`);
  footerParts.push(`${report.sessionsAnalyzed} session${report.sessionsAnalyzed !== 1 ? 's' : ''} analyzed`);
  console.log('  ' + footerParts.join('  ·  '));
  console.log();
}

interface SectionHints {
  unusedHint?: (item: ConfigUtilization) => string;
  ghostHint?: string;
}

function printUtilizationSection(
  title: string,
  items: ConfigUtilization[],
  usedVerb: string,
  unitSingular: string,
  _projectRoot: string,
  hints: SectionHints = {},
): void {
  if (items.length === 0) return;

  const usedCount = items.filter((i) => i.used).length;
  const unusedCount = items.length - usedCount;

  // Check for ghost items (not in config, observed at runtime)
  const configuredItems = items.filter((i) => i.configFile !== '');
  const ghostItems = items.filter((i) => i.configFile === '');
  const configuredCount = configuredItems.length;

  const headerParts = [`${configuredCount} configured`];
  headerParts.push(`${usedCount} ${usedVerb}`);
  if (unusedCount > 0)
    headerParts.push(`${unusedCount} never ${usedVerb}`);

  console.log(
    `  ${chalk.bold(title)}${' '.repeat(Math.max(1, 18 - title.length))}${headerParts.join('  ·  ')}`,
  );

  // Sort: used first (desc by count), then unused
  const sorted = [...configuredItems].sort((a, b) => {
    if (a.used !== b.used) return a.used ? -1 : 1;
    return b.usageCount - a.usageCount;
  });

  for (const item of sorted) {
    const pad = ' '.repeat(Math.max(1, 20 - item.name.length));
    if (item.used) {
      const detail =
        item.details ?? item.usageCount + ' ' + unitSingular + s(item.usageCount);
      const tag = chalk.gray('(' + item.confidence + ')');
      console.log(
        '    ' + chalk.green('✓') + ' ' + item.name + pad + detail + '  ' + tag,
      );
    } else {
      const tag = chalk.gray('(' + item.confidence + ', ' + item.sessionsAnalyzed + ' sessions searched)');
      console.log(
        '    ' + chalk.gray('○') + ' ' + item.name + pad + '0 ' + unitSingular + 's  ' + tag,
      );
      if (hints.unusedHint) {
        console.log(chalk.dim.cyan('          ' + hints.unusedHint(item)));
      }
    }
  }

  // Ghost items (runtime-only, not in config)
  if (ghostItems.length > 0) {
    console.log();
    console.log('    ' + chalk.dim('Runtime-only (not in config):'));
    for (const item of ghostItems) {
      const pad = ' '.repeat(Math.max(1, 20 - item.name.length));
      const detail = item.details ?? item.usageCount + ' ' + unitSingular + s(item.usageCount);
      const tag = chalk.gray('(' + item.confidence + ')');
      console.log('    ' + chalk.yellow('?') + ' ' + item.name + pad + detail + '  ' + tag);
    }
    if (hints.ghostHint) {
      console.log(chalk.dim.cyan('      ' + hints.ghostHint));
    }
  }

  console.log();
}

function printRulesSection(
  rules: UtilizationReport['rules'],
  sessionsAnalyzed: number,
  _projectRoot: string,
): void {
  const total = rules.pathScoped.length + rules.unconditional.length;
  if (total === 0) return;

  console.log(
    `  ${chalk.bold('Rules')}${' '.repeat(13)}${total} total  ·  ${rules.unconditional.length} unconditional  ·  ${rules.pathScoped.length} path-scoped`,
  );
  console.log();

  // Path-scoped rules
  if (rules.pathScoped.length > 0) {
    console.log(`    ${chalk.bold('Path-scoped:')}`);

    // Sort: rules with matches first, then dormant
    const sorted = [...rules.pathScoped].sort((a, b) => {
      const aActive = a.matchingFilesRead > 0;
      const bActive = b.matchingFilesRead > 0;
      if (aActive !== bActive) return aActive ? -1 : 1;
      return b.matchingFilesRead - a.matchingFilesRead;
    });

    for (const rule of sorted) {
      const isActive = rule.matchingFilesRead > 0;
      const icon = isActive ? chalk.green('✓') : chalk.gray('○');
      const globStr = rule.globs
        ? chalk.gray(rule.globs.join(', '))
        : '';

      console.log(`      ${icon} ${rule.name}         ${chalk.dim('paths:')} ${globStr}`);

      if (isActive) {
        const tag = chalk.gray('(' + rule.confidence + ')');
        console.log(
          '          Matching files Read in ' + rule.sessionsWithMatch + '/' + sessionsAnalyzed + ' sessions  ' + tag,
        );
      } else if (
        rule.matchingFilesEditedWithoutRead === 0 &&
        rule.matchingFilesEdited === 0
      ) {
        console.log(
          `          No matching files touched  ${chalk.gray('(exact — dormant)')}`,
        );
      } else {
        console.log(
          `          No matching files Read  ${chalk.gray('(exact)')}`,
        );
      }

      if (rule.writeBlindnessSessions > 0) {
        const wbLabel = rule.writeBlindnessSessions + ' session' + s(rule.writeBlindnessSessions);
        if (rule.writeBlindnessFiles && rule.writeBlindnessFiles.length > 0) {
          console.log(
            chalk.yellow(`          ⚠ Write-blindness: ${wbLabel} had matching files Edited without Read:`),
          );
          for (const wbFile of rule.writeBlindnessFiles) {
            const sessNote = wbFile.editSessions === 1 ? '1 session' : `${wbFile.editSessions} sessions`;
            console.log(chalk.dim(`              ${wbFile.filePath} (${sessNote})`));
          }
        } else {
          console.log(
            chalk.yellow(`          ⚠ Write-blindness: ${wbLabel} had matching files Edited without Read`),
          );
        }
        console.log(chalk.dim.cyan('          → Add "Always Read a file before Editing" to CLAUDE.md'));
      }
    }
    console.log();
  }

  // Unconditional rules
  if (rules.unconditional.length > 0) {
    const costLabel = chalk.dim('(always loaded · ' + formatNumber(rules.totalUnconditionalTokens) + ' tokens startup cost):');
    console.log(
      '    ' + chalk.bold('Unconditional') + '  ' + costLabel,
    );

    for (const rule of rules.unconditional) {
      const tokens =
        rule.estimatedTokens !== undefined
          ? chalk.cyan(`${formatNumber(rule.estimatedTokens)} tokens`)
          : '';
      console.log(
        `      ${chalk.gray('·')} ${rule.name}${' '.repeat(Math.max(1, 28 - rule.name.length))}${tokens}`,
      );

      // Show compliance results or extracted instructions
      if (rule.complianceResults && rule.complianceResults.length > 0) {
        for (const cr of rule.complianceResults) {
          const heuristicTag = chalk.gray('(heuristic)');
          if (cr.totalDataPoints === 0) {
            // No relevant data — don't show verdict
            console.log(
              `          "${cr.instruction.matchedText}"  ${chalk.dim('No relevant data')}  ${heuristicTag}`,
            );
          } else if (cr.consistent) {
            console.log(
              `          "${cr.instruction.matchedText}"  ${chalk.green('✓')} ${cr.evidence}  ${heuristicTag}`,
            );
          } else {
            console.log(
              `          "${cr.instruction.matchedText}"  ${chalk.yellow('⚠')} ${cr.evidence}  ${heuristicTag}`,
            );
          }
        }
      } else if (rule.extractedInstructions && rule.extractedInstructions.length > 0) {
        // Instructions extracted but no compliance data (no matching transcript data)
        console.log(
          `          ${chalk.dim('Testable patterns found but no matching transcript data')}`,
        );
      } else {
        console.log(
          `          ${chalk.gray('No testable patterns found')}`,
        );
      }
    }
    console.log();
  }
}

function printFileHeatmapSection(
  heatmap: FileHeatmapReport,
  sessionsAnalyzed: number,
  projectRoot: string,
): void {
  if (heatmap.totalFilesTracked === 0) return;

  console.log(
    `  ${chalk.bold('File Activity')}${' '.repeat(5)}${formatNumber(heatmap.totalFilesTracked)} files tracked across ${sessionsAnalyzed} session${s(sessionsAnalyzed)}`,
  );
  console.log();

  // High-churn
  if (heatmap.highChurn.length > 0) {
    console.log(`    ${chalk.bold('High-churn (most edited):')}`);
    for (const entry of heatmap.highChurn) {
      const short = shortenPath(entry.filePath, projectRoot);
      const pad = ' '.repeat(Math.max(1, 40 - short.length));
      const eps = entry.editsPerSession !== undefined
        ? `${entry.editsPerSession} edits/session`
        : '';
      console.log(
        `      ${short}${pad}${formatNumber(entry.editCount + entry.writeCount)} edits · ${entry.sessionCount} session${s(entry.sessionCount)} · ${eps}`,
      );
    }
    console.log();
  }

  // Read-only references
  if (heatmap.readOnlyReferences.length > 0) {
    console.log(`    ${chalk.bold('Reference files (Read but never Edited):')}`);
    for (const entry of heatmap.readOnlyReferences) {
      const short = shortenPath(entry.filePath, projectRoot);
      const pad = ' '.repeat(Math.max(1, 40 - short.length));
      console.log(
        `      ${short}${pad}${formatNumber(entry.readCount)} reads · ${entry.sessionCount} session${s(entry.sessionCount)}`,
      );
    }
    console.log();
  }

  // Edit-without-read
  if (heatmap.editWithoutRead.length > 0) {
    console.log(`    ${chalk.bold('Edited-without-Read:')}`);
    for (const entry of heatmap.editWithoutRead) {
      const short = shortenPath(entry.filePath, projectRoot);
      const pad = ' '.repeat(Math.max(1, 40 - short.length));
      console.log(
        `      ${short}${pad}${formatNumber(entry.editCount + entry.writeCount)} edits · 0 reads · ${entry.sessionCount} session${s(entry.sessionCount)}`,
      );
    }
    console.log();
  }

  // Test correlation
  if (heatmap.testCorrelation.editedSourceFiles > 0) {
    const tc = heatmap.testCorrelation;
    const pct = tc.correlationPercent;
    let colorFn = chalk.red;
    if (pct > 60) colorFn = chalk.green;
    else if (pct >= 30) colorFn = chalk.yellow;
    console.log(`    ${chalk.bold('Test correlation:')}`);
    console.log(
      colorFn(`      ${tc.withTestActivity}/${tc.editedSourceFiles} edited source files had test file activity (${pct}%)`),
    );
    if (tc.untestedFiles.length > 0) {
      console.log(
        `      ${tc.withoutTestActivity} source file${s(tc.withoutTestActivity)} edited without corresponding test activity`,
      );
    }
    if (pct < 30) {
      console.log(chalk.dim.cyan('      → Consider adding a path-scoped rule to enforce test-after-edit discipline'));
    }
    console.log();
  }

  // Co-edit clusters
  if (heatmap.coEditClusters && heatmap.coEditClusters.length > 0) {
    console.log(`    ${chalk.bold('Co-edit clusters:')}`);
    for (const cluster of heatmap.coEditClusters) {
      console.log(
        `      ${cluster.files.length} files co-edited in ${cluster.sharedSessions}+ sessions:`,
      );
      for (const f of cluster.files) {
        console.log(`        ${chalk.dim(shortenPath(f, projectRoot))}`);
      }
    }
    console.log();
  }
}

function printDiscrepancySection(report: DiscrepancyReport): void {
  if (report.discrepancies.length === 0) return;

  const warnings = report.discrepancies.filter((d) => d.severity === 'warning').length;
  const infos = report.discrepancies.filter((d) => d.severity === 'info').length;
  const breakdownParts: string[] = [];
  if (warnings > 0) breakdownParts.push(`${warnings} warning${warnings !== 1 ? 's' : ''}`);
  if (infos > 0) breakdownParts.push(`${infos} info`);
  const breakdown = breakdownParts.length > 0 ? `  (${breakdownParts.join(' · ')})` : '';
  console.log(
    `  ${chalk.bold('Discrepancies')}${' '.repeat(5)}${report.discrepancies.length} found` +
      chalk.dim(breakdown),
  );
  console.log();

  for (const d of report.discrepancies) {
    if (d.type === 'ephemeral-teammates') {
      // Collapsed info summary for Agent Teams ephemeral teammates
      console.log(`    ${chalk.blue('\u2139')} ${d.message}`);
      console.log(`      ${chalk.dim(d.evidence)}`);
    } else {
      const icon = d.severity === 'warning' ? chalk.yellow('\u26a0') : chalk.blue('\u2139');
      const sessionInfo = d.sessionCount > 0 ? `, ${d.sessionCount}/${d.sessionsAnalyzed} sessions` : '';
      const confTag = chalk.gray(`(${d.confidence}${sessionInfo})`);
      console.log(`    ${icon} ${d.message}  ${confTag}`);
      if (d.evidence) {
        console.log(`      ${chalk.dim(d.evidence)}`);
      }
    }
  }
  console.log();
}

function s(n: number): string {
  return n !== 1 ? 's' : '';
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

// ---- JSON output ----

function printAuditJson(
  report: UtilizationReport,
  discrepancyReport: DiscrepancyReport,
  fileHeatmap: FileHeatmapReport,
): void {
  const output = {
    dataQuality: {
      sessionsAnalyzed: report.sessionsAnalyzed,
      sessionsExact: report.sessionsExact,
      sessionsPartial: report.sessionsPartial,
      sessionsDamaged: report.sessionsDamaged,
      dateRange: {
        from: report.dateRange.from.toISOString(),
        to: report.dateRange.to.toISOString(),
      },
      days: report.days,
    },
    agents: report.agents.map(serializeUtilization),
    skills: report.skills.map(serializeUtilization),
    mcpServers: report.mcpServers.map(serializeUtilization),
    commands: report.commands.map(serializeUtilization),
    rules: {
      pathScoped: report.rules.pathScoped.map(serializeRuleUtilization),
      unconditional: report.rules.unconditional.map(serializeRuleUtilization),
      totalUnconditionalTokens: report.rules.totalUnconditionalTokens,
    },
    discrepancies: discrepancyReport.discrepancies.map((d) => ({
      type: d.type,
      severity: d.severity,
      confidence: d.confidence,
      message: d.message,
      componentName: d.componentName,
      componentType: d.componentType,
      evidence: d.evidence,
      sessionCount: d.sessionCount,
      sessionsAnalyzed: d.sessionsAnalyzed,
    })),
    fileHeatmap: {
      totalFilesTracked: fileHeatmap.totalFilesTracked,
      highChurn: fileHeatmap.highChurn,
      readOnlyReferences: fileHeatmap.readOnlyReferences,
      editWithoutRead: fileHeatmap.editWithoutRead,
      testCorrelation: fileHeatmap.testCorrelation,
      coEditClusters: fileHeatmap.coEditClusters,
    },
  };

  console.log(JSON.stringify(output, null, 2));
}

function serializeUtilization(item: ConfigUtilization): Record<string, unknown> {
  return {
    name: item.name,
    configFile: item.configFile,
    scope: item.scope,
    used: item.used,
    usageCount: item.usageCount,
    sessionCount: item.sessionCount,
    sessionsAnalyzed: item.sessionsAnalyzed,
    confidence: item.confidence,
    ...(item.details ? { details: item.details } : {}),
  };
}

function serializeRuleUtilization(rule: RuleUtilization): Record<string, unknown> {
  return {
    name: rule.name,
    configFile: rule.configFile,
    scope: rule.scope,
    ruleType: rule.ruleType,
    ...(rule.globs ? { globs: rule.globs } : {}),
    matchingFilesRead: rule.matchingFilesRead,
    matchingFilesEdited: rule.matchingFilesEdited,
    matchingFilesEditedWithoutRead: rule.matchingFilesEditedWithoutRead,
    sessionsWithMatch: rule.sessionsWithMatch,
    writeBlindnessSessions: rule.writeBlindnessSessions,
    ...(rule.writeBlindnessFiles ? { writeBlindnessFiles: rule.writeBlindnessFiles } : {}),
    ...(rule.estimatedTokens !== undefined
      ? { estimatedTokens: rule.estimatedTokens }
      : {}),
    ...(rule.extractedInstructions
      ? { extractedInstructions: rule.extractedInstructions }
      : {}),
    ...(rule.complianceResults
      ? { complianceResults: rule.complianceResults }
      : {}),
    sessionsAnalyzed: rule.sessionsAnalyzed,
    confidence: rule.confidence,
  };
}
