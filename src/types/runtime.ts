export type AuthMethod =
  | 'claudeai'
  | 'console'
  | 'api-key'
  | 'bedrock'
  | 'vertex'
  | 'foundry'
  | 'unknown';

export type OsType = 'macos' | 'linux' | 'windows-wsl' | 'windows';

export interface RuntimeInfo {
  cli: {
    version: string;
    latestVersion: string | null;
    updateAvailable: boolean;
    installPath: string;
    nodeVersion: string;
  };
  auth: {
    method: AuthMethod;
    org: string | null;
  };
  model: {
    default: string;
    sonnet: string | null;
    haiku: string | null;
    opus: string | null;
    subagent: string | null;
    sources: Record<string, string>;
  };
  system: {
    os: OsType;
    managedPolicyPath: string;
    managedPolicyExists: boolean;
    managedMcpPath: string;
    managedMcpExists: boolean;
  };
}
