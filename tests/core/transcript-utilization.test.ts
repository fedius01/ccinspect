import { describe, it, expect } from 'vitest';
import { produceUtilizationReport } from '../../src/core/transcript-utilization.js';
import type { ConfigInventory, FileInfo } from '../../src/types/inventory.js';
import type { AggregateStats, UsageSummary } from '../../src/types/transcript.js';

// ---- Helpers ----

function makeFileInfo(overrides: Partial<FileInfo> = {}): FileInfo {
  return {
    path: '/project/.claude/agents/test.md',
    relativePath: '.claude/agents/test.md',
    exists: true,
    scope: 'project-shared',
    sizeBytes: 100,
    lineCount: 10,
    estimatedTokens: 50,
    gitTracked: true,
    lastModified: new Date('2026-03-01'),
    ...overrides,
  };
}

function makeInventory(overrides: Partial<ConfigInventory> = {}): ConfigInventory {
  return {
    projectRoot: '/project',
    gitRoot: '/project',
    userSettings: null,
    projectSettings: null,
    localSettings: null,
    managedSettings: null,
    preferences: null,
    enterpriseClaudeMd: null,
    globalClaudeMd: null,
    projectClaudeMd: null,
    localClaudeMd: null,
    subdirClaudeMds: [],
    autoMemory: null,
    autoMemoryTopics: [],
    rules: [],
    userRules: [],
    projectAgents: [],
    userAgents: [],
    projectCommands: [],
    userCommands: [],
    projectSkills: [],
    userSkills: [],
    projectMcp: null,
    managedMcp: null,
    plugins: [],
    pluginAgents: [],
    hooks: [],
    totalFiles: 0,
    totalStartupTokens: 0,
    totalOnDemandTokens: 0,
    ...overrides,
  };
}

function makeUsage(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cache5mTokens: 0,
    cache1hTokens: 0,
    completeness: 'exact',
    sessionsWithData: 0,
    sessionsTotal: 0,
    ...overrides,
  };
}

function makeStats(overrides: Partial<AggregateStats> = {}): AggregateStats {
  return {
    sessionsAnalyzed: 12,
    sessionsExact: 10,
    sessionsPartial: 2,
    sessionsDamaged: 0,
    dateRange: { from: new Date('2026-02-08'), to: new Date('2026-03-10') },
    totalTurns: 250,
    totalToolCalls: 487,
    toolDistribution: new Map(),
    fileActivity: new Map(),
    delegations: [],
    skillActivations: [],
    tokenUsage: makeUsage(),
    bashCommandTokens: new Set(),
    ...overrides,
  };
}

const DEFAULT_OPTIONS = { days: 30 };

// ---- Tests ----

