import type {
  ConfigInventory,
  ResolvedConfig,
  PermissionRule,
  PermissionConflict,
  PermissionRedundancy,
  EnvVariable,
  McpServerResolved,
  OriginTracked,
  PluginInfo,
} from '../types/index.js';
import type { ParsedSettings } from '../parsers/settings-json.js';
import type { ParsedMcpConfig } from '../parsers/mcp-json.js';

export interface ParsedConfigLayers {
  userSettings: ParsedSettings | null;
  projectSettings: ParsedSettings | null;
  localSettings: ParsedSettings | null;
  managedSettings: ParsedSettings | null;
  cliOverrides?: ParsedSettings | null; // Phase 4 — reserved
  projectMcp: ParsedMcpConfig | null;
  managedMcp: ParsedMcpConfig | null;
}

interface LayerEntry {
  settings: ParsedSettings;
  origin: string;
}

/**
 * Layers ordered from highest to lowest precedence.
 * managed → cliOverrides → local → project → user
 */
function getOrderedLayers(inventory: ConfigInventory, layers: ParsedConfigLayers): LayerEntry[] {
  const ordered: LayerEntry[] = [];

  if (layers.managedSettings) {
    ordered.push({ settings: layers.managedSettings, origin: inventory.managedSettings?.path ?? 'managed-settings' });
  }
  if (layers.cliOverrides) {
    ordered.push({ settings: layers.cliOverrides, origin: 'cli-args' });
  }
  if (layers.localSettings) {
    ordered.push({ settings: layers.localSettings, origin: inventory.localSettings?.path ?? '.claude/settings.local.json' });
  }
  if (layers.projectSettings) {
    ordered.push({ settings: layers.projectSettings, origin: inventory.projectSettings?.path ?? '.claude/settings.json' });
  }
  if (layers.userSettings) {
    ordered.push({ settings: layers.userSettings, origin: inventory.userSettings?.path ?? '~/.claude/settings.json' });
  }

  return ordered;
}

// ------- Permissions -------

function resolvePermissions(orderedLayers: LayerEntry[]): ResolvedConfig['permissions'] {
  const effectiveAllow: PermissionRule[] = [];
  const effectiveDeny: PermissionRule[] = [];
  const effectiveAsk: PermissionRule[] = [];
  const conflicts: PermissionConflict[] = [];
  const redundancies: PermissionRedundancy[] = [];

  // Collect all rules from all layers with origin
  const allAllow: PermissionRule[] = [];
  const allDeny: PermissionRule[] = [];

  for (const layer of orderedLayers) {
    for (const pattern of layer.settings.permissions.allow) {
      allAllow.push({ pattern, action: 'allow', origin: layer.origin });
    }
    for (const pattern of layer.settings.permissions.deny) {
      allDeny.push({ pattern, action: 'deny', origin: layer.origin });
    }
  }

  // Detect cross-level conflicts: same pattern in allow at one level, deny at another
  const conflictDetected = new Set<string>();
  for (const allowRule of allAllow) {
    for (const denyRule of allDeny) {
      if (allowRule.pattern === denyRule.pattern && allowRule.origin !== denyRule.origin) {
        if (!conflictDetected.has(allowRule.pattern)) {
          conflictDetected.add(allowRule.pattern);
          // Higher precedence layer (earlier in ordered list) wins
          const allowIdx = orderedLayers.findIndex((l) => l.origin === allowRule.origin);
          const denyIdx = orderedLayers.findIndex((l) => l.origin === denyRule.origin);
          const winner = allowIdx < denyIdx ? allowRule : denyRule;
          conflicts.push({
            pattern: allowRule.pattern,
            rules: [denyRule, allowRule],
            resolution: winner.action,
            explanation: `"${allowRule.pattern}" is ${winner.action}ed at ${winner.origin} (higher precedence). Conflicting: allow at ${allowRule.origin}, deny at ${denyRule.origin}.`,
          });
        }
      }
    }
  }

  // Build effective sets — all unique patterns
  const seenAllow = new Set<string>();
  for (const rule of allAllow) {
    if (!seenAllow.has(rule.pattern)) {
      seenAllow.add(rule.pattern);
      effectiveAllow.push(rule);
    }
  }

  const seenDeny = new Set<string>();
  for (const rule of allDeny) {
    if (!seenDeny.has(rule.pattern)) {
      seenDeny.add(rule.pattern);
      effectiveDeny.push(rule);
    }
  }

  // Detect redundancies: narrow pattern covered by broader wildcard
  const allEffective = [...effectiveAllow, ...effectiveDeny];
  for (const narrow of allEffective) {
    for (const broad of allEffective) {
      if (narrow === broad) continue;
      if (narrow.action !== broad.action) continue;
      if (isSubsumedBy(narrow.pattern, broad.pattern)) {
        redundancies.push({
          narrow,
          broad,
          explanation: `"${narrow.pattern}" is redundant — already covered by broader rule "${broad.pattern}" from ${broad.origin}.`,
        });
      }
    }
  }

  return { effectiveAllow, effectiveDeny, effectiveAsk, conflicts, redundancies };
}

