import type { ConfigInventory, ResolvedConfig } from '../types/index.js';

/**
 * Phase 1 stub: returns a minimal ResolvedConfig.
 * Full precedence-based merging is implemented in Phase 2.
 */
export function resolve(_inventory: ConfigInventory): ResolvedConfig {
  return {
    permissions: {
      effectiveAllow: [],
      effectiveDeny: [],
      effectiveAsk: [],
      conflicts: [],
      redundancies: [],
    },
    environment: {
      effective: new Map(),
      shadows: [],
    },
    mcpServers: {
      effective: [],
      conflicts: [],
    },
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
    plugins: {
      effective: [],
      conflicts: [],
    },
  };
}
