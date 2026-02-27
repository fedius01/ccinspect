import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import type { RuntimeInfo, AuthMethod } from '../types/index.js';
import {
  detectOs,
  getManagedSettingsPath,
  getManagedMcpPath,
  getPreferencesPath,
  pathExists,
} from '../utils/os-paths.js';

function getClaudeVersion(): { version: string; installPath: string } {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    const version = execSync('claude --version', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    let installPath = 'unknown';
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      installPath = execSync('which claude', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      // ignore
    }

    return { version, installPath };
  } catch {
    return { version: 'not installed', installPath: 'N/A' };
  }
}

async function getLatestVersion(): Promise<string | null> {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    const result = execSync('npm view @anthropic-ai/claude-code version 2>/dev/null', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}

function getAuthMethod(): { method: AuthMethod; org: string | null } {
  const prefsPath = getPreferencesPath();
  if (!pathExists(prefsPath)) {
    return { method: 'unknown', org: null };
  }

  try {
    const content = readFileSync(prefsPath, 'utf-8');
    const prefs = JSON.parse(content) as Record<string, unknown>;

    // Check environment variable overrides first
    if (process.env.ANTHROPIC_API_KEY) return { method: 'api-key', org: null };
    if (process.env.CLAUDE_CODE_USE_BEDROCK === '1') return { method: 'bedrock', org: null };
    if (process.env.CLAUDE_CODE_USE_VERTEX === '1') return { method: 'vertex', org: null };

    // Check preferences
    if (prefs.oauthAccount) return { method: 'claudeai', org: (prefs.oauthAccount as Record<string, string>)?.organizationName ?? null };
    if (prefs.apiKey) return { method: 'api-key', org: null };

    return { method: 'unknown', org: null };
  } catch {
    return { method: 'unknown', org: null };
  }
}

function getModelConfig(): {
  default: string;
  sonnet: string | null;
  haiku: string | null;
  opus: string | null;
  subagent: string | null;
  sources: Record<string, string>;
} {
  const sources: Record<string, string> = {};

  // Environment variable takes precedence
  const envModel = process.env.ANTHROPIC_MODEL || process.env.CLAUDE_CODE_MODEL;
  const defaultModel = envModel || 'claude-sonnet-4-20250514';
  if (envModel) {
    sources['default'] = 'env:ANTHROPIC_MODEL';
  }

  const sonnet = process.env.CLAUDE_CODE_SONNET_MODEL || null;
  if (sonnet) sources['sonnet'] = 'env:CLAUDE_CODE_SONNET_MODEL';

  const haiku = process.env.CLAUDE_CODE_HAIKU_MODEL || null;
  if (haiku) sources['haiku'] = 'env:CLAUDE_CODE_HAIKU_MODEL';

  const opus = process.env.CLAUDE_CODE_OPUS_MODEL || null;
  if (opus) sources['opus'] = 'env:CLAUDE_CODE_OPUS_MODEL';

  const subagent = process.env.CLAUDE_CODE_SUBAGENT_MODEL || null;
  if (subagent) sources['subagent'] = 'env:CLAUDE_CODE_SUBAGENT_MODEL';

  return { default: defaultModel, sonnet, haiku, opus, subagent, sources };
}

export async function gatherRuntimeInfo(): Promise<RuntimeInfo> {
  const { version, installPath } = getClaudeVersion();
  const latestVersion = await getLatestVersion();
  const auth = getAuthMethod();
  const model = getModelConfig();
  const os = detectOs();
  const managedPolicyPath = getManagedSettingsPath();
  const managedMcpPath = getManagedMcpPath();

  return {
    cli: {
      version,
      latestVersion,
      updateAvailable: latestVersion !== null && version !== 'not installed' && !version.includes(latestVersion),
      installPath,
      nodeVersion: process.version,
    },
    auth,
    model,
    system: {
      os,
      managedPolicyPath,
      managedPolicyExists: pathExists(managedPolicyPath),
      managedMcpPath,
      managedMcpExists: pathExists(managedMcpPath),
    },
  };
}
