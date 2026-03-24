import type { Command } from 'commander';
import { resolve as resolvePath, join } from 'path';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import chalk from 'chalk';

const MCP_SERVER_KEY = 'ccinspect';
const CLAUDE_MCP_ARGS = ['mcp', 'add', '--scope', 'user', MCP_SERVER_KEY, '--', 'npx', '-y', 'ccinspect', 'mcp', 'serve'];

interface McpJsonContent {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

function getMcpJsonPath(projectDir: string): string {
  return join(projectDir, '.mcp.json');
}

function readMcpJson(mcpPath: string): McpJsonContent | null {
  if (!existsSync(mcpPath)) return null;
  try {
    return JSON.parse(readFileSync(mcpPath, 'utf-8')) as McpJsonContent;
  } catch {
    return null;
  }
}

function getCcinspectServerEntry(): Record<string, unknown> {
  return {
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'ccinspect', 'mcp', 'serve'],
  };
}

function isRegisteredInMcpJson(data: McpJsonContent | null): boolean {
  return data?.mcpServers != null && MCP_SERVER_KEY in data.mcpServers;
}

function isClaudeCliAvailable(): boolean {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    execSync('claude --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function isRegisteredGlobally(): boolean {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    const output = execSync('claude mcp list', { stdio: 'pipe', encoding: 'utf-8' });
    return output.includes(MCP_SERVER_KEY);
  } catch {
    return false;
  }
}

export function registerSetupCommand(program: Command): void {
  const setup = program
    .command('setup')
    .description('Register ccinspect MCP server with Claude Code')
    .option('--global', 'Register globally via claude CLI (default)')
    .option('--project', 'Register in project .mcp.json')
    .option('--uninstall', 'Remove MCP server registration')
    .option('--status', 'Show current integration status')
    .action((_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const projectDir = resolvePath(
        (globalOpts.projectDir as string | undefined) || process.cwd(),
      );

      if (_options.uninstall) {
        runUninstall(projectDir);
      } else if (_options.status) {
        runStatus(projectDir);
      } else if (_options.project) {
        runProjectInstall(projectDir);
      } else {
        runGlobalInstall();
      }
    });

  setup.allowUnknownOption(false);
}

function runGlobalInstall(): void {
  if (!isClaudeCliAvailable()) {
    console.log();
    console.log(chalk.yellow('Claude Code CLI not found.') + ' Add manually:');
    console.log();
    console.log('  ' + chalk.cyan(`claude ${CLAUDE_MCP_ARGS.join(' ')}`));
    console.log();
    return;
  }

  if (isRegisteredGlobally()) {
    console.log(chalk.yellow('ccinspect MCP server is already registered globally.'));
    console.log(chalk.dim('Run cci setup --status to see details.'));
    return;
  }

  try {
    execSync(`claude ${CLAUDE_MCP_ARGS.join(' ')}`, { stdio: 'pipe' });
  } catch (err) {
    console.log(chalk.red('Failed to register MCP server:'), (err as Error).message);
    console.log();
    console.log('Try manually:');
    console.log('  ' + chalk.cyan(`claude ${CLAUDE_MCP_ARGS.join(' ')}`));
    console.log();
    return;
  }

  console.log();
  console.log(chalk.green('✓') + ' ccinspect MCP server registered globally.');
  console.log();
  console.log('  Restart Claude Code to connect.');
  console.log('  Run ' + chalk.cyan('/mcp') + ' in Claude Code to verify.');
  console.log();
}

