import { basename, dirname, resolve } from 'path';
import chalk from 'chalk';
import type { FileInfo, FileScope, ConfigInventory, LintResult, ResolvedConfig } from '../../types/index.js';
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

/** Pad a string that may contain ANSI codes to a visible width (right-align). */
function padStartAnsi(str: string, width: number): string {
  const visible = stripAnsi(str);
  return visible >= width ? str : ' '.repeat(width - visible) + str;
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

function scopeDisplayName(scope: string): string {
  return scope === 'user' ? 'global' : scope;
}

function scopeColor(scope: string): string {
  const display = scopeDisplayName(scope);
  switch (scope) {
    case 'enterprise':
      return chalk.red(display);
    case 'user':
      return chalk.blue(display);
    case 'project-shared':
      return chalk.green(display);
    case 'project-local':
      return chalk.yellow(display);
    default:
      return display;
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

// ---- Path shortening ----

/**
 * Shorten a file path string for display.
 * Project-relative files → strip project root (e.g., "CLAUDE.md", ".claude/settings.json")
 * Home-dir files → ~/... prefix (e.g., "~/.claude/agents/smith.md")
 * Relative paths with ../ → resolve first, then shorten
 * Everything else → unchanged
 */
function shortenPath(filePath: string, projectRoot: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';

  // Resolve relative paths (handles ../../../../../.claude/agents/smith.md)
  const abs = filePath.startsWith('/') ? filePath : resolve(projectRoot, filePath);

  // Project-relative takes priority
  if (abs.startsWith(projectRoot + '/')) {
    return abs.slice(projectRoot.length + 1);
  }

  // Home-dir files
  if (home && abs.startsWith(home + '/')) {
    return '~/' + abs.slice(home.length + 1);
  }

  // Fallback — keep original
  return filePath;
}

// ---- Inventory table (scan) ----

const WARN_LINES = 500;
const WARN_TOKENS = 1000;

/**
 * Returns a display label for a file path.
 * Project-relative paths take priority (most files live under ~/, so checking
 * home first would incorrectly prefix everything with ~/).
 * Files outside the project but under home get ~/... prefix.
 * Everything else falls back to the absolute path.
 */
function fileDisplayLabel(file: FileInfo, projectRoot: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  // Project-relative takes priority — covers all files inside the project tree
  if (file.path.startsWith(projectRoot + '/') || file.path === projectRoot) {
    return file.relativePath;
  }
  // Outside project root — use ~/... for home-dir files
  if (home && file.path.startsWith(home + '/')) {
    return '~/' + file.path.slice(home.length + 1);
  }
  // Fallback — absolute path for anything else (e.g. enterprise paths)
  return file.path;
}

interface InventoryRow {
  icon: string;
  file: string;
  scope: string;
  size: string;
  lines: string;
  tokens: string;
  rawLines?: number;
  rawTokens?: number;
  section?: string; // section header to print before this row group
  dimmed?: boolean;
}

function buildFileRow(label: string, file: FileInfo | null): InventoryRow | null {
  if (!file) return null;

  return {
    icon: fileStatusIcon(file),
    file: label,
    scope: file.scope,
    size: file.exists ? formatSize(file.sizeBytes) : '-',
    lines: file.exists ? String(file.lineCount) : '-',
    tokens: file.exists ? formatTokens(file.estimatedTokens) : '-',
    rawLines: file.exists ? file.lineCount : undefined,
    rawTokens: file.exists ? file.estimatedTokens : undefined,
  };
}

interface ColWidths {
  file: number;
  scope: number;
  size: number;
  lines: number;
  tokens: number;
}

function calcColWidths(rows: InventoryRow[]): ColWidths {
  const MIN_FILE = 4;   // "File"
  const MIN_SCOPE = 5;   // "Scope"
  const MIN_SIZE = 4;    // "Size"
  const MIN_LINES = 5;   // "Lines"
  const MIN_TOKENS = 6;  // "Tokens"

  let file = MIN_FILE;
  let scope = MIN_SCOPE;
  let size = MIN_SIZE;
  let lines = MIN_LINES;
  let tokens = MIN_TOKENS;

  for (const r of rows) {
    file = Math.max(file, r.file.length);
    scope = Math.max(scope, scopeDisplayName(r.scope).length);
    size = Math.max(size, r.size.length);
    lines = Math.max(lines, r.lines.length);
    tokens = Math.max(tokens, r.tokens.length);
  }

  return { file, scope, size, lines, tokens };
}

function formatInventoryRow(row: InventoryRow, w: ColWidths): string {
  const icon = padEnd(row.icon, 1);
  const file = row.file.padEnd(w.file);
  const scope = padEnd(scopeColor(row.scope), w.scope);
  const size = row.size.padStart(w.size);

  const linesStr = row.rawLines !== undefined && row.rawLines > WARN_LINES
    ? padStartAnsi(chalk.yellow(row.lines), w.lines)
    : row.lines.padStart(w.lines);

  const tokensStr = row.rawTokens !== undefined && row.rawTokens > WARN_TOKENS
    ? padStartAnsi(chalk.yellow(row.tokens), w.tokens)
    : row.tokens.padStart(w.tokens);

  const result = `  ${icon}  ${file}  ${scope}  ${size}  ${linesStr}  ${tokensStr}`;
  return row.dimmed ? chalk.gray(result) : result;
}

function formatInventoryHeader(w: ColWidths): string {
  const icon = ' ';
  const file = 'File'.padEnd(w.file);
  const scope = 'Scope'.padEnd(w.scope);
  const size = 'Size'.padStart(w.size);
  const lines = 'Lines'.padStart(w.lines);
  const tokens = 'Tokens'.padStart(w.tokens);

  return `  ${icon}  ${file}  ${scope}  ${size}  ${lines}  ${tokens}`;
}

function totalTableWidth(w: ColWidths): number {
  // 2 (leading) + 1 (icon) + 2 (gap) + file + 2 + scope + 2 + size + 2 + lines + 2 + tokens
  return 2 + 1 + 2 + w.file + 2 + w.scope + 2 + w.size + 2 + w.lines + 2 + w.tokens;
}

export function printInventory(inventory: ConfigInventory): void {
  // 1. Collect all rows grouped by section
  interface Section { title: string; rows: InventoryRow[] }
  const sections: Section[] = [];

  function pushRow(label: string, file: FileInfo | null, sec: Section): void {
    const row = buildFileRow(label, file);
    if (row) sec.rows.push(row);
  }

  function buildMissingRow(label: string, scope: FileScope): InventoryRow {
    return {
      icon: chalk.gray('-'),
      file: label,
      scope,
      size: '-',
      lines: '-',
      tokens: '-',
    };
  }

  function pushSettingsRow(label: string, file: FileInfo | null, scope: FileScope, sec: Section): void {
    const row = file ? buildFileRow(label, file) : buildMissingRow(label, scope);
    if (row) sec.rows.push(row);
  }

  // Returns the set of basenames (lowercase, no extension) from `lower` that also exist in `higher`
  function shadowedNames(higher: FileInfo[], lower: FileInfo[]): Set<string> {
    const higherNames = new Set(higher.map(f => basename(f.path, '.md').toLowerCase()));
    return new Set(lower.map(f => basename(f.path, '.md').toLowerCase()).filter(n => higherNames.has(n)));
  }

  // For skills: name comes from parent directory, not filename (all are SKILL.md)
  function shadowedSkillNames(higher: FileInfo[], lower: FileInfo[]): Set<string> {
    const higherNames = new Set(higher.map(f => basename(dirname(f.path)).toLowerCase()));
    return new Set(lower.map(f => basename(dirname(f.path)).toLowerCase()).filter(n => higherNames.has(n)));
  }

  // Settings
  const settingsSection: Section = {
    title: 'Settings',
    rows: [],
  };
  pushSettingsRow('managed-settings.json', inventory.managedSettings, 'enterprise', settingsSection);
  pushSettingsRow('.claude/settings.local.json', inventory.localSettings, 'project-local', settingsSection);
  pushSettingsRow('.claude/settings.json', inventory.projectSettings, 'project-shared', settingsSection);
  pushSettingsRow('~/.claude/settings.json', inventory.userSettings, 'user', settingsSection);
  pushSettingsRow('~/.claude.json', inventory.preferences, 'user', settingsSection);
  if (settingsSection.rows.length > 0) sections.push(settingsSection);

  // Memory
  const memorySection: Section = { title: 'Memory (CLAUDE.md)', rows: [] };
  pushRow('Enterprise CLAUDE.md', inventory.enterpriseClaudeMd, memorySection);
  pushRow('~/.claude/CLAUDE.md', inventory.globalClaudeMd, memorySection);
  pushRow('CLAUDE.md', inventory.projectClaudeMd, memorySection);
  pushRow('CLAUDE.local.md', inventory.localClaudeMd, memorySection);
  for (const subdir of inventory.subdirClaudeMds) {
    pushRow(fileDisplayLabel(subdir, inventory.projectRoot), subdir, memorySection);
  }
  pushRow('MEMORY.md (auto)', inventory.autoMemory, memorySection);
  for (const topic of inventory.autoMemoryTopics) {
    pushRow(`  ${fileDisplayLabel(topic, inventory.projectRoot)}`, topic, memorySection);
  }
  if (memorySection.rows.length > 0) sections.push(memorySection);

  // Rules
  if (inventory.rules.length > 0 || inventory.userRules.length > 0) {
    const rulesSection: Section = { title: 'Rules', rows: [] };
    for (const rule of inventory.rules) {
      pushRow(fileDisplayLabel(rule, inventory.projectRoot), rule, rulesSection);
    }
    for (const rule of inventory.userRules) {
      pushRow(fileDisplayLabel(rule, inventory.projectRoot), rule, rulesSection);
    }
    sections.push(rulesSection);
  }

  // Agents — project wins over user
  if (inventory.projectAgents.length > 0 || inventory.userAgents.length > 0) {
    const shadowedAgents = shadowedNames(inventory.projectAgents, inventory.userAgents);
    const agentsSection: Section = {
      title: 'Agents',
      rows: [],
    };
    for (const agent of inventory.projectAgents) {
      pushRow(fileDisplayLabel(agent, inventory.projectRoot), agent, agentsSection);
    }
    for (const agent of inventory.userAgents) {
      const label = fileDisplayLabel(agent, inventory.projectRoot);
      const name = basename(agent.path, '.md').toLowerCase();
      const isDimmed = shadowedAgents.has(name);
      const row = buildFileRow(isDimmed ? `${label}  (inactive)` : label, agent);
      if (row) {
        if (isDimmed) row.dimmed = true;
        agentsSection.rows.push(row);
      }
    }
    sections.push(agentsSection);
  }

  // Commands — project wins over user
  if (inventory.projectCommands.length > 0 || inventory.userCommands.length > 0) {
    const shadowedCmds = shadowedNames(inventory.projectCommands, inventory.userCommands);
    const commandsSection: Section = {
      title: 'Commands',
      rows: [],
    };
    for (const cmd of inventory.projectCommands) {
      pushRow(fileDisplayLabel(cmd, inventory.projectRoot), cmd, commandsSection);
    }
    for (const cmd of inventory.userCommands) {
      const label = fileDisplayLabel(cmd, inventory.projectRoot);
      const name = basename(cmd.path, '.md').toLowerCase();
      const isDimmed = shadowedCmds.has(name);
      const row = buildFileRow(isDimmed ? `${label}  (inactive)` : label, cmd);
      if (row) {
        if (isDimmed) row.dimmed = true;
        commandsSection.rows.push(row);
      }
    }
    sections.push(commandsSection);
  }

  // Skills — user wins over project
  if (inventory.projectSkills.length > 0 || inventory.userSkills.length > 0) {
    const shadowedSkills = shadowedSkillNames(inventory.userSkills, inventory.projectSkills);
    const skillsSection: Section = {
      title: 'Skills',
      rows: [],
    };
    for (const skill of inventory.userSkills) {
      pushRow(fileDisplayLabel(skill, inventory.projectRoot), skill, skillsSection);
    }
    for (const skill of inventory.projectSkills) {
      const label = fileDisplayLabel(skill, inventory.projectRoot);
      const name = basename(dirname(skill.path)).toLowerCase();
      const isDimmed = shadowedSkills.has(name);
      const row = buildFileRow(isDimmed ? `${label}  (inactive)` : label, skill);
      if (row) {
        if (isDimmed) row.dimmed = true;
        skillsSection.rows.push(row);
      }
    }
    sections.push(skillsSection);
  }

  // MCP
  const mcpSection: Section = {
    title: 'MCP',
    rows: [],
  };
  pushRow('managed-mcp.json', inventory.managedMcp, mcpSection);
  pushRow('.mcp.json', inventory.projectMcp, mcpSection);
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

  // Precedence block
  console.log();
  console.log(chalk.bold('Precedence & merge behavior:'));
  const precedenceRows: Array<[string, string, string]> = [
    ['Settings',  'enterprise \u2192 project-local \u2192 project-shared \u2192 global', '\u00b7 arrays merge, scalars override'],
    ['Memory',    'enterprise \u2192 global \u2192 project-shared \u2192 project-local', '\u00b7 additive, specific wins on conflict'],
    ['Rules',     'global + project-shared',                              '\u00b7 additive'],
    ['Agents',    'enterprise \u2192 project-shared \u2192 global',                 '\u00b7 override by name'],
    ['Skills',    'enterprise \u2192 global \u2192 project-shared',                 '\u00b7 override by name'],
    ['Commands',  'project-shared \u2192 global',                              '\u00b7 override by name'],
    ['MCP',       'managed \u2192 project-shared \u2192 global',                    '\u00b7 override by name'],
  ];
  const labelW = Math.max(...precedenceRows.map(([l]) => l.length));
  const orderW = Math.max(...precedenceRows.map(([, o]) => o.length));
  for (const [label, order, behavior] of precedenceRows) {
    console.log(
      `  ${chalk.bold(label.padEnd(labelW))}  ${chalk.gray(order.padEnd(orderW))}  ${chalk.gray(behavior)}`,
    );
  }

  console.log();
  console.log(chalk.gray(`Legend: ${chalk.green('\u2713')} git-tracked  ${chalk.yellow('\u25cb')} untracked/gitignored  ${chalk.gray('-')} not found  |  global = ~/.claude/  |  (inactive) = shadowed by higher-priority file`));
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

/** Display order and human-readable names for lint issue categories. */
const CATEGORY_ORDER: Array<{ key: string; label: string }> = [
  { key: 'memory', label: 'Memory' },
  { key: 'settings', label: 'Settings' },
  { key: 'cross-level', label: 'Cross-Level' },
  { key: 'rules', label: 'Rules' },
  { key: 'agents', label: 'Agents' },
  { key: 'skills', label: 'Skills' },
  { key: 'commands', label: 'Commands' },
  { key: 'budget', label: 'Budget' },
  { key: 'mcp', label: 'MCP' },
  { key: 'git', label: 'Git' },
  { key: 'plugins', label: 'Plugins' },
  { key: 'naming', label: 'Naming' },
  { key: 'hooks', label: 'Hooks' },
];

const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 };

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

type LintIssueItem = LintResult['issues'][number];

/** Format section header count: split issues (errors+warnings) from notes (info). */
function formatSectionCount(issues: LintIssueItem[]): string {
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'info').length;

  const parts: string[] = [];
  if (errorCount > 0) parts.push(plural(errorCount, 'error', 'errors'));
  if (warnCount > 0) parts.push(plural(warnCount, 'warning', 'warnings'));
  if (infoCount > 0) parts.push(plural(infoCount, 'note', 'notes'));
  if (parts.length === 0) return '0 issues';
  return parts.join(', ');
}

/**
 * Rules that should be collapsed when 2+ issues share the same ruleId.
 * Each entry defines how to render the collapsed group.
 */
const COLLAPSIBLE_RULES = new Set([
  'settings/deny-sensitive-paths',
  'memory/todo-fixme',
  'memory/generic-instructions',
  'rules-dir/dead-globs',
  'rules-dir/overlapping-rules',
  'rules-dir/large-rule-file',
  'settings/dangerous-allow',
  'agents/orphan-agent',
  'agents/frontmatter-present',
  'skills/frontmatter-present',
]);

/**
 * Group same-ruleId issues for collapsed rendering.
 * Returns individual issues or arrays of issues (collapsed groups).
 */
function groupIssuesForRendering(issues: LintIssueItem[]): Array<LintIssueItem | LintIssueItem[]> {
  const seen = new Set<string>();
  const result: Array<LintIssueItem | LintIssueItem[]> = [];

  for (const issue of issues) {
    if (seen.has(issue.ruleId)) continue;
    seen.add(issue.ruleId);

    const sameRule = issues.filter(i => i.ruleId === issue.ruleId);
    if (sameRule.length >= 2 && COLLAPSIBLE_RULES.has(issue.ruleId)) {
      result.push(sameRule);
    } else {
      for (const iss of sameRule) result.push(iss);
    }
  }
  return result;
}

/** Check if a suggestion is redundant with the message (substring or >70% word overlap). */
function isSuggestionRedundant(message: string, suggestion: string): boolean {
  const msgLower = message.toLowerCase();
  const sugLower = suggestion.toLowerCase();

  // Suggestion is a substring of message
  if (msgLower.includes(sugLower)) return true;

  // Message is a substring of suggestion (restatement + minor addition)
  if (sugLower.includes(msgLower)) return true;

  // Significant word overlap (>70%)
  const msgWords = new Set(msgLower.split(/\s+/).filter(w => w.length > 3));
  const sugWords = sugLower.split(/\s+/).filter(w => w.length > 3);
  if (msgWords.size === 0 || sugWords.length === 0) return false;

  const overlap = sugWords.filter(w => msgWords.has(w)).length;
  return overlap / sugWords.length > 0.6;
}

function renderSingleIssue(issue: LintIssueItem, projectRoot: string, verbose = false): void {
  const icon = severityIcon(issue.severity);
  const shortFile = issue.file ? shortenPath(issue.file, projectRoot) : '';
  const lineRef = issue.line ? `:${issue.line}` : '';
  const fileLabel = shortFile ? `${shortFile}${lineRef}` : '';
  const ruleId = chalk.gray(`[${issue.ruleId}]`);

  // Line 1: header — icon + file + ruleId
  if (fileLabel) {
    console.log(`  ${icon} ${chalk.bold(fileLabel)}  ${ruleId}`);
  } else {
    console.log(`  ${icon} ${ruleId}`);
  }

  // Line 2: message
  console.log(`    ${issue.message}`);

  // Evidence lines with │ pipe
  if (issue.evidence && issue.evidence.length > 0) {
    for (const ev of issue.evidence) {
      const shortEvFile = shortenPath(ev.file, projectRoot);
      const loc = ev.line ? `${shortEvFile}:${ev.line}` : shortEvFile;
      let content = ev.content;
      if (!verbose && content.length > 120) {
        content = content.slice(0, 120) + '\u2026';
      }
      console.log(chalk.dim(`    \u2502 ${loc}  "${content}"`));
    }
  }

  // Action line — suppress if redundant (unless verbose)
  if (verbose || !isSuggestionRedundant(issue.message, issue.suggestion)) {
    console.log(chalk.cyan(`    \u21b3 ${issue.suggestion}`));
  }

  // Blank line between issues
  console.log();
}

// ---- Collapsed group renderers ----

function highestSeverityIcon(issues: LintIssueItem[]): string {
  const best = issues.reduce((a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 3) < (SEVERITY_ORDER[b.severity] ?? 3) ? a : b,
  );
  return severityIcon(best.severity);
}

function sharedFile(issues: LintIssueItem[], projectRoot: string): string {
  const files = new Set(issues.map(i => i.file).filter(Boolean));
  return files.size === 1 ? shortenPath([...files][0]!, projectRoot) : '';
}

function renderCollapsedHeader(issues: LintIssueItem[], projectRoot: string): void {
  const icon = highestSeverityIcon(issues);
  const file = sharedFile(issues, projectRoot);
  const ruleId = chalk.gray(`[${issues[0].ruleId}]`);
  if (file) {
    console.log(`  ${icon} ${chalk.bold(file)}  ${ruleId}`);
  } else {
    console.log(`  ${icon} ${ruleId}`);
  }
}

function renderCollapsedDenySensitivePaths(issues: LintIssueItem[], projectRoot: string): void {
  renderCollapsedHeader(issues, projectRoot);
  // Extract group name from "No deny rule protects {group.name}. Consider adding: ..."
  const names = issues.map(iss => {
    const m = iss.message.match(/protects\s+(.+?)\.\s*Consider/i);
    return m ? m[1] : iss.message.slice(0, 40);
  });
  console.log(`    ${issues.length} sensitive paths unprotected: ${names.join(', ')}`);
  console.log(chalk.cyan(`    \u21b3 Add Read/Write deny patterns to settings.json for each`));
  console.log();
}

function renderCollapsedTodoFixme(issues: LintIssueItem[], projectRoot: string): void {
  renderCollapsedHeader(issues, projectRoot);
  const lines = issues.map(iss => iss.line).filter((l): l is number => l !== undefined);
  const lineStr = lines.length > 0 ? ` at lines ${lines.join(', ')}` : '';
  console.log(`    ${issues.length} stale TODO/FIXME markers${lineStr}`);
  console.log(chalk.cyan(`    \u21b3 Resolve or remove \u2014 stale markers may confuse Claude`));
  console.log();
}

function renderCollapsedGenericInstructions(issues: LintIssueItem[], projectRoot: string): void {
  renderCollapsedHeader(issues, projectRoot);
  console.log(`    ${issues.length} generic instructions found`);
  // Extract quoted instruction text from each message
  for (const iss of issues) {
    const m = iss.message.match(/"([^"]+)"$/);
    const text = m ? m[1] : iss.message;
    const lineRef = iss.line ? `line ${iss.line}: ` : '';
    const truncated = text.length > 100 ? text.slice(0, 100) + '\u2026' : text;
    console.log(chalk.dim(`    \u2502 ${lineRef}"${truncated}"`));
  }
  console.log(chalk.cyan(`    \u21b3 Replace with specific, actionable guidance`));
  console.log();
}

function renderCollapsedDeadGlobs(issues: LintIssueItem[], projectRoot: string): void {
  const icon = highestSeverityIcon(issues);
  const ruleId = chalk.gray(`[${issues[0].ruleId}]`);
  console.log(`  ${icon} ${ruleId}`);
  console.log(`    ${issues.length} rule files have dead globs (no matching files)`);
  for (const iss of issues) {
    const fileName = iss.file ? basename(shortenPath(iss.file, projectRoot)) : 'unknown';
    // Extract glob patterns from evidence content like 'glob "lib/**" matched 0 files'
    const globs: string[] = [];
    if (iss.evidence) {
      for (const ev of iss.evidence) {
        const m = ev.content.match(/glob "([^"]+)"/);
        if (m) globs.push(m[1]);
      }
    }
    const globStr = globs.length > 0 ? globs.join(', ') : '(unknown pattern)';
    console.log(chalk.dim(`    \u2502 ${fileName} \u2192 ${globStr}`));
  }
  console.log(chalk.cyan(`    \u21b3 Remove the rules or update the glob patterns`));
  console.log();
}

