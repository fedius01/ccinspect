import { basename } from 'path';
import type { ConfigInventory } from '../types/inventory.js';
import type {
  AggregateStats,
  ConfigDiscrepancy,
  DiscrepancyReport,
  ToolCall,
  UtilizationReport,
} from '../types/transcript.js';
import type { LintResult } from '../types/lint.js';
import type { TranscriptParseResult } from '../parsers/transcript-jsonl.js';
import { parseAgentMd } from '../parsers/agents-md.js';
import { extractAgentPatterns, type AgentPatterns } from '../utils/agent-pattern-extractor.js';

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

// ---- Agent Bypass Detection (heuristic) ----

/** Built-in agent names used for delegation bypass detection. */
const BUILTIN_AGENTS = new Set([
  'general-purpose', 'explore', 'plan',
]);

/**
 * Detect when Claude runs an agent's commands directly via Bash or delegates
 * to a built-in agent instead of using the configured custom agent.
 *
 * Confidence: heuristic — uses command pattern matching from agent markdown.
 */
export function detectAgentBypasses(
  inventory: ConfigInventory,
  parseResults: TranscriptParseResult[],
): ConfigDiscrepancy[] {
  if (parseResults.length === 0) return [];

  const allAgentFiles = [...inventory.projectAgents, ...inventory.userAgents];
  if (allAgentFiles.length === 0) return [];

  // Parse each agent and extract patterns
  interface AgentInfo {
    name: string;
    patterns: AgentPatterns;
  }
  const agents: AgentInfo[] = [];

  for (const agentFile of allAgentFiles) {
    const parsed = parseAgentMd(agentFile.path);
    if (!parsed) continue;

    // Skip agents with permissionMode: ignore
    if (parsed.frontmatter.permissionMode === 'ignore') continue;

    const name = typeof parsed.frontmatter.name === 'string'
      ? parsed.frontmatter.name
      : basename(agentFile.path, '.md');

    const description = typeof parsed.frontmatter.description === 'string'
      ? parsed.frontmatter.description
      : '';

    const patterns = extractAgentPatterns(name, description, parsed.content);
    if (!patterns.hasPatterns) continue;

    agents.push({ name, patterns });
  }

  if (agents.length === 0) return [];

  const results: ConfigDiscrepancy[] = [];

  for (const agent of agents) {
    let directBypassCount = 0;
    let delegationBypassCount = 0;
    let correctDelegationCount = 0;
    const matchedCommands = new Set<string>();

    for (const result of parseResults) {
      const { toolCalls } = result;

      // Filter to non-sidechain calls only
      const mainBashCalls = toolCalls.filter(
        (tc) => tc.toolName === 'Bash' && !tc.isSidechain,
      );
      const mainAgentCalls = toolCalls.filter(
        (tc) => (tc.toolName === 'Agent' || tc.toolName === 'Task') && !tc.isSidechain,
      );

      // Check correct delegation first
      const correctlyDelegated = mainAgentCalls.some(
        (tc) => matchesAgentName(tc, agent.name),
      );
      if (correctlyDelegated) {
        correctDelegationCount++;
        continue;
      }

      // Check direct bypass: Bash calls containing agent's command patterns
      let isDirectBypass = false;
      for (const bash of mainBashCalls) {
        const command = typeof bash.input.command === 'string' ? bash.input.command : '';
        if (!command) continue;
        for (const pattern of agent.patterns.commandPatterns) {
          if (command.toLowerCase().includes(pattern.toLowerCase())) {
            isDirectBypass = true;
            matchedCommands.add(pattern);
          }
        }
      }

      if (isDirectBypass) {
        directBypassCount++;
        continue;
      }

      // Check delegation bypass: Agent/Task call to built-in with matching prompt
      let isDelegationBypass = false;
      for (const agentCall of mainAgentCalls) {
        const subagentType = getSubagentType(agentCall);
        if (!subagentType || !BUILTIN_AGENTS.has(subagentType.toLowerCase())) continue;

        const prompt = getAgentPrompt(agentCall);
        if (!prompt) continue;

        for (const pattern of agent.patterns.commandPatterns) {
          if (prompt.toLowerCase().includes(pattern.toLowerCase())) {
            isDelegationBypass = true;
            matchedCommands.add(pattern);
          }
        }
      }

      if (isDelegationBypass) {
        delegationBypassCount++;
      }
    }

    const totalMatchingSessions = directBypassCount + delegationBypassCount + correctDelegationCount;
    const bypassCount = directBypassCount + delegationBypassCount;

    if (totalMatchingSessions > 0 && bypassCount > 0) {
      results.push({
        type: 'agent-bypass',
        severity: 'info',
        confidence: 'heuristic',
        message: `Agent "${agent.name}" bypassed in ${bypassCount} of ${totalMatchingSessions} matching session${totalMatchingSessions !== 1 ? 's' : ''}`,
        componentName: agent.name,
        componentType: 'agent',
        evidence: buildBypassEvidence(
          directBypassCount,
          delegationBypassCount,
          correctDelegationCount,
          [...matchedCommands],
        ),
        sessionCount: bypassCount,
        sessionsAnalyzed: parseResults.length,
      });
    }
  }

  return results;
}

function matchesAgentName(tc: ToolCall, agentName: string): boolean {
  const subagentType = getSubagentType(tc);
  return subagentType !== null && subagentType.toLowerCase() === agentName.toLowerCase();
}

function getSubagentType(tc: ToolCall): string | null {
  const val = tc.input.subagent_type ?? tc.input.agent;
  return typeof val === 'string' ? val : null;
}

function getAgentPrompt(tc: ToolCall): string | null {
  const prompt = tc.input.prompt ?? tc.input.description ?? tc.input.task;
  return typeof prompt === 'string' ? prompt : null;
}

function buildBypassEvidence(
  direct: number,
  delegation: number,
  correct: number,
  matchedCommands: string[],
): string {
  const parts: string[] = [];
  const cmds = matchedCommands.slice(0, 3).join(', ');
  parts.push(`Matched commands: ${cmds}`);
  if (direct > 0) parts.push(`${direct} session${direct !== 1 ? 's' : ''} ran commands directly`);
  if (delegation > 0) parts.push(`${delegation} session${delegation !== 1 ? 's' : ''} delegated to general-purpose instead`);
  if (correct > 0) parts.push(`${correct} session${correct !== 1 ? 's' : ''} delegated correctly`);
  parts.push('→ Consider adding "MUST BE USED" or "ALWAYS delegate to this agent" to the agent description');
  return parts.join('\n      ');
}

// ---- Helpers ----

function buildWriteBlindnessEvidence(topFiles: string[], totalCount: number): string {
  const filesStr = 'Files affected: ' + topFiles.join(', ');
  if (totalCount > 3) {
    return filesStr + ' (+' + (totalCount - 3) + ' more)';
  }
  return filesStr;
}