/**
 * Check if `narrow` pattern is subsumed by `broad` pattern.
 * Simple heuristic: if broad ends with * and narrow starts with the same prefix.
 */
function isSubsumedBy(narrow: string, broad: string): boolean {
  if (narrow === broad) return false;

  // Extract tool name and glob
  const narrowMatch = narrow.match(/^(\w+)\((.+)\)$/);
  const broadMatch = broad.match(/^(\w+)\((.+)\)$/);
  if (!narrowMatch || !broadMatch) return false;

  const [, narrowTool, narrowGlob] = narrowMatch;
  const [, broadTool, broadGlob] = broadMatch;

  if (narrowTool !== broadTool) return false;

  // Check if broad glob covers narrow glob
  if (broadGlob.endsWith('*')) {
    const prefix = broadGlob.slice(0, -1);
    return narrowGlob.startsWith(prefix);
  }

  // ** matches everything
  if (broadGlob === '**') return true;

  return false;
}

// ------- Environment -------

function resolveEnvironment(orderedLayers: LayerEntry[]): ResolvedConfig['environment'] {
  const effective = new Map<string, EnvVariable>();
  const shadows: EnvVariable[] = [];

  // Track all occurrences per variable
  const allOccurrences = new Map<string, Array<{ value: string; origin: string }>>();

  for (const layer of orderedLayers) {
    for (const [name, value] of Object.entries(layer.settings.env)) {
      if (!allOccurrences.has(name)) {
        allOccurrences.set(name, []);
      }
      allOccurrences.get(name)!.push({ value, origin: layer.origin });
    }
  }

  for (const [name, occurrences] of allOccurrences) {
    // First occurrence is highest precedence
    const winner = occurrences[0];
    const shadowedValues = occurrences.length > 1 ? occurrences.slice(1) : undefined;

    const envVar: EnvVariable = {
      name,
      value: winner.value,
      origin: winner.origin,
      shadowedValues,
    };

    effective.set(name, envVar);

    if (shadowedValues && shadowedValues.length > 0) {
      shadows.push(envVar);
    }
  }

  return { effective, shadows };
}

// ------- MCP Servers -------

function resolveMcpServers(layers: ParsedConfigLayers): ResolvedConfig['mcpServers'] {
  const effective: McpServerResolved[] = [];
  const conflicts: McpServerResolved[] = [];

  // Managed MCP has higher precedence than project MCP
  const managedServers = layers.managedMcp?.servers ?? [];
  const projectServers = layers.projectMcp?.servers ?? [];

  const managedOrigin = layers.managedMcp?.source ?? 'managed-mcp.json';
  const projectOrigin = layers.projectMcp?.source ?? '.mcp.json';

  const managedByName = new Map(managedServers.map((s) => [s.name, s]));
  const projectByName = new Map(projectServers.map((s) => [s.name, s]));

  // Process managed servers (highest precedence)
  for (const server of managedServers) {
    const projectVersion = projectByName.get(server.name);
    const effectiveServer: McpServerResolved = {
      name: server.name,
      enabled: !server.disabled,
      origin: managedOrigin,
      config: { command: server.command, args: server.args, env: server.env },
    };

    if (projectVersion) {
      const projectEnabled = !projectVersion.disabled;
      if (projectEnabled !== effectiveServer.enabled) {
        effectiveServer.conflicts = [{ enabled: projectEnabled, origin: projectOrigin }];
        conflicts.push(effectiveServer);
      }
    }

    effective.push(effectiveServer);
  }

  // Process project servers not in managed
  for (const server of projectServers) {
    if (managedByName.has(server.name)) continue; // already processed
    effective.push({
      name: server.name,
      enabled: !server.disabled,
      origin: projectOrigin,
      config: { command: server.command, args: server.args, env: server.env },
    });
  }

  return { effective, conflicts };
}

// ------- Model -------

