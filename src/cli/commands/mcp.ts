import type { Command } from 'commander';

export function registerMcpCommand(program: Command): void {
  const mcp = program
    .command('mcp')
    .description('MCP server for Claude Code integration');

  mcp
    .command('serve')
    .description('Start MCP server (stdio transport)')
    .action(async () => {
      // Dynamic import to avoid loading MCP SDK unless needed
      const { startServer } = await import('../../mcp/server.js');
      await startServer();
    });
}