function renderCollapsedOverlappingRules(issues: LintIssueItem[], _projectRoot: string): void {
  const icon = highestSeverityIcon(issues);
  const ruleId = chalk.gray(`[${issues[0].ruleId}]`);
  console.log(`  ${icon} ${ruleId}`);
  console.log(`    ${issues.length} rule scope overlaps detected`);
  for (const iss of issues) {
    // Parse two quoted rule paths from message like: Rules ".claude/rules/a.md" and ".claude/rules/b.md"
    const matches = [...iss.message.matchAll(/"([^"]+)"/g)];
    if (matches.length >= 2) {
      const a = basename(matches[0][1]);
      const b = basename(matches[1][1]);
      console.log(chalk.dim(`    \u2502 ${a} \u2194 ${b}`));
    } else {
      const short = iss.message.length > 100 ? iss.message.slice(0, 100) + '\u2026' : iss.message;
      console.log(chalk.dim(`    \u2502 ${short}`));
    }
  }
  console.log(chalk.cyan(`    \u21b3 Narrow globs or merge overlapping rules to reduce redundancy`));
  console.log();
}

function renderCollapsedDangerousAllow(issues: LintIssueItem[], projectRoot: string): void {
  renderCollapsedHeader(issues, projectRoot);
  console.log(`    ${issues.length} dangerous allow patterns`);
  for (const iss of issues) {
    // Extract pattern from: Dangerous allow pattern "Bash" grants...
    const m = iss.message.match(/pattern "([^"]+)"/);
    const pattern = m ? m[1] : 'unknown';
    // Extract description after "grants" or "allows"
    const descM = iss.message.match(/(?:grants|allows)\s+(.+?)\.?\s*(?:Consider|$)/i);
    const desc = descM ? descM[1] : '';
    const suffix = desc ? ` \u2014 ${desc}` : '';
    console.log(chalk.dim(`    \u2502 "${pattern}"${suffix}`));
  }
  console.log(chalk.cyan(`    \u21b3 Scope to specific commands/paths (e.g., Bash(npm run *), Edit(src/**))`));
  console.log();
}

