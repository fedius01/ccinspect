import { basename, dirname, relative } from 'path';
import picomatch from 'picomatch';
import type { ConfigInventory, FileInfo, RuleFileInfo } from '../types/inventory.js';
import type {
  AggregateStats,
  ConfigUtilization,
  ExtractedInstruction,
  FileActivity,
  RuleUtilization,
  TaskAttempt,
  ToolCall,
  UtilizationReport,
} from '../types/transcript.js';
import { parseMcpJson } from '../parsers/mcp-json.js';
import { parseRuleMd } from '../parsers/rules-md.js';
import { extractInstructions, checkCompliance } from './rule-compliance.js';

/** Append 's' for plural counts. */
function s(n: number): string {
  return n !== 1 ? 's' : '';
}

export interface UtilizationOptions {
  /** Number of days the analysis window covers (for display). */
  days: number;
}

/**
 * Cross-reference transcript aggregate stats against the config inventory
 * to produce a utilization report showing which components were exercised.
 */
export function produceUtilizationReport(
  inventory: ConfigInventory,
  stats: AggregateStats,
  options: UtilizationOptions,
): UtilizationReport {
  return {
    // Data quality — mirror from stats
    sessionsAnalyzed: stats.sessionsAnalyzed,
    sessionsExact: stats.sessionsExact,
    sessionsPartial: stats.sessionsPartial,
    sessionsDamaged: stats.sessionsDamaged,
    dateRange: stats.dateRange,
    days: options.days,

    // Per-surface utilization
    agents: buildAgentUtilization(inventory, stats),
    skills: buildSkillUtilization(inventory, stats),
    mcpServers: buildMcpUtilization(inventory, stats),
    commands: buildCommandUtilization(inventory, stats),
    rules: buildRulesUtilization(inventory, stats),
  };
}

// ---- Agents ----

function buildAgentUtilization(
  inventory: ConfigInventory,
  stats: AggregateStats,
): ConfigUtilization[] {
  const results: ConfigUtilization[] = [];

  // Build a lowercase map of ALL delegation records (including built-in types)
  const delegationMap = new Map<string, { count: number; sessionIds: string[] }>();
  for (const d of stats.delegations) {
    delegationMap.set(d.agentName.toLowerCase(), { count: d.count, sessionIds: d.sessionIds });
  }

  // Process configured agents — match against delegations regardless of built-in status.
  // If a user configures an agent named "explore.md", it takes precedence over the built-in.
  const seen = new Set<string>();
  const addAgents = (agents: FileInfo[], scope: string) => {
    for (const agent of agents) {
      const name = basename(agent.path, '.md');
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const delegation = delegationMap.get(key);
      results.push({
        name,
        configFile: agent.path,
        scope,
        used: delegation !== undefined,
        usageCount: delegation?.count ?? 0,
        sessionCount: delegation?.sessionIds.length ?? 0,
        sessionsAnalyzed: stats.sessionsAnalyzed,
        confidence: 'exact',
        details: delegation
          ? `${delegation.count} delegation${s(delegation.count)} across ${delegation.sessionIds.length} session${s(delegation.sessionIds.length)}`
          : undefined,
      });
    }
  };

  addAgents(inventory.projectAgents, 'project');
  addAgents(inventory.userAgents, 'user');
  addAgents(inventory.pluginAgents, 'plugin');

  return results;
}

// ---- Skills ----

/**
 * Extract skill name from a skill file path.
 * Skills live at `.claude/skills/<name>/SKILL.md` — the name comes from the parent directory.
 */
function extractSkillName(filePath: string): string {
  return basename(dirname(filePath));
}

