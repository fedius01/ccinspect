import { basename } from 'path';
import type { ConfigInventory } from '../types/inventory.js';
import type {
  AggregateStats,
  ConfigDiscrepancy,
  DiscrepancyReport,
  UtilizationReport,
} from '../types/transcript.js';
import type { LintResult } from '../types/lint.js';

interface DiscrepancyOptions {
  /** Minimum sessions for write-blindness to be flagged as recurring (default: 3). */
  writeBlindnessThreshold?: number;
}

/** Built-in agent/subagent types that should not be flagged as ghost delegations. */
const BUILTIN_AGENT_TYPES = new Set([
  'explore',
  'plan',
  'general-purpose',
  'bash',
  'code',
  'code-reviewer',
  'code-explorer',
  'code-architect',
  'statusline-setup',
  'claude-code-guide',
]);

/**
 * Detect discrepancies between static config and runtime transcript data.
 *
 * Only exact and strong confidence signals — no heuristics.
 */
export function detectDiscrepancies(
  inventory: ConfigInventory,
  stats: AggregateStats,
  utilization: UtilizationReport,
  lintResult: LintResult,
  options?: DiscrepancyOptions,
): DiscrepancyReport {
  const discrepancies: ConfigDiscrepancy[] = [];

  discrepancies.push(...detectGhostDelegations(inventory, stats));
  discrepancies.push(...detectOrphanConfirmed(utilization, lintResult, stats));
  discrepancies.push(
    ...detectWriteBlindnessRecurring(utilization, options?.writeBlindnessThreshold ?? 3),
  );
  discrepancies.push(...detectGhostMcpServers(utilization));

  return {
    discrepancies,
    sessionsAnalyzed: stats.sessionsAnalyzed,
  };
}

// ---- Ghost Delegations (exact) ----

function detectGhostDelegations(
  inventory: ConfigInventory,
  stats: AggregateStats,
): ConfigDiscrepancy[] {
  const results: ConfigDiscrepancy[] = [];

  // Build set of configured agent names (lowercase) — includes plugin agents
  const configuredAgents = new Set<string>();
  for (const agent of [...inventory.projectAgents, ...inventory.userAgents, ...inventory.pluginAgents]) {
    configuredAgents.add(basename(agent.path, '.md').toLowerCase());
  }

  // Separate unmatched delegations into ephemeral teammates vs genuine ghosts
  const ephemeralTeammates: typeof stats.delegations = [];

  for (const delegation of stats.delegations) {
    const key = delegation.agentName.toLowerCase();

    // Skip built-in types
    if (BUILTIN_AGENT_TYPES.has(key)) continue;

    // Skip if agent exists in config
    if (configuredAgents.has(key)) continue;

    if (delegation.isEphemeralTeammate) {
      ephemeralTeammates.push(delegation);
    } else {
      // Genuine ghost → individual warning
      results.push({
        type: 'ghost-delegation',
        severity: 'warning',
        confidence: 'exact',
        message: `"${delegation.agentName}" was delegated to in ${delegation.sessionIds.length} session${delegation.sessionIds.length !== 1 ? 's' : ''} but no agent file exists in config`,
        componentName: delegation.agentName,
        componentType: 'agent',
        evidence: `${delegation.count} delegation${delegation.count !== 1 ? 's' : ''} across ${delegation.sessionIds.length} session${delegation.sessionIds.length !== 1 ? 's' : ''}`,
        sessionCount: delegation.sessionIds.length,
        sessionsAnalyzed: stats.sessionsAnalyzed,
      });
    }
  }

  // Ephemeral teammates → one collapsed info summary
  if (ephemeralTeammates.length > 0) {
    const sessionSet = new Set(ephemeralTeammates.flatMap((d) => d.sessionIds));
    const names = ephemeralTeammates.map((d) => d.agentName);

    results.push({
      type: 'ephemeral-teammates',
      severity: 'info',
      confidence: 'exact',
      message: `${names.length} ephemeral agent${names.length !== 1 ? 's' : ''} created via Agent Teams (across ${sessionSet.size} session${sessionSet.size !== 1 ? 's' : ''})`,
      componentName: names.join(', '),
      componentType: 'agent',
      evidence: names.join(', '),
      sessionCount: sessionSet.size,
      sessionsAnalyzed: stats.sessionsAnalyzed,
    });
  }

  return results;
}

