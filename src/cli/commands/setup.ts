import type { Command } from 'commander';
import { resolve as resolvePath, join } from 'path';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import chalk from 'chalk';

const MCP_SERVER_KEY = 'ccinspect';

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

function isRegistered(data: McpJsonContent | null): boolean {
  return data?.mcpServers != null && MCP_SERVER_KEY in data.mcpServers;
}

export function registerSetupCommand(program: Command): void {
  const setup = program
    .command('setup')
    .description('Register ccinspect MCP server with Claude Code')
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
      } else {
        runInstall(projectDir);
      }
    });

  // Prevent commander from treating --status/--uninstall subcommands
  setup.allowUnknownOption(false);
}

function runInstall(projectDir: string): void {
  const mcpPath = getMcpJsonPath(projectDir);
  const existing = readMcpJson(mcpPath);

  if (existing && isRegistered(existing)) {
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
  const mcpPath = getMcpJsonPath(projectDir);
  const existing = readMcpJson(mcpPath);

  if (!existing || !isRegistered(existing)) {
    console.log(chalk.yellow('ccinspect MCP server is not registered in .mcp.json'));
    return;
  }

  delete existing.mcpServers![MCP_SERVER_KEY];

  // If mcpServers is now empty and there are no other top-level keys, delete the file
  const remainingServers = Object.keys(existing.mcpServers!).length;
  const otherKeys = Object.keys(existing).filter(k => k !== 'mcpServers').length;

  if (remainingServers === 0 && otherKeys === 0) {
    unlinkSync(mcpPath);
    console.log(chalk.green('✓') + ' Removed ccinspect MCP server and deleted empty .mcp.json');
  } else {
    writeFileSync(mcpPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
    console.log(chalk.green('✓') + ' Removed ccinspect MCP server from .mcp.json');
  }
}

function runStatus(projectDir: string): void {
  const mcpPath = getMcpJsonPath(projectDir);
  const existing = readMcpJson(mcpPath);

  console.log();
  console.log(chalk.bold('ccinspect MCP Integration Status'));
  console.log();

  if (!existsSync(mcpPath)) {
    console.log('  .mcp.json:    ' + chalk.yellow('not found'));
    console.log('  Registration: ' + chalk.yellow('not registered'));
  } else if (!existing) {
    console.log('  .mcp.json:    ' + chalk.red('exists but invalid JSON'));
    console.log('  Registration: ' + chalk.yellow('not registered'));
  } else if (isRegistered(existing)) {
    const entry = existing.mcpServers![MCP_SERVER_KEY] as Record<string, unknown>;
    console.log('  .mcp.json:    ' + chalk.green('found'));
    console.log('  Registration: ' + chalk.green('registered'));
    console.log('  Command:      ' + chalk.dim(
      `${entry.command} ${(entry.args as string[] || []).join(' ')}`,
    ));
  } else {
    console.log('  .mcp.json:    ' + chalk.green('found'));
    console.log('  Registration: ' + chalk.yellow('not registered'));
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
  if (!isRegistered(existing)) {
    console.log(chalk.dim('  Run cci setup to register.'));
    console.log();
  }
}
