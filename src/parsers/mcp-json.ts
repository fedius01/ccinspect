import { readFileSync } from 'fs';

export interface ParsedMcpServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  disabled?: boolean;
}

export interface ParsedMcpConfig {
  servers: ParsedMcpServer[];
  source: string;
}

export function parseMcpJson(filePath: string, source: string): ParsedMcpConfig | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const raw = JSON.parse(content) as Record<string, unknown>;

    const mcpServers = raw.mcpServers as Record<string, unknown> | undefined;
    if (!mcpServers || typeof mcpServers !== 'object') {
      return { servers: [], source };
    }

    const servers: ParsedMcpServer[] = [];
    for (const [name, config] of Object.entries(mcpServers)) {
      const serverConfig = config as Record<string, unknown>;
      servers.push({
        name,
        command: (serverConfig.command as string) || '',
        args: Array.isArray(serverConfig.args) ? (serverConfig.args as string[]) : [],
        env: (serverConfig.env as Record<string, string>) || {},
        disabled: serverConfig.disabled as boolean | undefined,
      });
    }

    return { servers, source };
  } catch {
    return null;
  }
}
