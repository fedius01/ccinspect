import type { PluginInfo } from './inventory.js';

export interface OriginTracked<T> {
  value: T;
  origin: string;
  overriddenBy?: string[];
}

export interface PermissionRule {
  pattern: string;
  action: 'allow' | 'deny' | 'ask';
  origin: string;
}

export interface PermissionConflict {
  pattern: string;
  rules: PermissionRule[];
  resolution: 'allow' | 'deny' | 'ask';
  explanation: string;
}

export interface PermissionRedundancy {
  narrow: PermissionRule;
  broad: PermissionRule;
  explanation: string;
}

export interface EnvVariable {
  name: string;
  value: string;
  origin: string;
  shadowedValues?: Array<{ value: string; origin: string }>;
}

export interface McpServerResolved {
  name: string;
  enabled: boolean;
  origin: string;
  config: Record<string, unknown>;
  conflicts?: Array<{ enabled: boolean; origin: string }>;
}

export interface ResolvedConfig {
  permissions: {
    effectiveAllow: PermissionRule[];
    effectiveDeny: PermissionRule[];
    effectiveAsk: PermissionRule[];
    conflicts: PermissionConflict[];
    redundancies: PermissionRedundancy[];
  };

  environment: {
    effective: Map<string, EnvVariable>;
    shadows: EnvVariable[];
  };

  mcpServers: {
    effective: McpServerResolved[];
    conflicts: McpServerResolved[];
  };

  model: {
    effectiveModel: OriginTracked<string>;
    subagentModel: OriginTracked<string> | null;
    haikuModel: OriginTracked<string> | null;
    opusModel: OriginTracked<string> | null;
  };

  sandbox: {
    enabled: OriginTracked<boolean>;
    autoAllowBashIfSandboxed: OriginTracked<boolean> | null;
    excludedCommands: OriginTracked<string[]> | null;
    networkConfig: Record<string, unknown>;
  };

  plugins: {
    effective: PluginInfo[];
    conflicts: PluginInfo[];
  };
}
