import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolve as resolvePath, dirname, relative } from 'path';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { scan } from '../core/scanner.js';
import { resolve } from '../core/resolver.js';
import type { ParsedConfigLayers } from '../core/resolver.js';
import { Linter } from '../core/linter.js';
import { getAllRules } from '../rules/index.js';
import { loadConfig, toLintConfig } from '../utils/config.js';
import { runHistoryReconstruction } from '../core/history-integration.js';
import { getHistory, getVersion, computeLineage, appendRestoreVersion } from '../core/history-reconstructor.js';
import { diffVersions, resolveVersion } from '../core/snapshot-diff.js';
import { parseSettingsJson } from '../parsers/settings-json.js';
import { parseMcpJson } from '../parsers/mcp-json.js';
import { buildSingleFileInventory } from '../utils/single-file-inventory.js';
import { getRuleMetadata } from '../rules/rule-metadata.js';
import { classifyConfigFile } from '../utils/file-classifier.js';
import { analyzeTranscriptsWithResults } from '../core/transcript-analyzer.js';
import {
  produceUtilizationReport,
  enrichWithCompliance,
} from '../core/transcript-utilization.js';
import { detectDiscrepancies, detectAgentBypasses } from '../core/transcript-discrepancies.js';
import { analyzeFileHeatmap } from '../core/transcript-file-heatmap.js';
import {
  attributeSessions,
  buildVersionBreakdown,
  countSupersededSessions,
  detectRetentionGap,
} from '../core/version-attributor.js';
import { hashFiles } from '../utils/content-hash.js';
import type { ConfigVersion, HistoryEntry } from '../types/history.js';
import type { ConfigInventory, LintIssue } from '../types/index.js';

/**
 * Read package version from package.json at runtime.
 * We cannot use the build-time PKG_VERSION define here since the MCP server
 * may be loaded separately from the CLI entry point.
 */
function getPackageVersion(): string {
  try {
    const pkgPath = new URL('../../package.json', import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

// ---- Shared helpers ----

function resolveProjectDir(projectDir?: string): string {
  return resolvePath(projectDir || process.cwd());
}

function validateProjectDir(dir: string): string | null {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return `Directory not found: ${dir}`;
  }
  return null;
}

function buildParsedLayers(inventory: ConfigInventory): ParsedConfigLayers {
  return {
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
}

/**
 * Enrich lint issues with LLM-friendly metadata (rule descriptions, fix categories, etc.).
 * Local copy to avoid importing from src/cli/ (library boundary).
 */
function enrichLintIssues(issues: LintIssue[], projectRoot: string): void {
  for (const issue of issues) {
    const meta = getRuleMetadata(issue.ruleId);
    if (meta) {
      issue.fixCategory = meta.fixCategory;
      issue.fixComplexity = meta.fixComplexity;
      issue.ruleDescription = meta.ruleDescription;
      issue.docUrl = meta.docUrl;
    }
    if (issue.file) {
      issue.fileRelativePath = relative(projectRoot, issue.file) || issue.file;
      const fileType = classifyConfigFile(issue.file);
      if (fileType) {
        issue.fileType = fileType;
      }
    }
  }
}

function textResult(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }], isError: true };
}

// ---- Tool handlers (exported for testing) ----

export async function handleLint(args: {
  projectDir?: string;
  target?: string;
  minSeverity?: string;
}): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: true }> {
  const minSev = args.minSeverity ?? 'info';
  const severityLevel: Record<string, number> = { error: 2, warning: 1, info: 0 };
  const minLevel = severityLevel[minSev] ?? 0;

  // Single-file mode
  if (args.target) {
    const resolvedTarget = resolvePath(args.target);
    if (!existsSync(resolvedTarget)) {
      return errorResult(`File not found: ${resolvedTarget}`);
    }
    if (!statSync(resolvedTarget).isFile()) {
      return errorResult(`Target is not a file: ${resolvedTarget}`);
    }

    const ctx = await buildSingleFileInventory(resolvedTarget);
    const ccinspectConfig = loadConfig(ctx.inventory.projectRoot);
    const lintConfig = toLintConfig(ccinspectConfig);

    const linter = new Linter();
    linter.registerRules(getAllRules());
    const result = linter.run(ctx.inventory, ctx.resolved, lintConfig, ctx.fileType);

    const filteredIssues = result.issues.filter(
      (i) => (severityLevel[i.severity] ?? 0) >= minLevel,
    );
    enrichLintIssues(filteredIssues, ctx.inventory.projectRoot);

    return textResult({
      singleFileMode: { file: ctx.filePath, type: ctx.fileType },
      issues: filteredIssues,
      stats: result.stats,
    });
  }

  // Directory mode
  const dir = resolveProjectDir(args.projectDir);
  const err = validateProjectDir(dir);
  if (err) return errorResult(err);

  const inventory = scan({ projectDir: dir });
  const config = loadConfig(dir);
  await runHistoryReconstruction(dir, inventory, 'lint', config.history);

  const layers = buildParsedLayers(inventory);
  const resolved = resolve(inventory, layers);
  const lintConfig = toLintConfig(config);

  const linter = new Linter();
  linter.registerRules(getAllRules());
  const result = linter.run(inventory, resolved, lintConfig);

  const filteredIssues = result.issues.filter(
    (i) => (severityLevel[i.severity] ?? 0) >= minLevel,
  );
  enrichLintIssues(filteredIssues, dir);

  return textResult({
    issues: filteredIssues,
    stats: result.stats,
  });
}