function buildSkillUtilization(
  inventory: ConfigInventory,
  stats: AggregateStats,
): ConfigUtilization[] {
  const results: ConfigUtilization[] = [];

  // Build lowercase map of skill activations
  const activationMap = new Map<string, { total: number; sessionIds: string[] }>();
  for (const s of stats.skillActivations) {
    const key = s.skillName.toLowerCase();
    activationMap.set(key, {
      total: s.explicitCount + s.autoCount,
      sessionIds: s.sessionIds,
    });
  }

  const seen = new Set<string>();
  const addSkills = (skills: FileInfo[], scope: string) => {
    for (const skill of skills) {
      const name = extractSkillName(skill.path);
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const activation = activationMap.get(key);
      results.push({
        name,
        configFile: skill.path,
        scope,
        used: activation !== undefined,
        usageCount: activation?.total ?? 0,
        sessionCount: activation?.sessionIds.length ?? 0,
        sessionsAnalyzed: stats.sessionsAnalyzed,
        confidence: 'exact',
        details: activation
          ? `${activation.total} activation${s(activation.total)} across ${activation.sessionIds.length} session${s(activation.sessionIds.length)}`
          : undefined,
      });
    }
  };

  addSkills(inventory.projectSkills, 'project');
  addSkills(inventory.userSkills, 'user');

  return results;
}

// ---- MCP Servers ----

function buildMcpUtilization(
  inventory: ConfigInventory,
  stats: AggregateStats,
): ConfigUtilization[] {
  const results: ConfigUtilization[] = [];

  // Extract configured MCP server names from .mcp.json
  const configuredServers = new Map<string, { name: string; configFile: string; scope: string }>();

  if (inventory.projectMcp?.exists) {
    const parsed = parseMcpJson(inventory.projectMcp.path, 'project');
    if (parsed) {
      for (const server of parsed.servers) {
        configuredServers.set(server.name.toLowerCase(), {
          name: server.name,
          configFile: inventory.projectMcp.path,
          scope: 'project',
        });
      }
    }
  }

  if (inventory.managedMcp?.exists) {
    const parsed = parseMcpJson(inventory.managedMcp.path, 'enterprise');
    if (parsed) {
      for (const server of parsed.servers) {
        const key = server.name.toLowerCase();
        if (!configuredServers.has(key)) {
          configuredServers.set(key, {
            name: server.name,
            configFile: inventory.managedMcp.path,
            scope: 'enterprise',
          });
        }
      }
    }
  }

  // Extract MCP tool calls from tool distribution: mcp__<server>__<tool>
  const mcpUsage = new Map<string, number>();
  for (const [toolName, count] of stats.toolDistribution) {
    const match = toolName.match(/^mcp__([^_]+)__/);
    if (match) {
      const serverName = match[1].toLowerCase();
      mcpUsage.set(serverName, (mcpUsage.get(serverName) ?? 0) + count);
    }
  }

  // Build MCP session tracking from delegations is not available;
  // we can only report usage count, not session count, for MCP.
  // Session count requires per-session tool breakdown which AggregateStats doesn't provide.

  // Report configured servers with usage data
  for (const [key, config] of configuredServers) {
    const usage = mcpUsage.get(key) ?? 0;
    results.push({
      name: config.name,
      configFile: config.configFile,
      scope: config.scope,
      used: usage > 0,
      usageCount: usage,
      sessionCount: 0, // Not available from AggregateStats toolDistribution
      sessionsAnalyzed: stats.sessionsAnalyzed,
      confidence: 'exact',
      details: usage > 0 ? `${usage} tool call${s(usage)}` : undefined,
    });
    mcpUsage.delete(key);
  }

  // Report runtime-observed MCP servers not in config (ghost servers)
  for (const [serverKey, count] of mcpUsage) {
    results.push({
      name: serverKey,
      configFile: '',
      scope: 'unknown',
      used: true,
      usageCount: count,
      sessionCount: 0,
      sessionsAnalyzed: stats.sessionsAnalyzed,
      confidence: 'exact',
      details: `${count} tool call${s(count)} (not in current config)`,
    });
  }

  return results;
}

// ---- Commands ----