function renderCollapsedOrphanAgent(issues: LintIssueItem[], _projectRoot: string): void {
  const icon = highestSeverityIcon(issues);
  const ruleId = chalk.gray(`[${issues[0].ruleId}]`);
  console.log(`  ${icon} ${ruleId}`);
  // Extract agent names from message or file path
  const names = issues.map(iss => {
    const m = iss.message.match(/Agent "([^"]+)"/);
    if (m) return m[1];
    if (iss.file) return basename(iss.file, '.md');
    return 'unknown';
  });
  console.log(`    ${issues.length} agents not referenced by other config: ${names.join(', ')}`);
  console.log(chalk.cyan(`    \u21b3 These may be invoked directly by prompts \u2014 remove if unused`));
  console.log();
}

function renderCollapsedLargeRuleFile(issues: LintIssueItem[], _projectRoot: string): void {
  const icon = highestSeverityIcon(issues);
  const ruleId = chalk.gray(`[${issues[0].ruleId}]`);
  console.log(`  ${icon} ${ruleId}`);
  console.log(`    ${issues.length} large rule files`);
  for (const iss of issues) {
    const filename = iss.file ? basename(iss.file) : 'unknown';
    const tokenMatch = iss.message.match(/is\s+([\d,]+)\s+tokens/);
    const tokens = tokenMatch ? tokenMatch[1] : '?';
    console.log(chalk.dim(`    \u2502 ${filename} \u2014 ${tokens} tokens`));
  }
  console.log(chalk.cyan(`    \u21b3 Split into smaller rules with narrower scopes, or extract reference material to docs/`));
  console.log();
}