export async function handleScan(args: {
  projectDir?: string;
}): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: true }> {
  const dir = resolveProjectDir(args.projectDir);
  const err = validateProjectDir(dir);
  if (err) return errorResult(err);

  const inventory = scan({ projectDir: dir });
  const config = loadConfig(dir);
  await runHistoryReconstruction(dir, inventory, 'scan', config.history);

  return textResult(inventory);
}

export async function handleAudit(args: {
  projectDir?: string;
  days?: number;
  allVersions?: boolean;
  version?: number;
}): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: true }> {
  const dir = resolveProjectDir(args.projectDir);
  const err = validateProjectDir(dir);
  if (err) return errorResult(err);

  const days = args.days ?? 30;

  const inventory = scan({ projectDir: dir });
  const config = loadConfig(dir);
  await runHistoryReconstruction(dir, inventory, 'audit', config.history);

  const { stats, parseResults } = await analyzeTranscriptsWithResults({
    projectRoot: dir,
    days,
  });

  // Version attribution
  let versionContext: Record<string, unknown> | null = null;
  const history = getHistory(dir);
  if (history.length > 0 && stats.sessionsAnalyzed > 0) {
    const sessionStartDates = new Map<string, Date>();
    for (const pr of parseResults) {
      sessionStartDates.set(pr.session.sessionId, pr.session.startedAt);
    }
    const attributions = attributeSessions(sessionStartDates, history);
    const breakdown = buildVersionBreakdown(attributions, history, stats);
    const lineage = computeLineage(history);
    const activeLineage = [...lineage].sort((a, b) => b - a);
    const latest = history[history.length - 1];
    const superseded = countSupersededSessions(attributions);
    const retentionWarning = detectRetentionGap(history, stats);

    versionContext = {
      activeVersion: latest.version,
      activeVersionDate: latest.timestamp,
      activeLineage,
      supersededSessionCount: superseded.count,
      supersededVersions: [...superseded.versions].sort((a, b) => a - b),
      retentionWarning,
      breakdown: breakdown.map((e) => ({
        version: e.version,
        inActiveLineage: e.inActiveLineage,
        source: e.source,
        timestamp: e.timestamp,
        ...(e.restoredFrom !== undefined ? { restoredFrom: e.restoredFrom } : {}),
        activeFrom: e.activeFrom,
        activeTo: e.activeTo,
        sessionCount: e.sessionCount,
        activeDays: e.activeDays,
        topDelegations: e.topDelegations,
      })),
    };
  }

  // Utilization
  const report = produceUtilizationReport(inventory, stats, { days });
  const allToolCalls = parseResults.flatMap((r) => r.toolCalls);
  const allTasks = parseResults.flatMap((r) => r.tasks);
  enrichWithCompliance(report, allToolCalls, allTasks, stats.toolDistribution);

  // Discrepancies
  const resolved = resolve(inventory);
  const linter = new Linter();
  linter.registerRules(getAllRules());
  const lintResult = linter.run(inventory, resolved, config);
  const discrepancyReport = detectDiscrepancies(inventory, stats, report, lintResult);
  const agentBypasses = detectAgentBypasses(inventory, parseResults);
  discrepancyReport.discrepancies.push(...agentBypasses);

  // File heatmap
  const fileHeatmap = analyzeFileHeatmap(stats, { maxResults: 5 });

  const output: Record<string, unknown> = {
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
    agents: report.agents,
    skills: report.skills,
    mcpServers: report.mcpServers,
    commands: report.commands,
    rules: {
      pathScoped: report.rules.pathScoped,
      unconditional: report.rules.unconditional,
      totalUnconditionalTokens: report.rules.totalUnconditionalTokens,
    },
    discrepancies: discrepancyReport.discrepancies,
    fileHeatmap,
  };

  if (versionContext) {
    output.versionContext = versionContext;
  }

  return textResult(output);
}

