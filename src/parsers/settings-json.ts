import { readFileSync } from 'fs';
import type { HookInfo, PluginInfo } from '../types/index.js';

export interface ParsedPermissions {
  allow: string[];
  deny: string[];
}

export interface ParsedSettings {
  permissions: ParsedPermissions;
  env: Record<string, string>;
  hooks: HookInfo[];
  sandbox: {
    enabled?: boolean;
    autoAllowBashIfSandboxed?: boolean;
    excludedCommands?: string[];
    network?: Record<string, unknown>;
  };
  plugins: {
    enabledPlugins?: Record<string, boolean>;
  };
  model?: string;
  raw: Record<string, unknown>;
}

export function parseSettingsJson(filePath: string, source: string): ParsedSettings | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const raw = JSON.parse(content) as Record<string, unknown>;

    // Permissions
    const permsRaw = raw.permissions as Record<string, unknown> | undefined;
    const allow = Array.isArray(permsRaw?.allow) ? (permsRaw.allow as string[]) : [];
    const deny = Array.isArray(permsRaw?.deny) ? (permsRaw.deny as string[]) : [];

    // Environment variables
    const envRaw = raw.env as Record<string, string> | undefined;
    const env = envRaw && typeof envRaw === 'object' ? envRaw : {};

    // Hooks
    const hooks: HookInfo[] = [];
    const hooksRaw = raw.hooks as Record<string, unknown[]> | undefined;
    if (hooksRaw && typeof hooksRaw === 'object') {
      for (const [event, hookList] of Object.entries(hooksRaw)) {
        if (!Array.isArray(hookList)) continue;
        for (const hookGroup of hookList) {
          const group = hookGroup as { matcher?: string; hooks?: Array<{ type?: string; command?: string }> };
          const matcher = group.matcher || '*';
          if (Array.isArray(group.hooks)) {
            for (const h of group.hooks) {
              hooks.push({
                event: event as HookInfo['event'],
                matcher,
                type: (h.type as 'command' | 'prompt') || 'command',
                command: h.command,
                source,
              });
            }
          }
        }
      }
    }

    // Sandbox
    const sandboxRaw = raw.sandbox as Record<string, unknown> | undefined;
    const sandbox = {
      enabled: sandboxRaw?.enabled as boolean | undefined,
      autoAllowBashIfSandboxed: sandboxRaw?.autoAllowBashIfSandboxed as boolean | undefined,
      excludedCommands: sandboxRaw?.excludedCommands as string[] | undefined,
      network: sandboxRaw?.network as Record<string, unknown> | undefined,
    };

    // Plugins
    const pluginsRaw = raw.plugins as Record<string, unknown> | undefined;
    const plugins = {
      enabledPlugins: pluginsRaw?.enabledPlugins as Record<string, boolean> | undefined,
    };

    // Model
    const model = raw.model as string | undefined;

    return {
      permissions: { allow, deny },
      env,
      hooks,
      sandbox,
      plugins,
      model,
      raw,
    };
  } catch {
    return null;
  }
}