describe('produceUtilizationReport', () => {
  describe('data quality passthrough', () => {
    it('mirrors session counts and date range from stats', () => {
      const stats = makeStats({
        sessionsAnalyzed: 12,
        sessionsExact: 10,
        sessionsPartial: 2,
        sessionsDamaged: 0,
      });
      const report = produceUtilizationReport(makeInventory(), stats, { days: 30 });

      expect(report.sessionsAnalyzed).toBe(12);
      expect(report.sessionsExact).toBe(10);
      expect(report.sessionsPartial).toBe(2);
      expect(report.sessionsDamaged).toBe(0);
      expect(report.days).toBe(30);
      expect(report.dateRange).toEqual(stats.dateRange);
    });
  });

  describe('agent utilization', () => {
    it('detects used agent via delegation match', () => {
      const inventory = makeInventory({
        projectAgents: [
          makeFileInfo({ path: '/project/.claude/agents/researcher.md', relativePath: '.claude/agents/researcher.md' }),
        ],
      });
      const stats = makeStats({
        delegations: [
          { agentName: 'researcher', count: 8, sessionIds: ['s1', 's2', 's3', 's4', 's5'], isEphemeralTeammate: false },
        ],
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      expect(report.agents).toHaveLength(1);
      expect(report.agents[0].name).toBe('researcher');
      expect(report.agents[0].used).toBe(true);
      expect(report.agents[0].usageCount).toBe(8);
      expect(report.agents[0].sessionCount).toBe(5);
      expect(report.agents[0].sessionsAnalyzed).toBe(12);
      expect(report.agents[0].confidence).toBe('exact');
      expect(report.agents[0].scope).toBe('project');
      expect(report.agents[0].details).toContain('8 delegations');
      expect(report.agents[0].details).toContain('5 sessions');
    });

    it('reports unused agent', () => {
      const inventory = makeInventory({
        projectAgents: [
          makeFileInfo({ path: '/project/.claude/agents/security-reviewer.md' }),
        ],
      });
      const stats = makeStats({ delegations: [] });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      expect(report.agents).toHaveLength(1);
      expect(report.agents[0].name).toBe('security-reviewer');
      expect(report.agents[0].used).toBe(false);
      expect(report.agents[0].usageCount).toBe(0);
      expect(report.agents[0].details).toBeUndefined();
    });

    it('matches agents case-insensitively', () => {
      const inventory = makeInventory({
        projectAgents: [
          makeFileInfo({ path: '/project/.claude/agents/Researcher.md' }),
        ],
      });
      const stats = makeStats({
        delegations: [{ agentName: 'researcher', count: 3, sessionIds: ['s1'], isEphemeralTeammate: false }],
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      expect(report.agents[0].used).toBe(true);
      expect(report.agents[0].usageCount).toBe(3);
    });

    it('excludes built-in agent types from report', () => {
      const inventory = makeInventory({ projectAgents: [] });
      const stats = makeStats({
        delegations: [
          { agentName: 'Explore', count: 40, sessionIds: ['s1', 's2'], isEphemeralTeammate: false },
          { agentName: 'Plan', count: 2, sessionIds: ['s1'], isEphemeralTeammate: false },
          { agentName: 'general-purpose', count: 15, sessionIds: ['s1', 's2', 's3'], isEphemeralTeammate: false },
          { agentName: 'code-reviewer', count: 5, sessionIds: ['s1'], isEphemeralTeammate: false },
        ],
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      // No configured agents → empty report, built-ins not listed
      expect(report.agents).toHaveLength(0);
    });

    it('includes user-configured agent named like a built-in when it exists in inventory', () => {
      // Edge case: user has an agent file named explore.md
      const inventory = makeInventory({
        projectAgents: [
          makeFileInfo({ path: '/project/.claude/agents/explore.md' }),
        ],
      });
      const stats = makeStats({
        delegations: [{ agentName: 'Explore', count: 40, sessionIds: ['s1', 's2'], isEphemeralTeammate: false }],
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      // The user-configured agent IS in inventory, so it gets matched
      // Built-in exclusion only applies to delegation records not matching any inventory agent
      expect(report.agents).toHaveLength(1);
      expect(report.agents[0].name).toBe('explore');
      expect(report.agents[0].used).toBe(true);
    });

    it('handles both project and user agents', () => {
      const inventory = makeInventory({
        projectAgents: [
          makeFileInfo({ path: '/project/.claude/agents/researcher.md' }),
        ],
        userAgents: [
          makeFileInfo({ path: '/Users/dev/.claude/agents/helper.md', scope: 'user' }),
        ],
      });
      const stats = makeStats({
        delegations: [
          { agentName: 'researcher', count: 5, sessionIds: ['s1'], isEphemeralTeammate: false },
        ],
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      expect(report.agents).toHaveLength(2);
      const researcher = report.agents.find(a => a.name === 'researcher');
      const helper = report.agents.find(a => a.name === 'helper');
      expect(researcher?.used).toBe(true);
      expect(researcher?.scope).toBe('project');
      expect(helper?.used).toBe(false);
      expect(helper?.scope).toBe('user');
    });

    it('deduplicates agents with same name across project and user', () => {
      const inventory = makeInventory({
        projectAgents: [
          makeFileInfo({ path: '/project/.claude/agents/researcher.md' }),
        ],
        userAgents: [
          makeFileInfo({ path: '/Users/dev/.claude/agents/researcher.md', scope: 'user' }),
        ],
      });
      const stats = makeStats({
        delegations: [{ agentName: 'researcher', count: 3, sessionIds: ['s1'], isEphemeralTeammate: false }],
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      // Project takes precedence (added first), user duplicate skipped
      expect(report.agents).toHaveLength(1);
      expect(report.agents[0].scope).toBe('project');
    });

    it('singular details for count of 1', () => {
      const inventory = makeInventory({
        projectAgents: [makeFileInfo({ path: '/project/.claude/agents/test.md' })],
      });
      const stats = makeStats({
        delegations: [{ agentName: 'test', count: 1, sessionIds: ['s1'], isEphemeralTeammate: false }],
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      expect(report.agents[0].details).toBe('1 delegation across 1 session');
    });

    it('includes plugin agents in utilization', () => {
      const inventory = makeInventory({
        pluginAgents: [
          makeFileInfo({ path: '/Users/dev/.claude/plugins/cache/acme/compound-impl.md' }),
        ],
      });
      const stats = makeStats({
        delegations: [
          { agentName: 'compound-impl', count: 5, sessionIds: ['s1', 's2'], isEphemeralTeammate: false },
        ],
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      expect(report.agents).toHaveLength(1);
      expect(report.agents[0].name).toBe('compound-impl');
      expect(report.agents[0].scope).toBe('plugin');
      expect(report.agents[0].used).toBe(true);
      expect(report.agents[0].usageCount).toBe(5);
    });
  });

  describe('skill utilization', () => {
    it('detects used skill by directory name', () => {
      const inventory = makeInventory({
        projectSkills: [
          makeFileInfo({ path: '/project/.claude/skills/commit/SKILL.md' }),
        ],
      });
      const stats = makeStats({
        skillActivations: [
          { skillName: 'commit', explicitCount: 10, autoCount: 2, sessionIds: ['s1', 's2', 's3'], isEphemeralTeammate: false },
        ],
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      expect(report.skills).toHaveLength(1);
      expect(report.skills[0].name).toBe('commit');
      expect(report.skills[0].used).toBe(true);
      expect(report.skills[0].usageCount).toBe(12); // explicit + auto
      expect(report.skills[0].sessionCount).toBe(3);
      expect(report.skills[0].confidence).toBe('exact');
    });

    it('reports unused skill', () => {
      const inventory = makeInventory({
        projectSkills: [
          makeFileInfo({ path: '/project/.claude/skills/deploy/SKILL.md' }),
        ],
      });
      const stats = makeStats({ skillActivations: [] });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      expect(report.skills).toHaveLength(1);
      expect(report.skills[0].used).toBe(false);
      expect(report.skills[0].usageCount).toBe(0);
    });

    it('matches skills case-insensitively', () => {
      const inventory = makeInventory({
        projectSkills: [
          makeFileInfo({ path: '/project/.claude/skills/ReviewPR/SKILL.md' }),
        ],
      });
      const stats = makeStats({
        skillActivations: [
          { skillName: 'reviewpr', explicitCount: 4, autoCount: 0, sessionIds: ['s1'], isEphemeralTeammate: false },
        ],
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      expect(report.skills[0].used).toBe(true);
    });

    it('handles nested skill directories', () => {
      const inventory = makeInventory({
        projectSkills: [
          makeFileInfo({ path: '/project/.claude/skills/frontend/review/SKILL.md' }),
        ],
      });
      const stats = makeStats({
        skillActivations: [
          { skillName: 'review', explicitCount: 2, autoCount: 0, sessionIds: ['s1'], isEphemeralTeammate: false },
        ],
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      // Name extracted from immediate parent directory of SKILL.md
      expect(report.skills[0].name).toBe('review');
      expect(report.skills[0].used).toBe(true);
    });
  });

  describe('MCP server utilization', () => {
    it('detects used MCP server from tool distribution', () => {
      const inventory = makeInventory({
        projectMcp: makeFileInfo({
          path: '/project/.mcp.json',
          exists: true,
        }),
      });
      // Note: We can't easily mock parseMcpJson reading from disk in unit tests.
      // For MCP tests that need configured servers, we test the runtime-observed path.
      const stats = makeStats({
        toolDistribution: new Map([
          ['mcp__github__create_issue', 10],
          ['mcp__github__list_prs', 5],
          ['Read', 100],
          ['Edit', 80],
        ]),
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      // Without a real .mcp.json on disk, only runtime-observed servers appear
      const github = report.mcpServers.find(s => s.name === 'github');
      expect(github).toBeDefined();
      expect(github?.used).toBe(true);
      expect(github?.usageCount).toBe(15); // 10 + 5
      expect(github?.confidence).toBe('exact');
    });

    it('extracts multiple MCP servers from tool names', () => {
      const stats = makeStats({
        toolDistribution: new Map([
          ['mcp__github__create_issue', 10],
          ['mcp__filesystem__read_file', 3],
          ['mcp__slack__send_message', 1],
        ]),
      });

      const report = produceUtilizationReport(makeInventory(), stats, DEFAULT_OPTIONS);

      expect(report.mcpServers).toHaveLength(3);
      const names = report.mcpServers.map(s => s.name).sort();
      expect(names).toEqual(['filesystem', 'github', 'slack']);
    });

    it('ignores non-MCP tools in distribution', () => {
      const stats = makeStats({
        toolDistribution: new Map([
          ['Read', 100],
          ['Edit', 80],
          ['Bash', 50],
        ]),
      });

      const report = produceUtilizationReport(makeInventory(), stats, DEFAULT_OPTIONS);

      expect(report.mcpServers).toHaveLength(0);
    });

    it('handles no MCP usage', () => {
      const stats = makeStats({ toolDistribution: new Map() });
      const report = produceUtilizationReport(makeInventory(), stats, DEFAULT_OPTIONS);
      expect(report.mcpServers).toHaveLength(0);
    });
  });

  describe('command utilization', () => {
    it('detects used command from skill activations', () => {
      const inventory = makeInventory({
        projectCommands: [
          makeFileInfo({ path: '/project/.claude/commands/deploy.md' }),
        ],
      });
      const stats = makeStats({
        skillActivations: [
          { skillName: 'deploy', explicitCount: 3, autoCount: 0, sessionIds: ['s1', 's2'], isEphemeralTeammate: false },
        ],
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      expect(report.commands).toHaveLength(1);
      expect(report.commands[0].name).toBe('deploy');
      expect(report.commands[0].used).toBe(true);
      expect(report.commands[0].usageCount).toBe(3);
      expect(report.commands[0].sessionCount).toBe(2);
    });

    it('reports unused command', () => {
      const inventory = makeInventory({
        projectCommands: [
          makeFileInfo({ path: '/project/.claude/commands/seed-data.md' }),
        ],
      });
      const stats = makeStats({ skillActivations: [] });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      expect(report.commands).toHaveLength(1);
      expect(report.commands[0].used).toBe(false);
    });

    it('handles both project and user commands', () => {
      const inventory = makeInventory({
        projectCommands: [
          makeFileInfo({ path: '/project/.claude/commands/deploy.md' }),
        ],
        userCommands: [
          makeFileInfo({ path: '/Users/dev/.claude/commands/global-lint.md', scope: 'user' }),
        ],
      });
      const stats = makeStats({ skillActivations: [] });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      expect(report.commands).toHaveLength(2);
      expect(report.commands[0].scope).toBe('project');
      expect(report.commands[1].scope).toBe('user');
    });
  });

  describe('mixed scenarios', () => {
    it('handles multiple used and unused components across all surfaces', () => {
      const inventory = makeInventory({
        projectAgents: [
          makeFileInfo({ path: '/project/.claude/agents/researcher.md' }),
          makeFileInfo({ path: '/project/.claude/agents/security-review.md' }),
          makeFileInfo({ path: '/project/.claude/agents/test-runner.md' }),
        ],
        projectSkills: [
          makeFileInfo({ path: '/project/.claude/skills/commit/SKILL.md' }),
          makeFileInfo({ path: '/project/.claude/skills/review-pr/SKILL.md' }),
        ],
        projectCommands: [
          makeFileInfo({ path: '/project/.claude/commands/deploy.md' }),
        ],
      });
      const stats = makeStats({
        delegations: [
          { agentName: 'researcher', count: 8, sessionIds: ['s1', 's2', 's3', 's4', 's5'], isEphemeralTeammate: false },
          { agentName: 'test-runner', count: 3, sessionIds: ['s1', 's2'], isEphemeralTeammate: false },
          { agentName: 'Explore', count: 40, sessionIds: ['s1', 's2'], isEphemeralTeammate: false }, // built-in, excluded
        ],
        skillActivations: [
          { skillName: 'commit', explicitCount: 12, autoCount: 0, sessionIds: ['s1', 's2', 's3'], isEphemeralTeammate: false },
        ],
        toolDistribution: new Map([
          ['mcp__github__create_issue', 34],
        ]),
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      // Agents: 2 used, 1 unused
      expect(report.agents).toHaveLength(3);
      expect(report.agents.filter(a => a.used)).toHaveLength(2);
      expect(report.agents.filter(a => !a.used)).toHaveLength(1);
      expect(report.agents.find(a => a.name === 'security-review')?.used).toBe(false);

      // Skills: 1 used, 1 unused
      expect(report.skills).toHaveLength(2);
      expect(report.skills.find(s => s.name === 'commit')?.used).toBe(true);
      expect(report.skills.find(s => s.name === 'review-pr')?.used).toBe(false);

      // MCP: 1 runtime-observed
      expect(report.mcpServers).toHaveLength(1);
      expect(report.mcpServers[0].name).toBe('github');

      // Commands: 1 unused
      expect(report.commands).toHaveLength(1);
      expect(report.commands[0].used).toBe(false);
    });

    it('handles completely empty inventory with delegations', () => {
      const stats = makeStats({
        delegations: [
          { agentName: 'Explore', count: 40, sessionIds: ['s1'], isEphemeralTeammate: false },
          { agentName: 'Plan', count: 2, sessionIds: ['s1'], isEphemeralTeammate: false },
        ],
      });

      const report = produceUtilizationReport(makeInventory(), stats, DEFAULT_OPTIONS);

      expect(report.agents).toHaveLength(0);
      expect(report.skills).toHaveLength(0);
      expect(report.mcpServers).toHaveLength(0);
      expect(report.commands).toHaveLength(0);
    });

    it('handles empty stats (no transcripts analyzed)', () => {
      const inventory = makeInventory({
        projectAgents: [
          makeFileInfo({ path: '/project/.claude/agents/researcher.md' }),
        ],
        projectSkills: [
          makeFileInfo({ path: '/project/.claude/skills/commit/SKILL.md' }),
        ],
      });
      const stats = makeStats({ sessionsAnalyzed: 0 });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      expect(report.agents).toHaveLength(1);
      expect(report.agents[0].used).toBe(false);
      expect(report.agents[0].sessionsAnalyzed).toBe(0);
      expect(report.skills).toHaveLength(1);
      expect(report.skills[0].used).toBe(false);
      expect(report.skills[0].sessionsAnalyzed).toBe(0);
    });
  });
});
