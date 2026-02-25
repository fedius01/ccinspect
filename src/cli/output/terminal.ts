import chalk from 'chalk';
import type { FileInfo, ConfigInventory, LintResult, ResolvedConfig } from '../../types/index.js';
import type { RuntimeInfo } from '../../types/runtime.js';
import type { ProjectComparison } from '../commands/compare.js';

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
  if (!file) return chalk.gray('  -');
  if (!file.exists) return chalk.gray('  -');
  if (file.gitTracked) return chalk.green('  \u2713');
  return chalk.yellow('  \u25cb');
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

function printFileRow(label: string, file: FileInfo | null): void {
  if (!file) return;

  const status = fileStatusIcon(file);
  const exists = file.exists ? chalk.green('YES') : chalk.gray('no');
  const size = file.exists ? formatSize(file.sizeBytes) : '-';
  const lines = file.exists ? String(file.lineCount) : '-';
  const tokens = file.exists ? formatTokens(file.estimatedTokens) : '-';
  const scope = scopeColor(file.scope);

  console.log(
    `${status}  ${label.padEnd(28)} ${exists.padEnd(12)} ${scope.padEnd(24)} ${size.padStart(8)} ${lines.padStart(6)} ${tokens.padStart(8)}`,
  );
}

export function printInventory(inventory: ConfigInventory): void {
  console.log();
  console.log(chalk.bold('ccinspect scan'));
  console.log(chalk.gray(`Project: ${inventory.projectRoot}`));
  if (inventory.gitRoot) {
    console.log(chalk.gray(`Git root: ${inventory.gitRoot}`));
  }
  console.log();

  // Header
  console.log(
    chalk.bold(
      `${'   '.padEnd(3)}  ${'File'.padEnd(28)} ${'Exists'.padEnd(12)} ${'Scope'.padEnd(24)} ${'Size'.padStart(8)} ${'Lines'.padStart(6)} ${'Tokens'.padStart(8)}`,
    ),
  );
  console.log(chalk.gray('-'.repeat(95)));

  // Settings
  console.log(chalk.bold.underline('\nSettings'));
  printFileRow('~/.claude/settings.json', inventory.userSettings);
  printFileRow('.claude/settings.json', inventory.projectSettings);
  printFileRow('.claude/settings.local.json', inventory.localSettings);
  printFileRow('managed-settings.json', inventory.managedSettings);
  printFileRow('~/.claude.json', inventory.preferences);

  // Memory
  console.log(chalk.bold.underline('\nMemory (CLAUDE.md)'));
  printFileRow('~/.claude/CLAUDE.md', inventory.globalClaudeMd);
  printFileRow('CLAUDE.md', inventory.projectClaudeMd);
  printFileRow('CLAUDE.local.md', inventory.localClaudeMd);
  for (const subdir of inventory.subdirClaudeMds) {
    printFileRow(subdir.relativePath, subdir);
  }
  printFileRow('MEMORY.md (auto)', inventory.autoMemory);
  for (const topic of inventory.autoMemoryTopics) {
    printFileRow(`  ${topic.relativePath}`, topic);
  }

  // Rules
  if (inventory.rules.length > 0) {
    console.log(chalk.bold.underline('\nRules'));
    for (const rule of inventory.rules) {
      printFileRow(rule.relativePath, rule);
    }
  }

  // Agents
  if (inventory.projectAgents.length > 0 || inventory.userAgents.length > 0) {
    console.log(chalk.bold.underline('\nAgents'));
    for (const agent of inventory.projectAgents) {
      printFileRow(agent.relativePath, agent);
    }
    for (const agent of inventory.userAgents) {
      printFileRow(agent.relativePath, agent);
    }
  }

  // Commands
  if (inventory.projectCommands.length > 0 || inventory.userCommands.length > 0) {
    console.log(chalk.bold.underline('\nCommands'));
    for (const cmd of inventory.projectCommands) {
      printFileRow(cmd.relativePath, cmd);
    }
    for (const cmd of inventory.userCommands) {
      printFileRow(cmd.relativePath, cmd);
    }
  }

  // Skills
  if (inventory.projectSkills.length > 0) {
    console.log(chalk.bold.underline('\nSkills'));
    for (const skill of inventory.projectSkills) {
      printFileRow(skill.relativePath, skill);
    }
  }

  // MCP
  console.log(chalk.bold.underline('\nMCP'));
  printFileRow('.mcp.json', inventory.projectMcp);
  printFileRow('managed-mcp.json', inventory.managedMcp);

  // Summary
  console.log();
  console.log(chalk.gray('-'.repeat(95)));
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

export function printLintResult(result: LintResult): void {
  console.log();
  console.log(chalk.bold('ccinspect lint'));
  console.log();

  if (result.issues.length === 0) {
    console.log(chalk.green('\u2713 No issues found. Configuration looks good!'));
  } else {
    for (const issue of result.issues) {
      const icon = severityIcon(issue.severity);
      const ruleId = chalk.gray(`[${issue.ruleId}]`);
      const fileRef = issue.file ? chalk.gray(` (${issue.file}${issue.line ? `:${issue.line}` : ''})`) : '';
      console.log(`${icon} ${issue.message}${fileRef} ${ruleId}`);
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

    if (resolved.permissions.effectiveAllow.length > 0) {
      console.log(chalk.green('  Allow:'));
      for (const rule of resolved.permissions.effectiveAllow) {
        console.log(`    ${chalk.green('+')} ${rule.pattern}  ${chalk.gray(`← ${rule.origin}`)}`);
      }
    }

    if (resolved.permissions.effectiveDeny.length > 0) {
      console.log(chalk.red('  Deny:'));
      for (const rule of resolved.permissions.effectiveDeny) {
        console.log(`    ${chalk.red('-')} ${rule.pattern}  ${chalk.gray(`← ${rule.origin}`)}`);
      }
    }

    if (resolved.permissions.conflicts.length > 0) {
      console.log(chalk.red('  Conflicts:'));
      for (const conflict of resolved.permissions.conflicts) {
        console.log(`    ${chalk.red('!')} ${conflict.pattern}: ${conflict.explanation}`);
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
      for (const [name, envVar] of resolved.environment.effective) {
        const shadowTag = envVar.shadowedValues ? chalk.yellow(' (shadowed)') : '';
        console.log(`  ${name}=${envVar.value}  ${chalk.gray(`← ${envVar.origin}`)}${shadowTag}`);
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
      for (const server of resolved.mcpServers.effective) {
        const status = server.enabled ? chalk.green('enabled') : chalk.red('disabled');
        console.log(`  ${server.name}: ${status}  ${chalk.gray(`← ${server.origin}`)}`);
        if (server.conflicts && server.conflicts.length > 0) {
          for (const c of server.conflicts) {
            const cStatus = c.enabled ? 'enabled' : 'disabled';
            console.log(chalk.yellow(`    conflict: ${cStatus} at ${c.origin}`));
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
    console.log(`  Default: ${resolved.model.effectiveModel.value}  ${chalk.gray(`← ${resolved.model.effectiveModel.origin}`)}`);
    if (resolved.model.subagentModel) {
      console.log(`  Subagent: ${resolved.model.subagentModel.value}  ${chalk.gray(`← ${resolved.model.subagentModel.origin}`)}`);
    }
    if (resolved.model.haikuModel) {
      console.log(`  Haiku: ${resolved.model.haikuModel.value}  ${chalk.gray(`← ${resolved.model.haikuModel.origin}`)}`);
    }
    if (resolved.model.opusModel) {
      console.log(`  Opus: ${resolved.model.opusModel.value}  ${chalk.gray(`← ${resolved.model.opusModel.origin}`)}`);
    }
    console.log();
  }

  if (sections.sandbox) {
    console.log(chalk.bold.underline('Sandbox'));
    const sandboxStatus = resolved.sandbox.enabled.value ? chalk.green('enabled') : chalk.yellow('disabled');
    console.log(`  Sandbox: ${sandboxStatus}  ${chalk.gray(`← ${resolved.sandbox.enabled.origin}`)}`);
    if (resolved.sandbox.autoAllowBashIfSandboxed) {
      console.log(`  Auto-allow Bash: ${resolved.sandbox.autoAllowBashIfSandboxed.value}  ${chalk.gray(`← ${resolved.sandbox.autoAllowBashIfSandboxed.origin}`)}`);
    }
    if (resolved.sandbox.excludedCommands) {
      console.log(`  Excluded commands: ${resolved.sandbox.excludedCommands.value.join(', ')}  ${chalk.gray(`← ${resolved.sandbox.excludedCommands.origin}`)}`);
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

  // Summary table
  const colWidth = 30;
  const header = '  ' + 'Metric'.padEnd(20) + results.map((r) => r.dir.padEnd(colWidth)).join('');
  console.log(chalk.bold(header));
  console.log(chalk.gray('  ' + '-'.repeat(20 + results.length * colWidth)));

  // Total files
  console.log(
    '  ' + 'Total files'.padEnd(20) + results.map((r) => String(r.totalFiles).padEnd(colWidth)).join(''),
  );

  // Startup tokens
  console.log(
    '  ' + 'Startup tokens'.padEnd(20) + results.map((r) => formatTokens(r.totalStartupTokens).padEnd(colWidth)).join(''),
  );

  // Permission counts
  console.log(
    '  ' + 'Allow rules'.padEnd(20) + results.map((r) => String(r.resolved.permissions.effectiveAllow.length).padEnd(colWidth)).join(''),
  );
  console.log(
    '  ' + 'Deny rules'.padEnd(20) + results.map((r) => String(r.resolved.permissions.effectiveDeny.length).padEnd(colWidth)).join(''),
  );

  // MCP servers
  console.log(
    '  ' + 'MCP servers'.padEnd(20) + results.map((r) => String(r.resolved.mcpServers.effective.length).padEnd(colWidth)).join(''),
  );

  // Env vars
  console.log(
    '  ' + 'Env variables'.padEnd(20) + results.map((r) => String(r.resolved.environment.effective.size).padEnd(colWidth)).join(''),
  );

  // Model
  console.log(
    '  ' + 'Model'.padEnd(20) + results.map((r) => r.resolved.model.effectiveModel.value.padEnd(colWidth)).join(''),
  );

  // Sandbox
  console.log(
    '  ' + 'Sandbox'.padEnd(20) + results.map((r) => (r.resolved.sandbox.enabled.value ? 'enabled' : 'disabled').padEnd(colWidth)).join(''),
  );

  // Conflicts
  const conflictCounts = results.map(
    (r) => r.resolved.permissions.conflicts.length + r.resolved.mcpServers.conflicts.length,
  );
  console.log(
    '  ' + 'Conflicts'.padEnd(20) + conflictCounts.map((c) => (c > 0 ? chalk.red(String(c)) : chalk.green('0')).padEnd(colWidth)).join(''),
  );

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