function buildCommandUtilization(
  inventory: ConfigInventory,
  stats: AggregateStats,
): ConfigUtilization[] {
  const results: ConfigUtilization[] = [];

  // Skill activations in the analyzer already capture /command patterns from user prompts.
  // Commands and skills share the same namespace — a /deploy could be either.
  // Build a lowercase map from skill activations.
  const activationMap = new Map<string, { total: number; sessionIds: string[] }>();
  for (const s of stats.skillActivations) {
    const key = s.skillName.toLowerCase();
    activationMap.set(key, {
      total: s.explicitCount + s.autoCount,
      sessionIds: s.sessionIds,
    });
  }

  const seen = new Set<string>();
  const addCommands = (commands: FileInfo[], scope: string) => {
    for (const cmd of commands) {
      const name = basename(cmd.path, '.md');
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const activation = activationMap.get(key);
      results.push({
        name,
        configFile: cmd.path,
        scope,
        used: activation !== undefined,
        usageCount: activation?.total ?? 0,
        sessionCount: activation?.sessionIds.length ?? 0,
        sessionsAnalyzed: stats.sessionsAnalyzed,
        confidence: 'exact',
        details: activation
          ? `${activation.total} invocation${s(activation.total)} across ${activation.sessionIds.length} session${s(activation.sessionIds.length)}`
          : undefined,
      });
    }
  };

  addCommands(inventory.projectCommands, 'project');
  addCommands(inventory.userCommands, 'user');

  return results;
}

// ---- Rules ----

/**
 * Extract globs from a rule file's frontmatter.
 * Returns null if the rule is unconditional (no paths:/globs: field).
 */
function extractRuleGlobs(rule: RuleFileInfo, projectRoot: string): string[] | null {
  const parsed = parseRuleMd(rule.path, projectRoot);
  if (!parsed || !parsed.hasFrontmatter) return null;

  const rawGlobs = parsed.frontmatter.globs ?? parsed.frontmatter.paths;
  if (!Array.isArray(rawGlobs) || rawGlobs.length === 0) return null;

  return rawGlobs.filter((g): g is string => typeof g === 'string');
}

/**
 * Normalize file activity keys to project-relative paths for glob matching.
 * File activity keys may be absolute paths.
 */
function normalizeFileActivityPaths(
  fileActivity: Map<string, FileActivity>,
  projectRoot: string,
): Map<string, FileActivity> {
  const normalized = new Map<string, FileActivity>();
  for (const [filePath, activity] of fileActivity) {
    const relPath = filePath.startsWith('/')
      ? relative(projectRoot, filePath)
      : filePath;
    normalized.set(relPath, activity);
  }
  return normalized;
}