export async function handleHistory(args: {
  projectDir?: string;
  configPath?: string;
  lineageOnly?: boolean;
  last?: number;
}): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: true }> {
  const dir = resolveProjectDir(args.projectDir);
  const err = validateProjectDir(dir);
  if (err) return errorResult(err);

  const inventory = scan({ projectDir: dir });
  const config = loadConfig(dir);
  await runHistoryReconstruction(dir, inventory, 'history', config.history);

  let entries = getHistory(dir);
  if (entries.length === 0) {
    return textResult({ configPath: args.configPath ?? null, totalVersions: 0, lineage: [], entries: [] });
  }

  // Filter by file if requested
  if (args.configPath) {
    const resolvedConfigPath = resolvePath(args.configPath);
    const relPath = inventory.gitRoot
      ? relative(inventory.gitRoot, resolvedConfigPath)
      : relative(dir, resolvedConfigPath);

    entries = entries.filter((e) => {
      if (e.summary.includes(relPath)) return true;
      if (e.restoredFrom !== undefined) return true;
      if (e.version === 1) return true;
      const version = getVersion(dir, e.version);
      return version ? version.files.some((f) => f.relativePath === relPath) : false;
    });
  }

  const lineage = computeLineage(getHistory(dir));
  if (args.lineageOnly) {
    entries = entries.filter((e) => lineage.has(e.version));
  }

  if (args.last && args.last > 0) {
    entries = entries.slice(-args.last);
  }

  return textResult({
    configPath: args.configPath ?? null,
    totalVersions: entries.length,
    lineage: [...lineage].sort((a, b) => a - b),
    entries,
  });
}

export async function handleDiff(args: {
  projectDir?: string;
  v1: string;
  v2: string;
  configPath?: string;
}): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: true }> {
  const dir = resolveProjectDir(args.projectDir);
  const err = validateProjectDir(dir);
  if (err) return errorResult(err);

  const inventory = scan({ projectDir: dir });
  const config = loadConfig(dir);
  await runHistoryReconstruction(dir, inventory, 'diff', config.history);

  const entries = getHistory(dir);
  if (entries.length === 0) {
    return errorResult('No config history found.');
  }

  const versionA = resolveVersion(dir, args.v1, inventory.gitRoot);
  const versionB = resolveVersion(dir, args.v2, inventory.gitRoot);

  if (!versionA) return errorResult(`Version "${args.v1}" not found`);
  if (!versionB) return errorResult(`Version "${args.v2}" not found`);

  let relConfigPath: string | undefined;
  if (args.configPath) {
    const absConfigPath = resolvePath(args.configPath);
    relConfigPath = inventory.gitRoot
      ? relative(inventory.gitRoot, absConfigPath)
      : relative(dir, absConfigPath);
  }

  const result = diffVersions(dir, versionA, versionB, relConfigPath);

  const entryA = args.v1 === 'current' ? undefined : entries.find((e) => e.version === versionA.version);
  const entryB = args.v2 === 'current' ? undefined : entries.find((e) => e.version === versionB.version);

  return textResult({
    versionA: {
      version: args.v1 === 'current' ? 'current' : versionA.version,
      timestamp: entryA?.timestamp ?? new Date().toISOString(),
      source: args.v1 === 'current' ? 'disk' : entryA?.source,
    },
    versionB: {
      version: args.v2 === 'current' ? 'current' : versionB.version,
      timestamp: entryB?.timestamp ?? new Date().toISOString(),
      source: args.v2 === 'current' ? 'disk' : entryB?.source,
    },
    summary: result.summary,
    files: result.files,
  });
}