function runProjectInstall(projectDir: string): void {
  const mcpPath = getMcpJsonPath(projectDir);
  const existing = readMcpJson(mcpPath);

  if (existing && isRegisteredInMcpJson(existing)) {
    console.log(chalk.yellow('ccinspect MCP server is already registered in .mcp.json'));
    console.log(chalk.dim('Run cci setup --status to see details.'));
    return;
  }

  const data: McpJsonContent = existing ?? {};
  if (!data.mcpServers) {
    data.mcpServers = {};
  }
  data.mcpServers[MCP_SERVER_KEY] = getCcinspectServerEntry();

  writeFileSync(mcpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');

  console.log();
  console.log(chalk.green('✓') + ' ccinspect MCP server registered in .mcp.json');
  console.log();
  console.log('  Restart Claude Code to connect.');
  console.log('  Run ' + chalk.cyan('/mcp') + ' in Claude Code to verify.');
  console.log();

  // Check if .mcp.json is gitignored
  const gitignorePath = join(projectDir, '.gitignore');
  if (existsSync(gitignorePath)) {
    const gitignore = readFileSync(gitignorePath, 'utf-8');
    if (!gitignore.includes('.mcp.json')) {
      console.log(
        chalk.dim('Tip: .mcp.json is not in .gitignore. Consider adding it if it contains project-specific paths.'),
      );
    }
  }
}

function runUninstall(projectDir: string): void {
  let removedGlobal = false;
  let removedProject = false;

  // Try global removal
  if (isClaudeCliAvailable()) {
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      execSync('claude mcp remove ccinspect', { stdio: 'pipe' });
      removedGlobal = true;
    } catch {
      // Not registered globally, or command failed
    }
  }

  // Try project removal
  const mcpPath = getMcpJsonPath(projectDir);
  const existing = readMcpJson(mcpPath);

  if (existing && isRegisteredInMcpJson(existing)) {
    delete existing.mcpServers![MCP_SERVER_KEY];

    const remainingServers = Object.keys(existing.mcpServers!).length;
    const otherKeys = Object.keys(existing).filter(k => k !== 'mcpServers').length;

    if (remainingServers === 0 && otherKeys === 0) {
      unlinkSync(mcpPath);
    } else {
      writeFileSync(mcpPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
    }
    removedProject = true;
  }

  if (removedGlobal && removedProject) {
    console.log(chalk.green('✓') + ' Removed ccinspect MCP server from global and .mcp.json');
  } else if (removedGlobal) {
    console.log(chalk.green('✓') + ' Removed ccinspect MCP server globally');
  } else if (removedProject) {
    console.log(chalk.green('✓') + ' Removed ccinspect MCP server from .mcp.json');
  } else {
    console.log(chalk.yellow('ccinspect MCP server is not registered'));
  }
}

function runStatus(projectDir: string): void {
  const mcpPath = getMcpJsonPath(projectDir);
  const existing = readMcpJson(mcpPath);

  console.log();
  console.log(chalk.bold('ccinspect MCP Integration Status'));
  console.log();

  // Global status
  const claudeAvailable = isClaudeCliAvailable();
  if (claudeAvailable) {
    const globalRegistered = isRegisteredGlobally();
    console.log('  Global:       ' + (globalRegistered ? chalk.green('registered') : chalk.yellow('not registered')));
  } else {
    console.log('  Global:       ' + chalk.dim('claude CLI not available'));
  }

  // Project status
  if (!existsSync(mcpPath)) {
    console.log('  Project:      ' + chalk.yellow('no .mcp.json'));
  } else if (!existing) {
    console.log('  Project:      ' + chalk.red('.mcp.json invalid'));
  } else if (isRegisteredInMcpJson(existing)) {
    const entry = existing.mcpServers![MCP_SERVER_KEY] as Record<string, unknown>;
    console.log('  Project:      ' + chalk.green('registered in .mcp.json'));
    console.log('  Command:      ' + chalk.dim(
      `${entry.command} ${(entry.args as string[] || []).join(' ')}`,
    ));
  } else {
    console.log('  Project:      ' + chalk.yellow('not registered in .mcp.json'));
  }

  // Show ccinspect version
  try {
    const pkgPath = resolvePath(__dirname, '..', '..', '..', 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      console.log('  Version:      ' + chalk.dim(pkg.version));
    }
  } catch {
    // Ignore version read errors
  }

  console.log();

  const projectRegistered = isRegisteredInMcpJson(existing);
  const globalRegistered = claudeAvailable && isRegisteredGlobally();
  if (!projectRegistered && !globalRegistered) {
    console.log(chalk.dim('  Run cci setup to register globally, or cci setup --project for project scope.'));
    console.log();
  }
}