function renderCollapsedFrontmatterPresent(issues: LintIssueItem[], _projectRoot: string): void {
  const icon = highestSeverityIcon(issues);
  const ruleId = chalk.gray(`[${issues[0].ruleId}]`);
  console.log(`  ${icon} ${ruleId}`);
  const names = issues.map(iss => {
    if (iss.file) return basename(iss.file);
    return 'unknown';
  });
  let type = 'config';
  if (issues[0].ruleId.startsWith('agents/')) type = 'agent';
  else if (issues[0].ruleId.startsWith('skills/')) type = 'skill';
  console.log(`    ${issues.length} ${type} files have no YAML frontmatter: ${names.join(', ')}`);
  console.log(chalk.cyan(`    \u21b3 Add frontmatter with at minimum "name" and "description". Optional fields include "tools", "model", and "permissionMode".`));
  console.log();
}

function renderCollapsedGeneric(issues: LintIssueItem[], projectRoot: string): void {
  renderCollapsedHeader(issues, projectRoot);
  console.log(`    ${issues.length} issues`);
  const limit = Math.min(issues.length, 3);
  for (let i = 0; i < limit; i++) {
    const short = issues[i].message.length > 100
      ? issues[i].message.slice(0, 100) + '\u2026'
      : issues[i].message;
    console.log(chalk.dim(`    \u2502 ${short}`));
  }
  if (issues.length > 3) {
    console.log(chalk.dim(`    \u2502 ...and ${issues.length - 3} more`));
  }
  console.log(chalk.cyan(`    \u21b3 ${issues[0].suggestion}`));
  console.log();
}

function renderCollapsedGroup(issues: LintIssueItem[], projectRoot: string): void {
  switch (issues[0].ruleId) {
    case 'settings/deny-sensitive-paths':
      renderCollapsedDenySensitivePaths(issues, projectRoot);
      break;
    case 'memory/todo-fixme':
      renderCollapsedTodoFixme(issues, projectRoot);
      break;
    case 'memory/generic-instructions':
      renderCollapsedGenericInstructions(issues, projectRoot);
      break;
    case 'rules-dir/dead-globs':
      renderCollapsedDeadGlobs(issues, projectRoot);
      break;
    case 'rules-dir/overlapping-rules':
      renderCollapsedOverlappingRules(issues, projectRoot);
      break;
    case 'settings/dangerous-allow':
      renderCollapsedDangerousAllow(issues, projectRoot);
      break;
    case 'agents/orphan-agent':
      renderCollapsedOrphanAgent(issues, projectRoot);
      break;
    case 'rules-dir/large-rule-file':
      renderCollapsedLargeRuleFile(issues, projectRoot);
      break;
    case 'agents/frontmatter-present':
    case 'skills/frontmatter-present':
      renderCollapsedFrontmatterPresent(issues, projectRoot);
      break;
    default:
      renderCollapsedGeneric(issues, projectRoot);
      break;
  }
}

function renderIssueGroup(issues: LintResult['issues'], projectRoot: string, verbose = false): void {
  if (verbose) {
    // Render every issue individually — no collapsing
    for (const issue of issues) {
      renderSingleIssue(issue, projectRoot, true);
    }
  } else {
    // Current behavior — group and collapse
    const renderItems = groupIssuesForRendering(issues);
    for (const item of renderItems) {
      if (Array.isArray(item)) {
        renderCollapsedGroup(item, projectRoot);
      } else {
        renderSingleIssue(item, projectRoot);
      }
    }
  }
}

interface PrintLintOptions {
  projectRoot?: string;
  verbose?: boolean;
  /** When set, issues below this severity were filtered out before rendering. */
  minSeverity?: 'error' | 'warning' | 'info';
}