// ---- Orphan Confirmed by Runtime (exact) ----

function detectOrphanConfirmed(
  utilization: UtilizationReport,
  lintResult: LintResult,
  stats: AggregateStats,
): ConfigDiscrepancy[] {
  const results: ConfigDiscrepancy[] = [];

  // Find lint issues with ruleId 'agents/orphan-agent'
  const orphanIssues = lintResult.issues.filter(
    (issue) => issue.ruleId === 'agents/orphan-agent',
  );
  if (orphanIssues.length === 0) return results;

  // Build a lookup from agent name → utilization data
  const agentUsageMap = new Map<string, number>();
  for (const agent of utilization.agents) {
    agentUsageMap.set(agent.name.toLowerCase(), agent.usageCount);
  }

  for (const issue of orphanIssues) {
    // Extract agent name from the issue file path
    const agentName = issue.file ? basename(issue.file, '.md') : null;
    if (!agentName) continue;

    const usage = agentUsageMap.get(agentName.toLowerCase());
    // Only confirm orphan if usage is exactly 0 (agent exists in utilization but unused)
    if (usage !== undefined && usage === 0) {
      results.push({
        type: 'orphan-confirmed',
        severity: 'warning',
        confidence: 'exact',
        message: `Agent "${agentName}" has 0 delegations across ${stats.sessionsAnalyzed} sessions. Static lint also flagged it as unreferenced. Safe to remove.`,
        componentName: agentName,
        componentType: 'agent',
        evidence: `0 delegations in ${stats.sessionsAnalyzed} session${stats.sessionsAnalyzed !== 1 ? 's' : ''} + orphan-agent lint finding`,
        sessionCount: 0,
        sessionsAnalyzed: stats.sessionsAnalyzed,
      });
    }
  }

  return results;
}

// ---- Write-Blindness Recurring (strong) ----

function detectWriteBlindnessRecurring(
  utilization: UtilizationReport,
  threshold: number,
): ConfigDiscrepancy[] {
  const results: ConfigDiscrepancy[] = [];

  for (const rule of utilization.rules.pathScoped) {
    if (rule.writeBlindnessSessions >= threshold && rule.writeBlindnessFiles && rule.writeBlindnessFiles.length > 0) {
      const topFiles = rule.writeBlindnessFiles
        .slice(0, 3)
        .map((f) => f.filePath);

      results.push({
        type: 'write-blindness-recurring',
        severity: 'warning',
        confidence: 'strong',
        message: `Rule ${rule.name} (paths: ${rule.globs?.join(', ') ?? '?'}) had ${rule.writeBlindnessSessions}+ sessions where matching files were edited without reading`,
        componentName: rule.name,
        componentType: 'rule',
        evidence: buildWriteBlindnessEvidence(topFiles, rule.writeBlindnessFiles.length),
        sessionCount: rule.writeBlindnessSessions,
        sessionsAnalyzed: rule.sessionsAnalyzed,
      });
    }
  }

  return results;
}

// ---- Ghost MCP Servers (exact) ----

function detectGhostMcpServers(
  utilization: UtilizationReport,
): ConfigDiscrepancy[] {
  const results: ConfigDiscrepancy[] = [];

  for (const server of utilization.mcpServers) {
    // Ghost servers have empty configFile and 'unknown' scope
    if (server.configFile === '' && server.scope === 'unknown') {
      results.push({
        type: 'ghost-mcp-server',
        severity: 'info',
        confidence: 'exact',
        message: `MCP server "${server.name}" was used at runtime but is not in current config`,
        componentName: server.name,
        componentType: 'mcp-server',
        evidence: `${server.usageCount} tool call${server.usageCount !== 1 ? 's' : ''} observed`,
        sessionCount: server.sessionCount,
        sessionsAnalyzed: server.sessionsAnalyzed,
      });
    }
  }

  return results;
}

// ---- Helpers ----

function buildWriteBlindnessEvidence(topFiles: string[], totalCount: number): string {
  const filesStr = 'Files affected: ' + topFiles.join(', ');
  if (totalCount > 3) {
    return filesStr + ' (+' + (totalCount - 3) + ' more)';
  }
  return filesStr;
}