export async function handleRestore(args: {
  projectDir?: string;
  version: number;
  configPath?: string;
  dryRun?: boolean;
}): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: true }> {
  const dir = resolveProjectDir(args.projectDir);
  const err = validateProjectDir(dir);
  if (err) return errorResult(err);

  const inventory = scan({ projectDir: dir });
  const config = loadConfig(dir);
  await runHistoryReconstruction(dir, inventory, 'restore', config.history);

  const targetVersion = resolveVersion(dir, String(args.version), inventory.gitRoot);
  if (!targetVersion) return errorResult(`Version ${args.version} not found`);

  const currentVersion = resolveVersion(dir, 'current', inventory.gitRoot);
  if (!currentVersion) return errorResult('Could not read current disk state');

  let filesToRestore = targetVersion.files;
  if (args.configPath) {
    const absConfigPath = resolvePath(args.configPath);
    filesToRestore = targetVersion.files.filter(
      (f) => f.absolutePath === absConfigPath || f.relativePath === args.configPath,
    );
    if (filesToRestore.length === 0) {
      return errorResult(`File "${args.configPath}" not found in version ${args.version}`);
    }
  }

  const diff = diffVersions(dir, currentVersion, targetVersion, args.configPath);

  if (diff.summary.filesChanged === 0) {
    return textResult({ message: 'No differences — disk state already matches the target version.', filesWritten: 0 });
  }

  if (args.dryRun) {
    return textResult({
      dryRun: true,
      restoredFrom: args.version,
      summary: diff.summary,
      files: diff.files.filter((f) => f.status !== 'unchanged'),
    });
  }

  // Write restored files
  let filesWritten = 0;
  const errors: string[] = [];
  for (const file of filesToRestore) {
    const absPath = file.absolutePath;
    const parentDir = dirname(absPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
    try {
      writeFileSync(absPath, file.content, 'utf-8');
      filesWritten++;
    } catch (writeErr) {
      errors.push(`Failed to write ${file.relativePath}: ${writeErr}`);
    }
  }

  // Record restore version
  const restoreVersion: ConfigVersion = {
    version: 0,
    parentVersion: targetVersion.version,
    restoredFrom: targetVersion.version,
    timestamp: new Date().toISOString(),
    source: 'restore',
    trigger: 'restore',
    contentHash: hashFiles(filesToRestore),
    tokenCount: filesToRestore.reduce((sum, f) => sum + f.estimatedTokens, 0),
    files: filesToRestore,
  };

  const assignedVersion = appendRestoreVersion(dir, restoreVersion);

  return textResult({
    restoredFrom: args.version,
    newVersion: assignedVersion,
    filesWritten,
    summary: diff.summary,
    ...(errors.length > 0 ? { errors } : {}),
  });
}

export async function handleHealthCheck(args: {
  projectDir?: string;
  days?: number;
}): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: true }> {
  const dir = resolveProjectDir(args.projectDir);
  const err = validateProjectDir(dir);
  if (err) return errorResult(err);

  const days = args.days ?? 30;
  const output: Record<string, unknown> = {};

  // 1. Scan
  let inventory: ConfigInventory;
  try {
    inventory = scan({ projectDir: dir });
    const config = loadConfig(dir);
    await runHistoryReconstruction(dir, inventory, 'health_check', config.history);

    const files = [
      ...(inventory.projectClaudeMd?.exists ? [summarizeFile(inventory.projectClaudeMd, dir)] : []),
      ...(inventory.localClaudeMd?.exists ? [summarizeFile(inventory.localClaudeMd, dir)] : []),
      ...(inventory.globalClaudeMd?.exists ? [summarizeFile(inventory.globalClaudeMd, dir)] : []),
      ...(inventory.projectSettings?.exists ? [summarizeFile(inventory.projectSettings, dir)] : []),
      ...(inventory.localSettings?.exists ? [summarizeFile(inventory.localSettings, dir)] : []),
      ...(inventory.userSettings?.exists ? [summarizeFile(inventory.userSettings, dir)] : []),
      ...(inventory.projectMcp?.exists ? [summarizeFile(inventory.projectMcp, dir)] : []),
      ...inventory.rules.filter(f => f.exists).map(f => summarizeFile(f, dir)),
      ...inventory.projectAgents.filter(f => f.exists).map(f => summarizeFile(f, dir)),
      ...inventory.projectSkills.filter(f => f.exists).map(f => summarizeFile(f, dir)),
      ...inventory.projectCommands.filter(f => f.exists).map(f => summarizeFile(f, dir)),
    ];

    output.scan = {
      totalFiles: inventory.totalFiles,
      totalStartupTokens: inventory.totalStartupTokens,
      totalOnDemandTokens: inventory.totalOnDemandTokens,
      files,
    };
  } catch (e) {
    inventory = scan({ projectDir: dir }); // fallback for later steps
    output.scan = { error: `Scan failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  // 2. Lint
  try {
    const config = loadConfig(dir);
    const layers = buildParsedLayers(inventory);
    const resolved = resolve(inventory, layers);
    const lintConfig = toLintConfig(config);

    const linter = new Linter();
    linter.registerRules(getAllRules());
    const result = linter.run(inventory, resolved, lintConfig);

    enrichLintIssues(result.issues, dir);

    output.lint = {
      summary: {
        errors: result.stats.errors,
        warnings: result.stats.warnings,
        infos: result.stats.infos,
        rulesRun: result.stats.rulesRun,
      },
      issues: result.issues,
    };
  } catch (e) {
    output.lint = { error: `Lint failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  // 3. History
  try {
    const entries = getHistory(dir);
    const lineage = entries.length > 0 ? computeLineage(entries) : new Set<number>();
    const recent = entries.slice(-5);

    output.history = {
      totalVersions: entries.length,
      lineageVersions: lineage.size,
      recentChanges: recent,
    };
  } catch (e) {
    output.history = { error: `History failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  // 4. Audit
  try {
    const { stats, parseResults } = await analyzeTranscriptsWithResults({
      projectRoot: dir,
      days,
    });

    if (stats.sessionsAnalyzed > 0) {
      const report = produceUtilizationReport(inventory, stats, { days });
      const allToolCalls = parseResults.flatMap((r) => r.toolCalls);
      const allTasks = parseResults.flatMap((r) => r.tasks);
      enrichWithCompliance(report, allToolCalls, allTasks, stats.toolDistribution);

      const resolved = resolve(inventory);
      const linter = new Linter();
      linter.registerRules(getAllRules());
      const lintResult = linter.run(inventory, resolved, loadConfig(dir));
      const discrepancyReport = detectDiscrepancies(inventory, stats, report, lintResult);
      const agentBypasses = detectAgentBypasses(inventory, parseResults);
      discrepancyReport.discrepancies.push(...agentBypasses);

      const fileHeatmap = analyzeFileHeatmap(stats, { maxResults: 5 });

      output.audit = {
        sessionsAnalyzed: stats.sessionsAnalyzed,
        agents: report.agents,
        skills: report.skills,
        mcpServers: report.mcpServers,
        discrepancies: discrepancyReport.discrepancies,
        fileHeatmap,
      };
    } else {
      output.audit = { sessionsAnalyzed: 0, message: 'No transcript sessions found' };
    }
  } catch (e) {
    output.audit = { error: `Audit failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  return textResult(output);
}

function summarizeFile(
  file: { path: string; scope: string; estimatedTokens: number; lineCount: number },
  projectRoot: string,
): { path: string; type: string | null; tokens: number; scope: string } {
  return {
    path: relative(projectRoot, file.path) || file.path,
    type: classifyConfigFile(file.path),
    tokens: file.estimatedTokens,
    scope: file.scope,
  };
}

export async function handleBlame(args: {
  projectDir?: string;
}): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: true }> {
  const dir = resolveProjectDir(args.projectDir);
  const err = validateProjectDir(dir);
  if (err) return errorResult(err);

  const inventory = scan({ projectDir: dir });
  const config = loadConfig(dir);
  await runHistoryReconstruction(dir, inventory, 'blame', config.history);

  const layers = buildParsedLayers(inventory);
  const resolved = resolve(inventory, layers);

  return textResult(resolved);
}

// ---- Server creation ----

export function createServer(): McpServer {
  const version = getPackageVersion();

  const server = new McpServer(
    { name: 'ccinspect', version },
    {
      instructions: `ccinspect is a Claude Code configuration inspector. Use it to:
- Validate config files after any edit (lint)
- Check which configs exist and their sizes (scan)
- See which agents/skills/rules are actually used (audit)
- View config change history from git and transcripts (history)
- Compare config versions (diff)
- Roll back to a previous config version (restore)
- See where each setting comes from (blame)
- Run a comprehensive health check covering all of the above (health_check)

Run lint automatically after creating or editing any file in .claude/,
CLAUDE.md, or .mcp.json. The tool returns actionable fix suggestions.`,
    },
  );

  // ---- lint ----
  server.tool(
    'lint',
    'Validate Claude Code configuration files. Returns actionable issues with fix suggestions, severity, and file locations. Run after editing any config file to catch problems.',
    {
      projectDir: z.string().optional().describe('Project directory (default: cwd)'),
      target: z.string().optional().describe('Specific file path to lint (optional, for single-file mode)'),
      minSeverity: z.enum(['error', 'warning', 'info']).optional().describe('Minimum severity to show (default: info)'),
    },
    async (args) => {
      try {
        return await handleLint(args);
      } catch (e) {
        return errorResult(`Lint failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  // ---- scan ----
  server.tool(
    'scan',
    'Discover all Claude Code configuration files in a project. Shows what exists, file sizes, token counts, and git status.',
    {
      projectDir: z.string().optional().describe('Project directory (default: cwd)'),
    },
    async (args) => {
      try {
        return await handleScan(args);
      } catch (e) {
        return errorResult(`Scan failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  // ---- audit ----
  server.tool(
    'audit',
    'Analyze config utilization by cross-referencing session transcripts. Shows which agents, skills, rules, and MCP servers are actually being used, with version-aware attribution.',
    {
      projectDir: z.string().optional().describe('Project directory (default: cwd)'),
      days: z.number().optional().describe('Analyze sessions from last N days (default: 30)'),
      allVersions: z.boolean().optional().describe('Include sessions during superseded config versions'),
      version: z.number().optional().describe('Filter to a specific config version only'),
    },
    async (args) => {
      try {
        return await handleAudit(args);
      } catch (e) {
        return errorResult(`Audit failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  // ---- history ----
  server.tool(
    'history',
    'Show config change history reconstructed from git commits, Claude Code transcripts, and disk state. Shows who changed what and when.',
    {
      projectDir: z.string().optional().describe('Project directory (default: cwd)'),
      configPath: z.string().optional().describe('Config file path to show history for'),
      lineageOnly: z.boolean().optional().describe('Show only versions in the active ancestry'),
      last: z.number().optional().describe('Show only last N versions'),
    },
    async (args) => {
      try {
        return await handleHistory(args);
      } catch (e) {
        return errorResult(`History failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  // ---- diff ----
  server.tool(
    'diff',
    'Compare two config versions. Shows exactly what changed between any two points in config history.',
    {
      projectDir: z.string().optional().describe('Project directory (default: cwd)'),
      v1: z.string().describe('First version (e.g., "v1", "1", or "current")'),
      v2: z.string().describe('Second version (e.g., "v2", "2", or "current")'),
      configPath: z.string().optional().describe('Restrict diff to a single config file'),
    },
    async (args) => {
      try {
        return await handleDiff(args);
      } catch (e) {
        return errorResult(`Diff failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  // ---- restore ----
  server.tool(
    'restore',
    'Roll back config files to a previous version. Creates a safety snapshot before writing. Use after identifying a problematic change via history or diff.',
    {
      projectDir: z.string().optional().describe('Project directory (default: cwd)'),
      version: z.number().describe('Version number to restore to'),
      configPath: z.string().optional().describe('Restrict restore to a single config file'),
      dryRun: z.boolean().optional().describe('Show what would change without writing'),
    },
    async (args) => {
      try {
        return await handleRestore(args);
      } catch (e) {
        return errorResult(`Restore failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  // ---- blame ----
  server.tool(
    'blame',
    'Show effective merged configuration with origin tracking. Reveals which settings file provides each value after precedence resolution.',
    {
      projectDir: z.string().optional().describe('Project directory (default: cwd)'),
    },
    async (args) => {
      try {
        return await handleBlame(args);
      } catch (e) {
        return errorResult(`Blame failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  // ---- health_check ----
  server.tool(
    'health_check',
    'Run a comprehensive config health check: lint all files, scan inventory, check audit utilization, and show recent history. Use when user asks for a full config review, health check, or config overview.',
    {
      projectDir: z.string().optional().describe('Project directory (default: cwd)'),
      days: z.number().optional().describe('Analyze audit sessions from last N days (default: 30)'),
    },
    async (args) => {
      try {
        return await handleHealthCheck(args);
      } catch (e) {
        return errorResult(`Health check failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  return server;
}

/**
 * Start the MCP server on stdio transport.
 * Blocks until the transport closes.
 */
export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