function resolveModel(orderedLayers: LayerEntry[]): ResolvedConfig['model'] {
  const defaultModel = 'claude-sonnet-4-20250514';

  // Check env vars first (highest precedence for model)
  const envModel = process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL;
  const envSubagent = process.env.CLAUDE_CODE_SUBAGENT_MODEL;
  const envHaiku = process.env.CLAUDE_CODE_HAIKU_MODEL;
  const envOpus = process.env.CLAUDE_CODE_OPUS_MODEL;

  let effectiveModel: OriginTracked<string> = { value: defaultModel, origin: 'default' };

  if (envModel) {
    effectiveModel = { value: envModel, origin: 'env:ANTHROPIC_MODEL' };
  } else {
    // Check settings layers
    for (const layer of orderedLayers) {
      if (layer.settings.model) {
        effectiveModel = { value: layer.settings.model, origin: layer.origin };
        break;
      }
    }
  }

  const subagentModel = envSubagent ? { value: envSubagent, origin: 'env:CLAUDE_CODE_SUBAGENT_MODEL' } : null;
  const haikuModel = envHaiku ? { value: envHaiku, origin: 'env:CLAUDE_CODE_HAIKU_MODEL' } : null;
  const opusModel = envOpus ? { value: envOpus, origin: 'env:CLAUDE_CODE_OPUS_MODEL' } : null;

  return { effectiveModel, subagentModel, haikuModel, opusModel };
}

// ------- Sandbox -------

function resolveSandbox(orderedLayers: LayerEntry[]): ResolvedConfig['sandbox'] {
  let enabled: OriginTracked<boolean> = { value: false, origin: 'default' };
  let autoAllowBashIfSandboxed: OriginTracked<boolean> | null = null;
  let excludedCommands: OriginTracked<string[]> | null = null;
  let networkConfig: Record<string, unknown> = {};

  for (const layer of orderedLayers) {
    const sb = layer.settings.sandbox;

    if (sb.enabled !== undefined && enabled.origin === 'default') {
      enabled = { value: sb.enabled, origin: layer.origin };
    }

    if (sb.autoAllowBashIfSandboxed !== undefined && !autoAllowBashIfSandboxed) {
      autoAllowBashIfSandboxed = { value: sb.autoAllowBashIfSandboxed, origin: layer.origin };
    }

    if (sb.excludedCommands !== undefined && !excludedCommands) {
      excludedCommands = { value: sb.excludedCommands, origin: layer.origin };
    }

    if (sb.network && Object.keys(networkConfig).length === 0) {
      networkConfig = sb.network;
    }
  }

  return { enabled, autoAllowBashIfSandboxed, excludedCommands, networkConfig };
}

// ------- Plugins -------

function resolvePlugins(orderedLayers: LayerEntry[]): ResolvedConfig['plugins'] {
  const effective: PluginInfo[] = [];
  const conflicts: PluginInfo[] = [];

  // Collect all plugin states from all layers
  const pluginStates = new Map<string, Array<{ enabled: boolean; origin: string }>>();

  for (const layer of orderedLayers) {
    const enabledPlugins = layer.settings.plugins.enabledPlugins;
    if (!enabledPlugins) continue;

    for (const [id, enabled] of Object.entries(enabledPlugins)) {
      if (!pluginStates.has(id)) {
        pluginStates.set(id, []);
      }
      pluginStates.get(id)!.push({ enabled, origin: layer.origin });
    }
  }

  for (const [id, states] of pluginStates) {
    // First state is highest precedence
    const winner = states[0];
    const plugin: PluginInfo = {
      id,
      enabled: winner.enabled,
      source: winner.origin,
    };

    // Check for conflicts
    const conflictingSources = states
      .slice(1)
      .filter((s) => s.enabled !== winner.enabled)
      .map((s) => s.origin);

    if (conflictingSources.length > 0) {
      plugin.conflicts = conflictingSources;
      conflicts.push(plugin);
    }

    effective.push(plugin);
  }

  return { effective, conflicts };
}

// ------- Main Resolve -------

export function resolve(inventory: ConfigInventory, layers?: ParsedConfigLayers): ResolvedConfig {
  // Backward compat: if no layers provided, return minimal defaults (Phase 1 behavior)
  if (!layers) {
    return {
      permissions: {
        effectiveAllow: [],
        effectiveDeny: [],
        effectiveAsk: [],
        conflicts: [],
        redundancies: [],
      },
      environment: { effective: new Map(), shadows: [] },
      mcpServers: { effective: [], conflicts: [] },
      model: {
        effectiveModel: { value: 'claude-sonnet-4-20250514', origin: 'default' },
        subagentModel: null,
        haikuModel: null,
        opusModel: null,
      },
      sandbox: {
        enabled: { value: false, origin: 'default' },
        autoAllowBashIfSandboxed: null,
        excludedCommands: null,
        networkConfig: {},
      },
      plugins: { effective: [], conflicts: [] },
    };
  }

  const orderedLayers = getOrderedLayers(inventory, layers);

  return {
    permissions: resolvePermissions(orderedLayers),
    environment: resolveEnvironment(orderedLayers),
    mcpServers: resolveMcpServers(layers),
    model: resolveModel(orderedLayers),
    sandbox: resolveSandbox(orderedLayers),
    plugins: resolvePlugins(orderedLayers),
  };
}
