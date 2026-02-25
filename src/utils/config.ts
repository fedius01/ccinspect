import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getHomeDir } from './os-paths.js';
import type { Severity, LintConfig } from '../types/index.js';

export interface RuleOptions {
  enabled: boolean;
  severity?: Severity;
  [key: string]: unknown;
}

export interface CcinspectConfig {
  rules: Record<string, RuleOptions>;
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    // Malformed JSON — warn to stderr and skip
    console.error(`Warning: Could not parse ${filePath}, skipping`);
    return null;
  }
}

function normalizeRuleConfig(value: unknown): RuleOptions {
  if (value === true) {
    return { enabled: true };
  }
  if (value === false) {
    return { enabled: false };
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    return {
      enabled: obj.enabled !== false, // default to true if not explicitly false
      ...obj,
    };
  }
  // Unknown value type — treat as enabled with defaults
  return { enabled: true };
}

function deepMergeRules(
  user: Record<string, unknown>,
  project: Record<string, unknown>,
): Record<string, RuleOptions> {
  const result: Record<string, RuleOptions> = {};

  // Process all rule IDs from both sources
  const allRuleIds = new Set([...Object.keys(user), ...Object.keys(project)]);

  for (const ruleId of allRuleIds) {
    const userVal = user[ruleId];
    const projectVal = project[ruleId];

    if (projectVal !== undefined && userVal !== undefined) {
      // Both exist — project overrides user at field level
      const userNorm = normalizeRuleConfig(userVal);
      const projectNorm = normalizeRuleConfig(projectVal);
      result[ruleId] = { ...userNorm, ...projectNorm };
    } else if (projectVal !== undefined) {
      result[ruleId] = normalizeRuleConfig(projectVal);
    } else if (userVal !== undefined) {
      result[ruleId] = normalizeRuleConfig(userVal);
    }
  }

  return result;
}

export function loadConfig(projectRoot: string): CcinspectConfig {
  const projectConfigPath = join(projectRoot, '.ccinspect.json');
  const userConfigPath = join(getHomeDir(), '.ccinspect.json');

  const projectRaw = readJsonFile(projectConfigPath);
  const userRaw = readJsonFile(userConfigPath);

  const projectRules = (projectRaw?.rules as Record<string, unknown>) || {};
  const userRules = (userRaw?.rules as Record<string, unknown>) || {};

  const rules = deepMergeRules(userRules, projectRules);

  return { rules };
}

/**
 * Convert CcinspectConfig to the LintConfig format expected by the Linter.
 */
export function toLintConfig(config: CcinspectConfig): LintConfig {
  const rules: Record<string, boolean | Record<string, unknown>> = {};

  for (const [ruleId, options] of Object.entries(config.rules)) {
    if (!options.enabled) {
      rules[ruleId] = false;
    } else {
      // Pass the full options object (severity, thresholds, etc.)
      const { enabled: _enabled, ...rest } = options;
      if (Object.keys(rest).length > 0) {
        rules[ruleId] = rest;
      } else {
        rules[ruleId] = true;
      }
    }
  }

  return { rules };
}