function buildRulesUtilization(
  inventory: ConfigInventory,
  stats: AggregateStats,
): UtilizationReport['rules'] {
  const pathScoped: RuleUtilization[] = [];
  const unconditional: RuleUtilization[] = [];
  let totalUnconditionalTokens = 0;

  const projectRoot = inventory.projectRoot;
  const normalizedActivity = normalizeFileActivityPaths(stats.fileActivity, projectRoot);

  const processRules = (rules: RuleFileInfo[], scope: 'project' | 'user') => {
    for (const rule of rules) {
      const name = basename(rule.path);
      const globs = extractRuleGlobs(rule, projectRoot);

      if (globs === null) {
        // Unconditional rule — always loaded, report token cost + extract instructions
        const tokens = rule.estimatedTokens;
        totalUnconditionalTokens += tokens;

        // Extract testable instructions from rule body, then filter command-preference
        // extractions against actual Bash tool calls (CLI-grounded filtering).
        const parsed = parseRuleMd(rule.path, projectRoot);
        const rawInstructions = parsed ? extractInstructions(parsed.content) : [];
        const instructions = filterCommandPreferences(rawInstructions, stats.bashCommandTokens);

        unconditional.push({
          name,
          configFile: rule.path,
          scope,
          ruleType: 'unconditional',
          matchingFilesRead: 0,
          matchingFilesEdited: 0,
          matchingFilesEditedWithoutRead: 0,
          sessionsWithMatch: 0,
          writeBlindnessSessions: 0,
          estimatedTokens: tokens,
          extractedInstructions: instructions.length > 0 ? instructions : undefined,
          sessionsAnalyzed: stats.sessionsAnalyzed,
          confidence: 'exact',
        });
        continue;
      }

      // Path-scoped rule — check file activity against globs
      const matcher = picomatch(globs);
      let matchingFilesRead = 0;
      let matchingFilesEdited = 0;
      let matchingFilesEditedWithoutRead = 0;
      const sessionsWithReadMatch = new Set<string>();
      const sessionsWithWriteBlindness = new Set<string>();
      const writeBlindnessFiles: Array<{ filePath: string; editSessions: number }> = [];

      for (const [relPath, activity] of normalizedActivity) {
        if (!matcher(relPath)) continue;

        const wasRead = activity.readCount > 0;
        const wasModified = activity.editCount > 0 || activity.writeCount > 0;
        // Write-blindness: only flag Edit-without-Read, not Write-without-Read.
        // A Write creates a new file — Claude doesn't need to Read it first.
        // An Edit modifies an existing file — the path-scoped rule should have loaded via Read.
        const wasEditedExisting = activity.editCount > 0;

        if (wasRead) {
          matchingFilesRead++;
          for (const sid of activity.sessions) {
            sessionsWithReadMatch.add(sid);
          }
        }
        if (wasModified) {
          matchingFilesEdited++;
        }
        if (wasEditedExisting && !wasRead) {
          matchingFilesEditedWithoutRead++;
          writeBlindnessFiles.push({
            filePath: relPath,
            editSessions: activity.sessions.size,
          });
          for (const sid of activity.sessions) {
            sessionsWithWriteBlindness.add(sid);
          }
        }
      }

      // Confidence: exact if no matching files were touched at all, strong otherwise
      const anyActivity = matchingFilesRead > 0 || matchingFilesEdited > 0;
      const confidence: 'exact' | 'strong' = anyActivity ? 'strong' : 'exact';

      // Sort write-blindness files by session count descending, limit to top 10
      const sortedWbFiles = writeBlindnessFiles
        .sort((a, b) => b.editSessions - a.editSessions)
        .slice(0, 10);

      pathScoped.push({
        name,
        configFile: rule.path,
        scope,
        ruleType: 'path-scoped',
        globs,
        matchingFilesRead,
        matchingFilesEdited,
        matchingFilesEditedWithoutRead,
        sessionsWithMatch: sessionsWithReadMatch.size,
        writeBlindnessSessions: sessionsWithWriteBlindness.size,
        writeBlindnessFiles: sortedWbFiles.length > 0 ? sortedWbFiles : undefined,
        sessionsAnalyzed: stats.sessionsAnalyzed,
        confidence,
      });
    }
  };

  processRules(inventory.rules, 'project');
  processRules(inventory.userRules, 'user');

  return { pathScoped, unconditional, totalUnconditionalTokens };
}

/**
 * Enrich unconditional rules in a utilization report with compliance results.
 * Runs the compliance checker against raw tool calls and tasks from parse results.
 *
 * Option B from the spec: compliance is a separate step after produceUtilizationReport().
 */
export function enrichWithCompliance(
  report: UtilizationReport,
  toolCalls: ToolCall[],
  tasks: TaskAttempt[],
  toolDistribution: Map<string, number>,
): void {
  for (const rule of report.rules.unconditional) {
    if (!rule.extractedInstructions || rule.extractedInstructions.length === 0) {
      continue;
    }

    const results = checkCompliance(
      rule.extractedInstructions,
      toolCalls,
      tasks,
      toolDistribution,
    );

    if (results.length > 0) {
      rule.complianceResults = results;
    }
  }
}

/**
 * Filter command-preference extractions against observed Bash CLI tokens.
 * Keeps an extraction only if its preferred or avoided term appears in actual
 * Bash commands. Non-command-preference patterns pass through unfiltered.
 * If the CLI tokens set is empty (no Bash calls), all command-preferences are dropped
 * since there's nothing to validate against.
 */
function filterCommandPreferences(
  instructions: ExtractedInstruction[],
  cliTokens: Set<string>,
): ExtractedInstruction[] {
  return instructions.filter((inst) => {
    if (inst.patternType !== 'command-preference') return true;
    // If no Bash calls at all, drop command-preferences (nothing to validate against)
    if (cliTokens.size === 0) return false;
    const prefInCli = inst.preferred ? cliTokens.has(inst.preferred) : false;
    const avoidInCli = inst.avoided ? cliTokens.has(inst.avoided) : false;
    return prefInCli || avoidInCli;
  });
}