export function printLintResult(result: LintResult, opts?: PrintLintOptions): void {
  const projectRoot = opts?.projectRoot || process.cwd();
  const verbose = opts?.verbose ?? false;

  console.log();
  console.log(chalk.bold('ccinspect lint') + (verbose ? chalk.gray(' (verbose)') : ''));
  console.log();

  if (result.issues.length === 0) {
    console.log(chalk.green('\u2713 No issues found. Configuration looks good!'));
  } else {
    // Group by category
    const grouped = new Map<string, LintIssueItem[]>();
    for (const issue of result.issues) {
      const cat = issue.category;
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(issue);
    }

    // Sort within each group by severity (error → warning → info)
    for (const issues of grouped.values()) {
      issues.sort((a, b) =>
        (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3),
      );
    }

    // Render groups in defined order
    for (const { key, label } of CATEGORY_ORDER) {
      const issues = grouped.get(key);
      if (!issues || issues.length === 0) continue;

      console.log(chalk.bold(`${label} (${formatSectionCount(issues)})`));
      console.log();
      renderIssueGroup(issues, projectRoot, verbose);
    }

    // Catch any categories not in CATEGORY_ORDER (defensive)
    for (const [cat, issues] of grouped) {
      if (CATEGORY_ORDER.some((c) => c.key === cat)) continue;

      console.log(chalk.bold(`${cat} (${formatSectionCount(issues)})`));
      console.log();
      renderIssueGroup(issues, projectRoot, verbose);
    }
  }

  // Summary
  console.log(chalk.gray('-'.repeat(60)));

  const { errors, warnings, infos } = result.stats;
  const minSeverity = opts?.minSeverity ?? 'info';

  // Headline: only errors + warnings
  const headlineParts: string[] = [];
  if (errors > 0) headlineParts.push(chalk.red(plural(errors, 'error', 'errors')));
  if (warnings > 0) headlineParts.push(chalk.yellow(plural(warnings, 'warning', 'warnings')));
  const headline = headlineParts.length > 0
    ? headlineParts.join(', ')
    : chalk.green('No issues found');

  console.log(
    `${headline} | ${result.stats.rulesRun} rules checked | ${result.stats.filesChecked} files scanned | ${result.stats.duration}ms`,
  );

  // Most affected files
  const fileCounts = new Map<string, number>();
  for (const issue of result.issues) {
    if (!issue.file) continue;
    const short = shortenPath(issue.file, projectRoot);
    fileCounts.set(short, (fileCounts.get(short) || 0) + 1);
  }

  const AGGREGATE_PREFIXES = ['.claude/rules/', '.claude/agents/', '.claude/skills/', '.claude/commands/'];
  const aggregated = new Map<string, number>();
  for (const [file, count] of fileCounts) {
    const prefix = AGGREGATE_PREFIXES.find((p) => file.startsWith(p));
    if (prefix) {
      const key = prefix.slice(0, -1) + '/*';
      aggregated.set(key, (aggregated.get(key) || 0) + count);
    } else {
      aggregated.set(file, (aggregated.get(file) || 0) + count);
    }
  }

  const sorted = [...aggregated.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 3).filter(([, count]) => count > 0);
  if (top.length > 0) {
    const fileParts = top.map(([file, count]) => `${file} (${count})`);
    console.log(chalk.gray(`Most affected: ${fileParts.join(', ')}`));
  }

  // Notes line or suppression notice
  if (minSeverity !== 'info' && infos > 0) {
    // Filtering is active and there are hidden notes
    const hiddenParts: string[] = [];
    if (minSeverity === 'error' && warnings > 0) {
      hiddenParts.push(plural(warnings, 'warning', 'warnings'));
    }
    hiddenParts.push(plural(infos, 'note', 'notes'));
    console.log(chalk.dim(`(${hiddenParts.join(', ')} hidden — use --min-severity info to show)`));
  } else if (infos > 0) {
    console.log(chalk.dim(`+ ${plural(infos, 'note', 'notes')}`));
  }

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

interface PrintBlameOptions {
  projectRoot?: string;
  inventory?: ConfigInventory;
  verbose?: boolean;
}

interface SourceEntry {
  badge: string;
  shortPath: string;
  fullPath: string;
}

function buildSourceLegend(
  inventory: ConfigInventory,
  projectRoot: string,
): { badgeMap: Map<string, string>; legend: SourceEntry[] } {
  const entries: SourceEntry[] = [];
  const badgeMap = new Map<string, string>();

  const sources: Array<{ file: FileInfo | null; badge: string }> = [
    { file: inventory.managedSettings, badge: '[E]' },
    { file: inventory.localSettings, badge: '[L]' },
    { file: inventory.projectSettings, badge: '[P]' },
    { file: inventory.userSettings, badge: '[G]' },
    { file: inventory.preferences, badge: '[G]' },
    { file: inventory.projectMcp, badge: '[M]' },
    { file: inventory.managedMcp, badge: '[E]' },
  ];

  for (const { file, badge } of sources) {
    if (!file?.exists) continue;
    const shortPath = shortenPath(file.path, projectRoot);
    entries.push({ badge, shortPath, fullPath: file.path });
    badgeMap.set(file.path, badge);
  }

  // Deduplicate legend entries (same badge + shortPath)
  const seen = new Set<string>();
  const legend = entries.filter((e) => {
    const key = `${e.badge}:${e.shortPath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { badgeMap, legend };
}

function originBadge(origin: string, badgeMap: Map<string, string>): string {
  if (origin === 'default') return chalk.gray('(default)');
  const badge = badgeMap.get(origin);
  if (!badge) return chalk.gray(origin);

  switch (badge) {
    case '[E]': return chalk.red(badge);
    case '[L]': return chalk.yellow(badge);
    case '[P]': return chalk.green(badge);
    case '[G]': return chalk.blue(badge);
    case '[M]': return chalk.green(badge);
    default: return chalk.gray(badge);
  }
}

function countPermissionsByScope(
  resolved: ResolvedConfig,
  badgeMap: Map<string, string>,
): { project: number; local: number; global: number; enterprise: number } {
  const counts = { project: 0, local: 0, global: 0, enterprise: 0 };
  for (const perm of resolved.permissions.effectiveAllow) {
    const badge = badgeMap.get(perm.origin);
    switch (badge) {
      case '[P]': counts.project++; break;
      case '[L]': counts.local++; break;
      case '[G]': counts.global++; break;
      case '[E]': counts.enterprise++; break;
    }
  }
  return counts;
}

interface BlameFinding {
  icon: string;
  message: string;
  badge: string;
}

function extractKeyFindings(
  resolved: ResolvedConfig,
  badgeMap: Map<string, string>,
): BlameFinding[] {
  const findings: BlameFinding[] = [];

  // 1. Deny rules — each is a security boundary
  for (const deny of resolved.permissions.effectiveDeny) {
    const badge = originBadge(deny.origin, badgeMap);
    // Check if a broader allow exists for the same tool
    const toolMatch = deny.pattern.match(/^([A-Za-z]+)\(/);
    const toolName = toolMatch ? toolMatch[1] : null;
    let extra = '';
    if (toolName) {
      const hasBroaderAllow = resolved.permissions.effectiveAllow.some(
        a => a.pattern === `${toolName}(*)`,
      );
      if (hasBroaderAllow) {
        extra = ` despite ${toolName}(*) allow`;
      }
    }
    findings.push({
      icon: chalk.red('!'),
      message: `${deny.pattern} denied${extra}`,
      badge,
    });
  }

  // 2. Env shadows
  for (const [name, envVar] of resolved.environment.effective) {
    if (!envVar.shadowedValues || envVar.shadowedValues.length === 0) continue;
    const badge = originBadge(envVar.origin, badgeMap);
    for (const sv of envVar.shadowedValues) {
      const svBadge = originBadge(sv.origin, badgeMap);
      findings.push({
        icon: chalk.yellow('!'),
        message: `${name}=${envVar.value} shadows "${sv.value}"`,
        badge: `${badge} \u2192 ${svBadge}`,
      });
    }
  }

  // 3. Permission conflicts
  for (const conflict of resolved.permissions.conflicts) {
    findings.push({
      icon: chalk.red('!'),
      message: `${conflict.pattern}: ${conflict.explanation}`,
      badge: '',
    });
  }

  // 4. MCP conflicts
  for (const server of resolved.mcpServers.conflicts) {
    if (!server.conflicts || server.conflicts.length === 0) continue;
    const badge = originBadge(server.origin, badgeMap);
    findings.push({
      icon: chalk.yellow('!'),
      message: `MCP "${server.name}" conflict across scopes`,
      badge,
    });
  }

  return findings;
}

export function printResolvedConfig(resolved: ResolvedConfig, sections: ResolveSections, opts?: PrintBlameOptions): void {
  const projectRoot = opts?.projectRoot || process.cwd();
  const { badgeMap, legend } = opts?.inventory
    ? buildSourceLegend(opts.inventory, projectRoot)
    : { badgeMap: new Map<string, string>(), legend: [] as SourceEntry[] };

  console.log();
  console.log(chalk.bold('ccinspect blame'));
  console.log();

  // ── Effective config summary ──
  console.log(chalk.bold('  Effective config'));

  // Model
  const modelBadge = originBadge(resolved.model.effectiveModel.origin, badgeMap);
  console.log(`    Model:       ${resolved.model.effectiveModel.value}  ${modelBadge}`);

  // Sandbox
  const sbEnabled = resolved.sandbox.enabled.value;
  const sbOrigin = resolved.sandbox.enabled.origin;
  if (sbOrigin === 'default') {
    console.log(chalk.gray(`    Sandbox:     ${sbEnabled ? 'enabled' : 'disabled'} (default)`));
  } else {
    const sbBadge = originBadge(sbOrigin, badgeMap);
    const sbStatus = sbEnabled ? chalk.green('enabled') : chalk.yellow('disabled');
    console.log(`    Sandbox:     ${sbStatus}  ${sbBadge}`);
  }

  // MCP
  const enabledServers = resolved.mcpServers.effective.filter(s => s.enabled);
  if (enabledServers.length > 0) {
    const names = enabledServers.map(s => s.name);
    const displayNames = names.length <= 4
      ? names.join(', ')
      : `${names.slice(0, 3).join(', ')}, +${names.length - 3} more`;
    const mcpOrigins = new Set(enabledServers.map(s => s.origin));
    const mcpBadge = mcpOrigins.size === 1
      ? '  ' + originBadge([...mcpOrigins][0], badgeMap)
      : '';
    console.log(`    MCP:         ${displayNames}${mcpBadge}`);
  } else {
    console.log(chalk.gray('    MCP:         no project servers'));
  }

  // Env vars
  const envCount = resolved.environment.effective.size;
  const shadowCount = resolved.environment.shadows.length;
  const envParts = [`${envCount} defined`];
  if (shadowCount > 0) envParts.push(`${shadowCount} shadowed`);
  console.log(`    Env vars:    ${envParts.join(' \u00b7 ')}`);

  // Permissions by scope
  const permCounts = countPermissionsByScope(resolved, badgeMap);
  const permParts: string[] = [];
  if (permCounts.enterprise > 0) permParts.push(`${permCounts.enterprise} enterprise`);
  if (permCounts.local > 0) permParts.push(`${permCounts.local} local`);
  if (permCounts.project > 0) permParts.push(`${permCounts.project} project`);
  if (permCounts.global > 0) permParts.push(`${permCounts.global} global`);
  const denyCount = resolved.permissions.effectiveDeny.length;
  permParts.push(`${denyCount} deny`);
  console.log(`    Permissions: ${permParts.join(' \u00b7 ')}`);

  console.log();

  // ── Key findings ──
  const findings = extractKeyFindings(resolved, badgeMap);
  if (findings.length > 0) {
    console.log(chalk.bold('  Key findings'));
    const maxToShow = 5;
    const shown = findings.slice(0, maxToShow);
    for (const f of shown) {
      const badgePart = f.badge ? `  ${f.badge}` : '';
      console.log(`    ${f.icon} ${f.message}${badgePart}`);
    }
    if (findings.length > maxToShow) {
      console.log(chalk.gray(`    \u2026 and ${findings.length - maxToShow} more (see details below)`));
    }
    console.log();
  }

  if (sections.permissions) {
    console.log(chalk.bold.underline('Permissions'));
    console.log();

    const hasPerms = resolved.permissions.effectiveAllow.length > 0 || resolved.permissions.effectiveDeny.length > 0;

    if (hasPerms) {
      // Deny rules first (security boundaries visible immediately)
      if (resolved.permissions.effectiveDeny.length > 0) {
        console.log(`  ${chalk.bold('Deny')}`);
        for (const rule of resolved.permissions.effectiveDeny) {
          const badge = originBadge(rule.origin, badgeMap);
          console.log(`    ${chalk.red('-')} ${rule.pattern}  ${badge}`);
        }
        console.log();
      }

      // Allow rules grouped by scope
      const scopeOrder: string[] = ['[E]', '[L]', '[P]', '[G]'];
      const scopeLabels: Record<string, string> = {
        '[E]': 'Enterprise allow',
        '[L]': 'Local allow',
        '[P]': 'Project allow',
        '[G]': 'Global allow',
      };

      // Group allow rules by scope badge
      const allowByScope = new Map<string, string[]>();
      for (const perm of resolved.permissions.effectiveAllow) {
        const badge = badgeMap.get(perm.origin) ?? '[?]';
        if (!allowByScope.has(badge)) {
          allowByScope.set(badge, []);
        }
        allowByScope.get(badge)!.push(perm.pattern);
      }

      // Render each scope group in precedence order
      for (const badge of scopeOrder) {
        const patterns = allowByScope.get(badge);
        if (!patterns || patterns.length === 0) continue;

        const label = scopeLabels[badge] ?? `Allow (${badge})`;
        // Find any origin with this badge for coloring the header badge
        const sampleOrigin = resolved.permissions.effectiveAllow.find(
          (p) => badgeMap.get(p.origin) === badge,
        )?.origin ?? '';
        const coloredBadge = originBadge(sampleOrigin, badgeMap);

        // Global allow: collapse by default unless verbose
        if (badge === '[G]' && !opts?.verbose) {
          console.log(`  ${chalk.bold(label)}  ${coloredBadge}`);
          console.log(chalk.gray(`    \u2026 ${patterns.length} patterns (--verbose to expand)`));
          console.log();
          continue;
        }

        // Non-global (or verbose global): show all patterns
        console.log(`  ${chalk.bold(label)}  ${coloredBadge}`);
        for (const pattern of patterns) {
          console.log(`    ${chalk.green('+')} ${pattern}`);
        }
        console.log();
      }

      // Conflicts
      if (resolved.permissions.conflicts.length > 0) {
        for (const conflict of resolved.permissions.conflicts) {
          const badge = originBadge(conflict.rules[0]?.origin ?? '', badgeMap);
          console.log(`  ${chalk.red('!')} ${conflict.pattern}  ${conflict.explanation}  ${badge}`);
        }
        console.log();
      }

      // Redundancies: collapsed to one info line
      if (resolved.permissions.redundancies.length > 0) {
        const count = resolved.permissions.redundancies.length;
        const broadPatterns = new Set(
          resolved.permissions.redundancies.map((r) => r.broad.pattern),
        );
        const broadList = [...broadPatterns].join(', ');
        console.log(chalk.gray(`  \u2139 ${count} redundant rules (covered by ${broadList})`));
        console.log();
      }
    } else {
      console.log(chalk.gray('  No permission rules configured'));
      console.log();
    }
  }

  if (sections.env) {
    console.log(chalk.bold.underline('Environment Variables'));
    if (resolved.environment.effective.size > 0) {
      // Calculate max key=value width for alignment
      const envEntries = [...resolved.environment.effective.entries()];
      const maxKV = Math.max(...envEntries.map(([name, envVar]) => `${name}=${envVar.value}`.length));

      for (const [name, envVar] of envEntries) {
        const kv = `${name}=${envVar.value}`;
        const badge = originBadge(envVar.origin, badgeMap);
        console.log(`  ${kv.padEnd(maxKV)}  ${badge}`);
        if (envVar.shadowedValues) {
          for (const sv of envVar.shadowedValues) {
            const svBadge = originBadge(sv.origin, badgeMap);
            console.log(chalk.gray(`    ↳ shadows "${sv.value}" from `) + svBadge);
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
        const badge = originBadge(server.origin, badgeMap);
        console.log(`  ${server.name.padEnd(maxName)}  ${padEnd(status, maxStatus)}  ${badge}`);
        if (server.conflicts && server.conflicts.length > 0) {
          for (const c of server.conflicts) {
            const cStatus = c.enabled ? 'enabled' : 'disabled';
            const cBadge = originBadge(c.origin, badgeMap);
            console.log(chalk.yellow(`${''.padEnd(maxName + 4)}conflict: ${cStatus} `) + cBadge);
          }
        }
      }
    } else {
      console.log(chalk.gray('  No project servers configured'));
    }
    console.log(chalk.gray('  (user servers in ~/.claude.json not yet scanned)'));
    console.log();
  }

  if (sections.model) {
    const hasModelOverrides = resolved.model.subagentModel !== null
      || resolved.model.haikuModel !== null
      || resolved.model.opusModel !== null;
    if (hasModelOverrides) {
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
        const badge = originBadge(row.origin, badgeMap);
        console.log(`  ${row.label.padEnd(maxLabel)}  ${row.value.padEnd(maxValue)}  ${badge}`);
      }
      console.log();
    }
  }

  if (sections.sandbox) {
    const hasSandboxDetail = resolved.sandbox.enabled.origin !== 'default'
      || resolved.sandbox.autoAllowBashIfSandboxed !== null
      || resolved.sandbox.excludedCommands !== null
      || Object.keys(resolved.sandbox.networkConfig).length > 0;
    if (hasSandboxDetail) {
      console.log(chalk.bold.underline('Sandbox'));
      const sandboxStatus = resolved.sandbox.enabled.value ? chalk.green('enabled') : chalk.yellow('disabled');
      const sandboxBadge = originBadge(resolved.sandbox.enabled.origin, badgeMap);
      console.log(`  Sandbox: ${sandboxStatus}  ${sandboxBadge}`);
      if (resolved.sandbox.autoAllowBashIfSandboxed) {
        const bashBadge = originBadge(resolved.sandbox.autoAllowBashIfSandboxed.origin, badgeMap);
        console.log(`  Auto-allow Bash: ${resolved.sandbox.autoAllowBashIfSandboxed.value}  ${bashBadge}`);
      }
      if (resolved.sandbox.excludedCommands) {
        const cmdsBadge = originBadge(resolved.sandbox.excludedCommands.origin, badgeMap);
        console.log(`  Excluded commands: ${resolved.sandbox.excludedCommands.value.join(', ')}  ${cmdsBadge}`);
      }
      if (Object.keys(resolved.sandbox.networkConfig).length > 0) {
        console.log(`  Network config: ${JSON.stringify(resolved.sandbox.networkConfig)}`);
      }
      console.log();
    }
  }

  if (legend.length > 0) {
    console.log(chalk.bold('Sources'));
    for (const entry of legend) {
      const coloredBadge = originBadge(entry.fullPath, badgeMap);
      console.log(`  ${coloredBadge} ${entry.shortPath}`);
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

// ------- Blame Settings Output -------

export interface SettingsTableRow {
  key: string;
  displayValue: string;
  sourceBadge: string;
  overrides?: Array<{ value: string; badge: string }>;
}

const SETTINGS_KEY_ORDER = [
  'model', 'availableModels',
  'permissions', 'permissions.allow', 'permissions.deny', 'permissions.ask',
  'permissions.defaultMode', 'permissions.additionalDirectories', 'permissions.disableBypassPermissionsMode',
  'sandbox', 'sandbox.enabled', 'sandbox.autoAllowBashIfSandboxed', 'sandbox.excludedCommands',
  'env',
  'hooks', 'disableAllHooks',
  'enableAllProjectMcpServers', 'enabledMcpjsonServers', 'disabledMcpjsonServers',
  'enabledPlugins', 'extraKnownMarketplaces',
  'includeCoAuthoredBy', 'cleanupPeriodDays', 'outputStyle', 'autoUpdatesChannel',
  'forceLoginMethod', 'forceLoginOrgUUID', 'apiKeyHelper',
  'statusLine', 'companyAnnouncements',
];

const INTERNAL_KEYS = new Set(['$schema', 'feedbackSurveyState']);

/** Keys that need cross-layer aggregation instead of simple "highest wins" */
const COMPLEX_KEYS = new Set(['permissions', 'env', 'hooks']);

function sortSettingsKeys(keys: Set<string>): string[] {
  return [...keys].sort((a, b) => {
    const aIdx = settingsKeyIndex(a);
    const bIdx = settingsKeyIndex(b);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return a.localeCompare(b);
  });
}

/** Find sort index for a key. For dotted keys like env.NODE_ENV, fall back to parent prefix. */
function settingsKeyIndex(key: string): number {
  const idx = SETTINGS_KEY_ORDER.indexOf(key);
  if (idx !== -1) return idx;
  // For env.FOO, sort by 'env' position + 0.5 so it stays grouped after 'env'
  const dot = key.indexOf('.');
  if (dot !== -1) {
    const parent = key.slice(0, dot);
    const parentIdx = SETTINGS_KEY_ORDER.indexOf(parent);
    if (parentIdx !== -1) return parentIdx + 0.5;
  }
  return -1;
}

function formatSettingsValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '(not set)';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `${value.length} items`;
  if (typeof value === 'object') {
    if (key === 'permissions') {
      const p = value as Record<string, unknown>;
      const parts: string[] = [];
      if (Array.isArray(p.allow)) parts.push(`${p.allow.length} allow`);
      if (Array.isArray(p.deny)) parts.push(`${p.deny.length} deny`);
      if (Array.isArray(p.ask)) parts.push(`${p.ask.length} ask`);
      return parts.length > 0 ? parts.join(', ') : '(empty)';
    }
    if (key === 'env') {
      return `${Object.keys(value).length} variables`;
    }
    if (key === 'hooks') {
      let hookCount = 0;
      for (const v of Object.values(value as Record<string, unknown>)) {
        if (Array.isArray(v)) hookCount += v.length;
      }
      return hookCount > 0 ? `${hookCount} hook(s)` : '(none configured)';
    }
    if (key === 'sandbox') {
      const s = value as Record<string, unknown>;
      return s.enabled ? 'enabled' : 'disabled';
    }
    if (key === 'enabledPlugins') {
      return `${Object.keys(value).length} plugin(s)`;
    }
    if (key === 'availableModels') {
      return `${Object.keys(value).length} model(s)`;
    }
    return `{${Object.keys(value).length} keys}`;
  }
  return String(value);
}

export interface RawSettingsLayer {
  path: string;
  data: Record<string, unknown>;
}

export function buildSettingsTable(
  rawLayers: RawSettingsLayer[],
  badgeMap: Map<string, string>,
  verbose: boolean = false,
): SettingsTableRow[] {
  const allKeys = new Set<string>();
  for (const layer of rawLayers) {
    for (const key of Object.keys(layer.data)) {
      if (INTERNAL_KEYS.has(key)) continue;
      allKeys.add(key);
    }
  }

  const rows: SettingsTableRow[] = [];
  for (const key of sortSettingsKeys(allKeys)) {
    switch (key) {
      case 'env':
        rows.push(...flattenEnvRows(rawLayers, badgeMap));
        break;
      case 'permissions':
        rows.push(...flattenPermissionsRows(rawLayers, badgeMap, verbose));
        break;
      case 'sandbox':
        rows.push(...flattenSandboxRows(rawLayers, badgeMap, verbose));
        break;
      case 'enabledPlugins':
        rows.push(...flattenPluginsRows(rawLayers, badgeMap, verbose));
        break;
      case 'hooks':
        rows.push(...flattenHooksRows(rawLayers, badgeMap));
        break;
      default:
        rows.push(...flattenScalarRow(key, rawLayers, badgeMap));
        break;
    }
  }

  return rows;
}

/** Simple scalar key: highest precedence wins. */
function flattenScalarRow(
  key: string,
  layers: RawSettingsLayer[],
  badgeMap: Map<string, string>,
): SettingsTableRow[] {
  let effectiveValue: unknown = undefined;
  let effectiveSource: RawSettingsLayer | null = null;
  const overrides: Array<{ value: string; badge: string }> = [];

  for (const layer of layers) {
    if (!(key in layer.data)) continue;
    const value = layer.data[key];

    if (effectiveSource === null) {
      effectiveValue = value;
      effectiveSource = layer;
    } else {
      overrides.push({
        value: formatSettingsValue(key, value),
        badge: originBadge(layer.path, badgeMap),
      });
    }
  }

  if (!effectiveSource) return [];

  return [{
    key,
    displayValue: formatSettingsValue(key, effectiveValue),
    sourceBadge: originBadge(effectiveSource.path, badgeMap),
    overrides: overrides.length > 0 ? overrides : undefined,
  }];
}

/**
 * Env vars: each env var becomes its own row with actual value.
 * Individual keys from higher-priority layers win.
 */
function flattenEnvRows(
  layers: RawSettingsLayer[],
  badgeMap: Map<string, string>,
): SettingsTableRow[] {
  const rows: SettingsTableRow[] = [];
  const effectiveEnv = new Map<string, { value: string; badge: string }>();
  const envOverrides = new Map<string, Array<{ value: string; badge: string }>>();

  for (const layer of layers) {
    const env = layer.data.env as Record<string, string> | undefined;
    if (!env || Object.keys(env).length === 0) continue;
    const badge = originBadge(layer.path, badgeMap);

    for (const [envKey, envValue] of Object.entries(env)) {
      if (!effectiveEnv.has(envKey)) {
        effectiveEnv.set(envKey, { value: String(envValue), badge });
      } else {
        if (!envOverrides.has(envKey)) envOverrides.set(envKey, []);
        envOverrides.get(envKey)!.push({ value: String(envValue), badge });
      }
    }
  }

  for (const [envKey, effective] of effectiveEnv) {
    const overrides = envOverrides.get(envKey);
    rows.push({
      key: `env.${envKey}`,
      displayValue: effective.value,
      sourceBadge: effective.badge,
      overrides: overrides && overrides.length > 0 ? overrides : undefined,
    });
  }

  return rows;
}

/**
 * Permissions: arrays REPLACE (BUG-1), not merge.
 * allow/ask: highest-precedence layer wins entirely.
 * deny: collect from ALL layers (additive).
 * Sub-fields (defaultMode, etc.) shown as individual scalar rows.
 */
function flattenPermissionsRows(
  layers: RawSettingsLayer[],
  badgeMap: Map<string, string>,
  verbose: boolean,
): SettingsTableRow[] {
  const rows: SettingsTableRow[] = [];

  // --- allow: highest layer wins (BUG-1: arrays replace) ---
  let effectiveAllow: { count: number; badge: string } | null = null;
  const allowOverrides: Array<{ value: string; badge: string }> = [];

  for (const layer of layers) {
    const perms = layer.data.permissions as Record<string, unknown> | undefined;
    const allowArr = perms?.allow as string[] | undefined;
    if (!allowArr || allowArr.length === 0) continue;
    const badge = originBadge(layer.path, badgeMap);
    if (effectiveAllow === null) {
      effectiveAllow = { count: allowArr.length, badge };
    } else {
      allowOverrides.push({ value: `${allowArr.length} patterns`, badge });
    }
  }

  if (effectiveAllow) {
    rows.push({
      key: 'permissions.allow',
      displayValue: pluralize(effectiveAllow.count, 'pattern'),
      sourceBadge: effectiveAllow.badge,
      overrides: allowOverrides.length > 0 ? allowOverrides : undefined,
    });
  }

  // --- deny: collect from ALL layers (deny is additive) ---
  let totalDeny = 0;
  const denyBadges: string[] = [];
  for (const layer of layers) {
    const perms = layer.data.permissions as Record<string, unknown> | undefined;
    const denyArr = perms?.deny as string[] | undefined;
    if (!denyArr || denyArr.length === 0) continue;
    totalDeny += denyArr.length;
    denyBadges.push(originBadge(layer.path, badgeMap));
  }
  if (totalDeny > 0) {
    rows.push({
      key: 'permissions.deny',
      displayValue: pluralize(totalDeny, 'pattern'),
      sourceBadge: uniqueJoin(denyBadges),
    });
  }

  // --- ask: highest layer wins (same as allow) ---
  let effectiveAsk: { count: number; badge: string } | null = null;
  const askOverrides: Array<{ value: string; badge: string }> = [];

  for (const layer of layers) {
    const perms = layer.data.permissions as Record<string, unknown> | undefined;
    const askArr = perms?.ask as string[] | undefined;
    if (!askArr || askArr.length === 0) continue;
    const badge = originBadge(layer.path, badgeMap);
    if (effectiveAsk === null) {
      effectiveAsk = { count: askArr.length, badge };
    } else {
      askOverrides.push({ value: `${askArr.length} patterns`, badge });
    }
  }

  if (effectiveAsk) {
    rows.push({
      key: 'permissions.ask',
      displayValue: pluralize(effectiveAsk.count, 'pattern'),
      sourceBadge: effectiveAsk.badge,
      overrides: askOverrides.length > 0 ? askOverrides : undefined,
    });
  }

  // --- Sub-fields as individual scalar rows ---
  const subFields = ['defaultMode', 'additionalDirectories', 'disableBypassPermissionsMode'];
  for (const subField of subFields) {
    for (const layer of layers) {
      const perms = layer.data.permissions as Record<string, unknown> | undefined;
      if (!perms || !(subField in perms)) continue;
      const badge = originBadge(layer.path, badgeMap);
      const val = perms[subField];
      rows.push({
        key: `permissions.${subField}`,
        displayValue: Array.isArray(val) ? val.join(', ') : String(val),
        sourceBadge: badge,
      });
      break; // highest wins
    }
  }

  return rows;
}

/**
 * Sandbox: in default mode show only sandbox.enabled.
 * In verbose mode, expand all sub-fields.
 */
function flattenSandboxRows(
  layers: RawSettingsLayer[],
  badgeMap: Map<string, string>,
  verbose: boolean,
): SettingsTableRow[] {
  const rows: SettingsTableRow[] = [];
  const allFields = ['enabled', 'autoAllowBashIfSandboxed', 'excludedCommands', 'allowUnsandboxedCommands'];
  const fieldsToShow = verbose ? allFields : ['enabled'];

  for (const field of fieldsToShow) {
    for (const layer of layers) {
      const sandbox = layer.data.sandbox as Record<string, unknown> | undefined;
      if (!sandbox || !(field in sandbox)) continue;
      const badge = originBadge(layer.path, badgeMap);
      const value = sandbox[field];
      rows.push({
        key: `sandbox.${field}`,
        displayValue: Array.isArray(value) ? value.join(', ') : String(value),
        sourceBadge: badge,
      });
      break; // highest wins
    }
  }

  return rows;
}

/**
 * Plugins: in default mode show count summary.
 * In verbose mode, show each plugin individually.
 */
function flattenPluginsRows(
  layers: RawSettingsLayer[],
  badgeMap: Map<string, string>,
  verbose: boolean,
): SettingsTableRow[] {
  const rows: SettingsTableRow[] = [];
  const effectivePlugins = new Map<string, { enabled: boolean; badge: string }>();

  for (const layer of layers) {
    const plugins = layer.data.enabledPlugins as Record<string, boolean> | undefined;
    if (!plugins) continue;
    const badge = originBadge(layer.path, badgeMap);
    for (const [name, enabled] of Object.entries(plugins)) {
      if (!effectivePlugins.has(name)) {
        effectivePlugins.set(name, { enabled: !!enabled, badge });
      }
    }
  }

  if (effectivePlugins.size === 0) return [];

  if (verbose) {
    for (const [name, { enabled, badge }] of effectivePlugins) {
      rows.push({
        key: `enabledPlugins.${name}`,
        displayValue: String(enabled),
        sourceBadge: badge,
      });
    }
  } else {
    const badges = new Set([...effectivePlugins.values()].map((v) => v.badge));
    rows.push({
      key: 'enabledPlugins',
      displayValue: `${effectivePlugins.size} plugin(s)`,
      sourceBadge: [...badges].join(' + '),
    });
  }

  return rows;
}

/**
 * Hooks: collect from all layers. Show total count.
 */
function flattenHooksRows(
  layers: RawSettingsLayer[],
  badgeMap: Map<string, string>,
): SettingsTableRow[] {
  let totalHooks = 0;
  const sourceBadges: string[] = [];

  for (const layer of layers) {
    const hooks = layer.data.hooks as Record<string, unknown> | undefined;
    if (!hooks) continue;
    let layerCount = 0;
    for (const v of Object.values(hooks)) {
      if (Array.isArray(v)) layerCount += v.length;
    }
    if (layerCount > 0) {
      totalHooks += layerCount;
      sourceBadges.push(originBadge(layer.path, badgeMap));
    }
  }

  if (totalHooks === 0) {
    const hasHooksKey = layers.some((l) => 'hooks' in l.data);
    if (!hasHooksKey) return [];
    return [{
      key: 'hooks',
      displayValue: '(none configured)',
      sourceBadge: originBadge(layers.find((l) => 'hooks' in l.data)!.path, badgeMap),
    }];
  }

  return [{
    key: 'hooks',
    displayValue: `${totalHooks} hook(s)`,
    sourceBadge: uniqueJoin(sourceBadges),
  }];
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count !== 1 ? 's' : ''}`;
}

function uniqueJoin(badges: string[]): string {
  // Deduplicate while preserving order, stripping ANSI for comparison
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const b of badges) {
    // eslint-disable-next-line no-control-regex
    const plain = b.replace(/\x1b\[[0-9;]*m/g, '');
    if (!seen.has(plain)) {
      seen.add(plain);
      unique.push(b);
    }
  }
  return unique.join(' + ');
}

export function printBlameSettings(
  rows: SettingsTableRow[],
  legend: SourceEntry[],
  verbose: boolean,
): void {
  console.log();
  console.log(chalk.bold('ccinspect blame settings'));
  console.log();

  // Sources legend — only in verbose mode
  if (verbose) {
    console.log(chalk.bold('  Sources'));
    for (const entry of legend) {
      const coloredBadge = colorBadge(entry.badge);
      console.log(`    ${coloredBadge} ${SCOPE_LABELS[entry.badge] ?? ''} ${entry.shortPath}`);
    }
    console.log();
  }

  if (rows.length === 0) {
    console.log(chalk.gray('  No settings files found.'));
    console.log();
    return;
  }

  // Column widths
  const maxKey = Math.max(...rows.map((r) => r.key.length), 3);
  const maxVal = Math.max(...rows.map((r) => r.displayValue.length), 5);
  const keyCol = Math.min(maxKey + 2, 34);
  const valCol = Math.min(maxVal + 2, 32);

  console.log(`  ${'Key'.padEnd(keyCol)}${'Value'.padEnd(valCol)}Source`);
  console.log(chalk.gray(`  ${'─'.repeat(keyCol + valCol + 10)}`));

  for (const row of rows) {
    const key = row.key.length > keyCol - 2
      ? row.key.slice(0, keyCol - 4) + '…'
      : row.key;
    const val = row.displayValue.length > valCol - 2
      ? row.displayValue.slice(0, valCol - 4) + '…'
      : row.displayValue;

    // Source column: badge + label, with inline override annotation
    let sourceStr = badgeWithLabel(row.sourceBadge);
    if (row.overrides && row.overrides.length > 0) {
      const replacedBadges = row.overrides.map((ov) => badgeWithLabel(ov.badge)).join(', ');
      sourceStr += chalk.gray(`  (overrides ${replacedBadges})`);
    }

    console.log(`  ${key.padEnd(keyCol)}${val.padEnd(valCol)}${sourceStr}`);

    // Verbose: expanded per-override detail below the row
    if (verbose && row.overrides && row.overrides.length > 0) {
      for (const ov of row.overrides) {
        console.log(chalk.gray(`  ${''.padEnd(keyCol)}↳ overridden value: "${ov.value}" from ${badgeWithLabel(ov.badge)}`));
      }
    }
  }

  console.log(chalk.gray(`  ${'─'.repeat(keyCol + valCol + 10)}`));

  const fileCount = legend.length;
  const keyCount = rows.length;
  console.log(chalk.gray(`  ${fileCount} file${fileCount !== 1 ? 's' : ''} loaded · ${keyCount} key${keyCount !== 1 ? 's' : ''} resolved`));
  console.log();
}

export function printBlameSettingsJson(rows: SettingsTableRow[]): void {
  const output = rows.map((r) => ({
    key: r.key,
    value: r.displayValue,
    source: r.sourceBadge,
    ...(r.overrides ? { overrides: r.overrides } : {}),
  }));
  console.log(JSON.stringify(output, null, 2));
}

function colorBadge(badge: string): string {
  switch (badge) {
    case '[E]': return chalk.red(badge);
    case '[L]': return chalk.yellow(badge);
    case '[P]': return chalk.green(badge);
    case '[G]': return chalk.blue(badge);
    case '[M]': return chalk.green(badge);
    default: return chalk.gray(badge);
  }
}

const SCOPE_LABELS: Record<string, string> = {
  '[E]': 'Managed',
  '[L]': 'Local',
  '[P]': 'Project',
  '[G]': 'Global',
  '[M]': 'MCP',
};

/** Strip ANSI escape codes to get raw text */
function stripAnsiText(str: string): string {
  return str.replace(ANSI_RE, '');
}

/** Append scope label to a colored badge: '[P]' → '[P] Project' */
function badgeWithLabel(coloredBadge: string): string {
  const raw = stripAnsiText(coloredBadge);
  // Handle multi-source badges like '[L] + [P]'
  if (raw.includes(' + ')) {
    const parts = coloredBadge.split(' + ');
    return parts.map((p) => {
      const r = stripAnsiText(p.trim());
      const label = SCOPE_LABELS[r];
      return label ? `${p.trim()} ${label}` : p.trim();
    }).join(' + ');
  }
  const label = SCOPE_LABELS[raw];
  return label ? `${coloredBadge} ${label}` : coloredBadge;
}

// Export shared utilities for use by blame subcommands
export { buildSourceLegend, shortenPath };
export type { SourceEntry };

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
