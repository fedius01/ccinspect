import chalk from 'chalk';
import type { FileInfo, ConfigInventory, LintResult, ResolvedConfig } from '../../types/index.js';
import type { RuntimeInfo } from '../../types/runtime.js';
import type { ProjectComparison } from '../commands/compare.js';

// ---- ANSI stripping ----

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(str: string): number {
  return str.replace(ANSI_RE, '').length;
}

/** Pad a string that may contain ANSI codes to a visible width (left-align). */
function padEnd(str: string, width: number): string {
  const visible = stripAnsi(str);
  return visible >= width ? str : str + ' '.repeat(width - visible);
}

// ---- Formatting helpers ----

function formatSize(bytes: number): string {
  if (bytes === 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTokens(tokens: number): string {
  if (tokens === 0) return '-';
  if (tokens < 1000) return `${tokens}`;
  return `${(tokens / 1000).toFixed(1)}k`;
}

function fileStatusIcon(file: FileInfo | null): string {
  if (!file) return chalk.gray('-');
  if (!file.exists) return chalk.gray('-');
  if (file.gitTracked) return chalk.green('\u2713');
  return chalk.yellow('\u25cb');
}

function scopeColor(scope: string): string {
  switch (scope) {
    case 'enterprise':
      return chalk.red(scope);
    case 'user':
      return chalk.blue(scope);
    case 'project-shared':
      return chalk.green(scope);
    case 'project-local':
      return chalk.yellow(scope);
    default:
      return scope;
  }
}

function severityIcon(severity: string): string {
  switch (severity) {
    case 'error':
      return chalk.red('\u2716');
    case 'warning':
      return chalk.yellow('\u26a0');
    case 'info':
      return chalk.blue('\u2139');
    default:
      return ' ';
  }
}

// ---- Inventory table (scan) ----

interface InventoryRow {
  icon: string;
  file: string;
  exists: string;
  scope: string;
  size: string;
  lines: string;
  tokens: string;
  section?: string; // section header to print before this row group
}

function buildFileRow(label: string, file: FileInfo | null): InventoryRow | null {
  if (!file) return null;

  return {
    icon: fileStatusIcon(file),
    file: label,
    exists: file.exists ? 'YES' : 'no',
    scope: file.scope,
    size: file.exists ? formatSize(file.sizeBytes) : '-',
    lines: file.exists ? String(file.lineCount) : '-',
    tokens: file.exists ? formatTokens(file.estimatedTokens) : '-',
  };
}

interface ColWidths {
  file: number;
  exists: number;
  scope: number;
  size: number;
  lines: number;
  tokens: number;
}

function calcColWidths(rows: InventoryRow[]): ColWidths {
  const MIN_FILE = 4;   // "File"
  const MIN_EXISTS = 6;  // "Exists"
  const MIN_SCOPE = 5;   // "Scope"
  const MIN_SIZE = 4;    // "Size"
  const MIN_LINES = 5;   // "Lines"
  const MIN_TOKENS = 6;  // "Tokens"

  let file = MIN_FILE;
  let exists = MIN_EXISTS;
  let scope = MIN_SCOPE;
  let size = MIN_SIZE;
  let lines = MIN_LINES;
  let tokens = MIN_TOKENS;

  for (const r of rows) {
    file = Math.max(file, r.file.length);
    exists = Math.max(exists, r.exists.length);
    scope = Math.max(scope, r.scope.length);
    size = Math.max(size, r.size.length);
    lines = Math.max(lines, r.lines.length);
    tokens = Math.max(tokens, r.tokens.length);
  }

  return { file, exists, scope, size, lines, tokens };
}

function formatInventoryRow(row: InventoryRow, w: ColWidths): string {
  const icon = padEnd(row.icon, 1);
  const file = row.file.padEnd(w.file);
  const exists = row.exists === 'YES'
    ? padEnd(chalk.green(row.exists), w.exists)
    : padEnd(chalk.gray(row.exists), w.exists);
  const scope = padEnd(scopeColor(row.scope), w.scope);
  const size = row.size.padStart(w.size);
  const lines = row.lines.padStart(w.lines);
  const tokens = row.tokens.padStart(w.tokens);

  return `  ${icon}  ${file}  ${exists}  ${scope}  ${size}  ${lines}  ${tokens}`;
}

function formatInventoryHeader(w: ColWidths): string {
  const icon = ' ';
  const file = 'File'.padEnd(w.file);
  const exists = 'Exists'.padEnd(w.exists);
  const scope = 'Scope'.padEnd(w.scope);
  const size = 'Size'.padStart(w.size);
  const lines = 'Lines'.padStart(w.lines);
  const tokens = 'Tokens'.padStart(w.tokens);

  return `  ${icon}  ${file}  ${exists}  ${scope}  ${size}  ${lines}  ${tokens}`;
}

function totalTableWidth(w: ColWidths): number {
  // 2 (leading) + 1 (icon) + 2 (gap) + file + 2 + exists + 2 + scope + 2 + size + 2 + lines + 2 + tokens
  return 2 + 1 + 2 + w.file + 2 + w.exists + 2 + w.scope + 2 + w.size + 2 + w.lines + 2 + w.tokens;
}

export function printInventory(inventory: ConfigInventory): void {
  // 1. Collect all rows grouped by section
  interface Section { title: string; rows: InventoryRow[] }
  const sections: Section[] = [];

  function pushRow(label: string, file: FileInfo | null, sec: Section): void {
    const row = buildFileRow(label, file);
    if (row) sec.rows.push(row);
  }

  // Settings
  const settingsSection: Section = { title: 'Settings', rows: [] };
  pushRow('~/.claude/settings.json', inventory.userSettings, settingsSection);
  pushRow('.claude/settings.json', inventory.projectSettings, settingsSection);
  pushRow('.claude/settings.local.json', inventory.localSettings, settingsSection);
  pushRow('managed-settings.json', inventory.managedSettings, settingsSection);
  pushRow('~/.claude.json', inventory.preferences, settingsSection);
  if (settingsSection.rows.length > 0) sections.push(settingsSection);

  // Memory
  const memorySection: Section = { title: 'Memory (CLAUDE.md)', rows: [] };
  pushRow('~/.claude/CLAUDE.md', inventory.globalClaudeMd, memorySection);
  pushRow('CLAUDE.md', inventory.projectClaudeMd, memorySection);
  pushRow('CLAUDE.local.md', inventory.localClaudeMd, memorySection);
  for (const subdir of inventory.subdirClaudeMds) {
    pushRow(subdir.relativePath, subdir, memorySection);
  }
  pushRow('MEMORY.md (auto)', inventory.autoMemory, memorySection);
  for (const topic of inventory.autoMemoryTopics) {
    pushRow(`  ${topic.relativePath}`, topic, memorySection);
  }
  if (memorySection.rows.length > 0) sections.push(memorySection);

  // Rules
  if (inventory.rules.length > 0) {
    const rulesSection: Section = { title: 'Rules', rows: [] };
    for (const rule of inventory.rules) {
      pushRow(rule.relativePath, rule, rulesSection);
    }
    sections.push(rulesSection);
  }

  // Agents
  if (inventory.projectAgents.length > 0 || inventory.userAgents.length > 0) {
    const agentsSection: Section = { title: 'Agents', rows: [] };
    for (const agent of inventory.projectAgents) {
      pushRow(agent.relativePath, agent, agentsSection);
    }
    for (const agent of inventory.userAgents) {
      pushRow(agent.relativePath, agent, agentsSection);
    }
    sections.push(agentsSection);
  }

  // Commands
  if (inventory.projectCommands.length > 0 || inventory.userCommands.length > 0) {
    const commandsSection: Section = { title: 'Commands', rows: [] };
    for (const cmd of inventory.projectCommands) {
      pushRow(cmd.relativePath, cmd, commandsSection);
    }
    for (const cmd of inventory.userCommands) {
      pushRow(cmd.relativePath, cmd, commandsSection);
    }
    sections.push(commandsSection);
  }

  // Skills
  if (inventory.projectSkills.length > 0) {
    const skillsSection: Section = { title: 'Skills', rows: [] };
    for (const skill of inventory.projectSkills) {
      pushRow(skill.relativePath, skill, skillsSection);
    }
    sections.push(skillsSection);
  }

  // MCP
  const mcpSection: Section = { title: 'MCP', rows: [] };
  pushRow('.mcp.json', inventory.projectMcp, mcpSection);
  pushRow('managed-mcp.json', inventory.managedMcp, mcpSection);
  if (mcpSection.rows.length > 0) sections.push(mcpSection);

  // 2. Calculate widths from ALL rows
  const allRows = sections.flatMap((s) => s.rows);
  const w = calcColWidths(allRows);
  const tableWidth = totalTableWidth(w);

  // 3. Print
  console.log();
  console.log(chalk.bold('ccinspect scan'));
  console.log(chalk.gray(`Project: ${inventory.projectRoot}`));
  if (inventory.gitRoot) {
    console.log(chalk.gray(`Git root: ${inventory.gitRoot}`));
  }
  console.log();

  console.log(chalk.bold(formatInventoryHeader(w)));
  console.log(chalk.gray('-'.repeat(tableWidth)));

  for (const section of sections) {
    console.log(chalk.bold.underline(`\n${section.title}`));
    for (const row of section.rows) {
      console.log(formatInventoryRow(row, w));
    }
  }

  // Summary
  console.log();
  console.log(chalk.gray('-'.repeat(tableWidth)));
  console.log(
    chalk.bold(`Total: ${inventory.totalFiles} files found`),
  );
  console.log(
    `  Startup tokens: ${chalk.cyan(formatTokens(inventory.totalStartupTokens))} | On-demand tokens: ${chalk.cyan(formatTokens(inventory.totalOnDemandTokens))}`,
  );
  console.log();
  console.log(chalk.gray(`Legend: ${chalk.green('\u2713')} git-tracked  ${chalk.yellow('\u25cb')} untracked/gitignored  ${chalk.gray('-')} not found`));
  console.log();
}

// ---- Runtime Info ----

export function printRuntimeInfo(info: RuntimeInfo): void {
  console.log();
  console.log(chalk.bold('ccinspect info'));
  console.log();

  console.log(chalk.bold.underline('CLI'));
  console.log(`  Version:        ${info.cli.version}`);
  if (info.cli.latestVersion) {
    const updateStr = info.cli.updateAvailable
      ? chalk.yellow(` (update available: ${info.cli.latestVersion})`)
      : chalk.green(' (up to date)');
    console.log(`  Latest:         ${info.cli.latestVersion}${updateStr}`);
  }
  console.log(`  Install path:   ${info.cli.installPath}`);
  console.log(`  Node.js:        ${info.cli.nodeVersion}`);

  console.log(chalk.bold.underline('\nAuthentication'));
  console.log(`  Method:         ${info.auth.method}`);
  if (info.auth.org) {
    console.log(`  Organization:   ${info.auth.org}`);
  }

  console.log(chalk.bold.underline('\nModel'));
  console.log(`  Default:        ${info.model.default}`);
  if (info.model.sonnet) console.log(`  Sonnet:         ${info.model.sonnet}`);
  if (info.model.haiku) console.log(`  Haiku:          ${info.model.haiku}`);
  if (info.model.opus) console.log(`  Opus:           ${info.model.opus}`);
  if (info.model.subagent) console.log(`  Subagent:       ${info.model.subagent}`);
  if (Object.keys(info.model.sources).length > 0) {
    console.log(chalk.gray(`  Sources:`));
    for (const [key, source] of Object.entries(info.model.sources)) {
      console.log(chalk.gray(`    ${key}: ${source}`));
    }
  }

  console.log(chalk.bold.underline('\nSystem'));
  console.log(`  OS:             ${info.system.os}`);
  console.log(
    `  Managed policy: ${info.system.managedPolicyExists ? chalk.green('found') : chalk.gray('not found')} (${info.system.managedPolicyPath})`,
  );
  console.log(
    `  Managed MCP:    ${info.system.managedMcpExists ? chalk.green('found') : chalk.gray('not found')} (${info.system.managedMcpPath})`,
  );
  console.log();
}

// ---- Lint Output ----

export function printLintResult(result: LintResult): void {
  console.log();
  console.log(chalk.bold('ccinspect lint'));
  console.log();

  if (result.issues.length === 0) {
    console.log(chalk.green('\u2713 No issues found. Configuration looks good!'));
  } else {
    // Collect raw data for alignment
    const issueRows = result.issues.map((issue) => {
      const lineRef = issue.line ? `:${issue.line}` : '';
      const fileRef = issue.file ? `(${issue.file}${lineRef})` : '';
      const ruleId = `[${issue.ruleId}]`;
      return { issue, fileRef, ruleId };
    });

    // Calculate max widths
    const maxMsg = Math.max(...issueRows.map((r) => r.issue.message.length));
    const maxFile = Math.max(...issueRows.map((r) => r.fileRef.length));

    for (const { issue, fileRef, ruleId } of issueRows) {
      const icon = severityIcon(issue.severity);
      const msg = issue.message.padEnd(maxMsg);
      const file = fileRef ? chalk.gray(fileRef.padEnd(maxFile)) : ''.padEnd(maxFile);
      console.log(`${icon} ${msg}  ${file}  ${chalk.gray(ruleId)}`);
      console.log(chalk.gray(`  \u2192 ${issue.suggestion}`));
      console.log();
    }
  }

  // Summary
  console.log(chalk.gray('-'.repeat(60)));
  const parts: string[] = [];
  if (result.stats.errors > 0) parts.push(chalk.red(`${result.stats.errors} error(s)`));
  if (result.stats.warnings > 0) parts.push(chalk.yellow(`${result.stats.warnings} warning(s)`));
  if (result.stats.infos > 0) parts.push(chalk.blue(`${result.stats.infos} info(s)`));
  if (parts.length === 0) parts.push(chalk.green('0 issues'));

  console.log(
    `${parts.join(', ')} | ${result.stats.rulesRun} rules checked | ${result.stats.filesChecked} files scanned | ${result.stats.duration}ms`,
  );
  console.log();
}

// ------- Resolve Output -------

interface ResolveSections {
  permissions: boolean;
  env: boolean;
  mcp: boolean;
  model: boolean;
  sandbox: boolean;
}

export function printResolvedConfig(resolved: ResolvedConfig, sections: ResolveSections): void {
  console.log();
  console.log(chalk.bold('ccinspect resolve'));
  console.log();

  if (sections.permissions) {
    console.log(chalk.bold.underline('Permissions'));

    // Collect all permission rows for alignment
    interface PermRow { icon: string; pattern: string; origin: string }
    const allowRows: PermRow[] = resolved.permissions.effectiveAllow.map((r) => ({
      icon: chalk.green('+'), pattern: r.pattern, origin: r.origin,
    }));
    const denyRows: PermRow[] = resolved.permissions.effectiveDeny.map((r) => ({
      icon: chalk.red('-'), pattern: r.pattern, origin: r.origin,
    }));
    const allPermRows = [...allowRows, ...denyRows];

    if (allPermRows.length > 0) {
      const maxPattern = Math.max(...allPermRows.map((r) => r.pattern.length));

      if (allowRows.length > 0) {
        console.log(chalk.green('  Allow:'));
        for (const row of allowRows) {
          const originTag = chalk.gray(`\u2190 ${row.origin}`);
          console.log(`    ${row.icon} ${row.pattern.padEnd(maxPattern)}  ${originTag}`);
        }
      }

      if (denyRows.length > 0) {
        console.log(chalk.red('  Deny:'));
        for (const row of denyRows) {
          const originTag = chalk.gray(`\u2190 ${row.origin}`);
          console.log(`    ${row.icon} ${row.pattern.padEnd(maxPattern)}  ${originTag}`);
        }
      }
    }

    if (resolved.permissions.conflicts.length > 0) {
      console.log(chalk.red('  Conflicts:'));
      const maxConflictPattern = Math.max(...resolved.permissions.conflicts.map((c) => c.pattern.length));
      for (const conflict of resolved.permissions.conflicts) {
        console.log(`    ${chalk.red('!')} ${conflict.pattern.padEnd(maxConflictPattern)}  ${conflict.explanation}`);
      }
    }

    if (resolved.permissions.redundancies.length > 0) {
      console.log(chalk.yellow('  Redundancies:'));
      for (const r of resolved.permissions.redundancies) {
        console.log(`    ${chalk.yellow('~')} ${r.explanation}`);
      }
    }

    if (resolved.permissions.effectiveAllow.length === 0 && resolved.permissions.effectiveDeny.length === 0) {
      console.log(chalk.gray('  No permission rules configured'));
    }
    console.log();
  }

  if (sections.env) {
    console.log(chalk.bold.underline('Environment Variables'));
    if (resolved.environment.effective.size > 0) {
      // Calculate max key=value width for alignment
      const envEntries = [...resolved.environment.effective.entries()];
      const maxKV = Math.max(...envEntries.map(([name, envVar]) => `${name}=${envVar.value}`.length));

      for (const [name, envVar] of envEntries) {
        const kv = `${name}=${envVar.value}`;
        const shadowTag = envVar.shadowedValues ? chalk.yellow(' (shadowed)') : '';
        const originTag = chalk.gray(`\u2190 ${envVar.origin}`);
        console.log(`  ${kv.padEnd(maxKV)}  ${originTag}${shadowTag}`);
        if (envVar.shadowedValues) {
          for (const sv of envVar.shadowedValues) {
            console.log(chalk.gray(`    overrides: ${sv.value} from ${sv.origin}`));
          }
        }
      }
    } else {
      console.log(chalk.gray('  No environment variables configured'));
    }
    console.log();
  }

  if (sections.mcp) {
    console.log(chalk.bold.underline('MCP Servers'));
    if (resolved.mcpServers.effective.length > 0) {
      const maxName = Math.max(...resolved.mcpServers.effective.map((s) => s.name.length));
      const maxStatus = 8; // "disabled" is longest

      for (const server of resolved.mcpServers.effective) {
        const status = server.enabled ? chalk.green('enabled') : chalk.red('disabled');
        const originTag = chalk.gray(`\u2190 ${server.origin}`);
        console.log(`  ${server.name.padEnd(maxName)}  ${padEnd(status, maxStatus)}  ${originTag}`);
        if (server.conflicts && server.conflicts.length > 0) {
          for (const c of server.conflicts) {
            const cStatus = c.enabled ? 'enabled' : 'disabled';
            console.log(chalk.yellow(`${''.padEnd(maxName + 4)}conflict: ${cStatus} at ${c.origin}`));
          }
        }
      }
    } else {
      console.log(chalk.gray('  No MCP servers configured'));
    }
    console.log();
  }

  if (sections.model) {
    console.log(chalk.bold.underline('Model'));
    const modelRows: Array<{ label: string; value: string; origin: string }> = [];
    modelRows.push({ label: 'Default', value: resolved.model.effectiveModel.value, origin: resolved.model.effectiveModel.origin });
    if (resolved.model.subagentModel) {
      modelRows.push({ label: 'Subagent', value: resolved.model.subagentModel.value, origin: resolved.model.subagentModel.origin });
    }
    if (resolved.model.haikuModel) {
      modelRows.push({ label: 'Haiku', value: resolved.model.haikuModel.value, origin: resolved.model.haikuModel.origin });
    }
    if (resolved.model.opusModel) {
      modelRows.push({ label: 'Opus', value: resolved.model.opusModel.value, origin: resolved.model.opusModel.origin });
    }

    const maxLabel = Math.max(...modelRows.map((r) => r.label.length));
    const maxValue = Math.max(...modelRows.map((r) => r.value.length));

    for (const row of modelRows) {
      const originTag = chalk.gray(`\u2190 ${row.origin}`);
      console.log(`  ${row.label.padEnd(maxLabel)}  ${row.value.padEnd(maxValue)}  ${originTag}`);
    }
    console.log();
  }

  if (sections.sandbox) {
    console.log(chalk.bold.underline('Sandbox'));
    const sandboxStatus = resolved.sandbox.enabled.value ? chalk.green('enabled') : chalk.yellow('disabled');
    const sandboxOriginTag = chalk.gray(`\u2190 ${resolved.sandbox.enabled.origin}`);
    console.log(`  Sandbox: ${sandboxStatus}  ${sandboxOriginTag}`);
    if (resolved.sandbox.autoAllowBashIfSandboxed) {
      const bashOriginTag = chalk.gray(`\u2190 ${resolved.sandbox.autoAllowBashIfSandboxed.origin}`);
      console.log(`  Auto-allow Bash: ${resolved.sandbox.autoAllowBashIfSandboxed.value}  ${bashOriginTag}`);
    }
    if (resolved.sandbox.excludedCommands) {
      const cmdsOriginTag = chalk.gray(`\u2190 ${resolved.sandbox.excludedCommands.origin}`);
      console.log(`  Excluded commands: ${resolved.sandbox.excludedCommands.value.join(', ')}  ${cmdsOriginTag}`);
    }
    if (Object.keys(resolved.sandbox.networkConfig).length > 0) {
      console.log(`  Network config: ${JSON.stringify(resolved.sandbox.networkConfig)}`);
    }
    console.log();
  }
}

// ------- Resolve JSON Output -------

function resolvedConfigToJson(resolved: ResolvedConfig, sections: ResolveSections): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  if (sections.permissions) {
    output.permissions = {
      allow: resolved.permissions.effectiveAllow,
      deny: resolved.permissions.effectiveDeny,
      ask: resolved.permissions.effectiveAsk,
      conflicts: resolved.permissions.conflicts,
      redundancies: resolved.permissions.redundancies,
    };
  }

  if (sections.env) {
    const envObj: Record<string, unknown> = {};
    for (const [name, envVar] of resolved.environment.effective) {
      envObj[name] = envVar;
    }
    output.environment = {
      effective: envObj,
      shadows: resolved.environment.shadows,
    };
  }

  if (sections.mcp) {
    output.mcpServers = resolved.mcpServers;
  }

  if (sections.model) {
    output.model = resolved.model;
  }

  if (sections.sandbox) {
    output.sandbox = resolved.sandbox;
  }

  return output;
}

export function printResolvedConfigJson(resolved: ResolvedConfig, sections: ResolveSections): void {
  console.log(JSON.stringify(resolvedConfigToJson(resolved, sections), null, 2));
}

// ------- Compare Output -------

export function printComparison(results: ProjectComparison[]): void {
  console.log();
  console.log(chalk.bold('ccinspect compare'));
  console.log();

  // Build metric rows as raw strings first
  const metrics: Array<{ label: string; values: string[] }> = [
    { label: 'Total files', values: results.map((r) => String(r.totalFiles)) },
    { label: 'Startup tokens', values: results.map((r) => formatTokens(r.totalStartupTokens)) },
    { label: 'Allow rules', values: results.map((r) => String(r.resolved.permissions.effectiveAllow.length)) },
    { label: 'Deny rules', values: results.map((r) => String(r.resolved.permissions.effectiveDeny.length)) },
    { label: 'MCP servers', values: results.map((r) => String(r.resolved.mcpServers.effective.length)) },
    { label: 'Env variables', values: results.map((r) => String(r.resolved.environment.effective.size)) },
    { label: 'Model', values: results.map((r) => r.resolved.model.effectiveModel.value) },
    { label: 'Sandbox', values: results.map((r) => (r.resolved.sandbox.enabled.value ? 'enabled' : 'disabled')) },
  ];

  // Conflicts row (needs coloring, handled separately)
  const conflictCounts = results.map(
    (r) => r.resolved.permissions.conflicts.length + r.resolved.mcpServers.conflicts.length,
  );

  // Calculate column widths dynamically
  const metricWidth = Math.max(
    'Metric'.length,
    ...metrics.map((m) => m.label.length),
    'Conflicts'.length,
  );

  const projectWidths = results.map((r, i) => {
    let maxW = r.dir.length;
    for (const m of metrics) {
      maxW = Math.max(maxW, m.values[i].length);
    }
    maxW = Math.max(maxW, String(conflictCounts[i]).length);
    return maxW;
  });

  const GAP = 2;

  // Print header
  let header = '  ' + 'Metric'.padEnd(metricWidth + GAP);
  for (let i = 0; i < results.length; i++) {
    header += results[i].dir.padEnd(projectWidths[i] + GAP);
  }
  console.log(chalk.bold(header));

  const totalWidth = metricWidth + GAP + projectWidths.reduce((sum, w) => sum + w + GAP, 0);
  console.log(chalk.gray('  ' + '-'.repeat(totalWidth)));

  // Print metric rows
  for (const metric of metrics) {
    let line = '  ' + metric.label.padEnd(metricWidth + GAP);
    for (let i = 0; i < results.length; i++) {
      line += metric.values[i].padEnd(projectWidths[i] + GAP);
    }
    console.log(line);
  }

  // Conflicts row with coloring
  let conflictLine = '  ' + 'Conflicts'.padEnd(metricWidth + GAP);
  for (let i = 0; i < results.length; i++) {
    const raw = String(conflictCounts[i]);
    const colored = conflictCounts[i] > 0 ? chalk.red(raw) : chalk.green(raw);
    conflictLine += padEnd(colored, projectWidths[i] + GAP);
  }
  console.log(conflictLine);

  console.log();
}

export function printComparisonJson(results: ProjectComparison[]): void {
  const output = results.map((r) => ({
    dir: r.dir,
    totalFiles: r.totalFiles,
    totalStartupTokens: r.totalStartupTokens,
    resolved: resolvedConfigToJson(r.resolved, {
      permissions: true,
      env: true,
      mcp: true,
      model: true,
      sandbox: true,
    }),
  }));
  console.log(JSON.stringify(output, null, 2));
}
