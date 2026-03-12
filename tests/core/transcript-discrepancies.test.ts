import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectDiscrepancies, detectAgentBypasses } from '../../src/core/transcript-discrepancies.js';
import type { ConfigInventory, FileInfo } from '../../src/types/inventory.js';
import type {
  AggregateStats,
  ConfigUtilization,
  RuleUtilization,
  ToolCall,
  UsageSummary,
  UtilizationReport,
} from '../../src/types/transcript.js';
import type { TranscriptParseResult } from '../../src/parsers/transcript-jsonl.js';
import type { LintResult, LintIssue } from '../../src/types/lint.js';

// Mock parseAgentMd so we don't need real files
vi.mock('../../src/parsers/agents-md.js', () => ({
  parseAgentMd: (filePath: string) => {
    const data = MOCK_AGENT_DATA.get(filePath);
    return data ?? null;
  },
}));

// Registry for mock agent data
const MOCK_AGENT_DATA = new Map<string, {
  filePath: string;
  frontmatter: Record<string, unknown>;
  hasFrontmatter: boolean;
  content: string;
}>();

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

function makeUtilizationReport(overrides: Partial<UtilizationReport> = {}): UtilizationReport {
  return {
    sessionsAnalyzed: 12,
    sessionsExact: 10,
    sessionsPartial: 2,
    sessionsDamaged: 0,
    dateRange: { from: new Date('2026-02-08'), to: new Date('2026-03-10') },
    days: 30,
    agents: [],
    skills: [],
    mcpServers: [],
    commands: [],
    rules: { pathScoped: [], unconditional: [], totalUnconditionalTokens: 0 },
    ...overrides,
  };
}

function makeLintResult(issues: LintIssue[] = []): LintResult {
  return {
    issues,
    stats: {
      errors: 0,
      warnings: 0,
      infos: issues.length,
      rulesRun: 43,
      filesChecked: 10,
      duration: 50,
    },
  };
}

function makeAgentUtilization(overrides: Partial<ConfigUtilization> = {}): ConfigUtilization {
  return {
    name: 'researcher',
    configFile: '/project/.claude/agents/researcher.md',
    scope: 'project',
    used: true,
    usageCount: 8,
    sessionCount: 5,
    sessionsAnalyzed: 12,
    confidence: 'exact',
    ...overrides,
  };
}

function makeMcpUtilization(overrides: Partial<ConfigUtilization> = {}): ConfigUtilization {
  return {
    name: 'github',
    configFile: '/project/.mcp.json',
    scope: 'project',
    used: true,
    usageCount: 34,
    sessionCount: 0,
    sessionsAnalyzed: 12,
    confidence: 'exact',
    ...overrides,
  };
}

function makeRuleUtilization(overrides: Partial<RuleUtilization> = {}): RuleUtilization {
  return {
    name: 'react.md',
    configFile: '/project/.claude/rules/react.md',
    scope: 'project',
    ruleType: 'path-scoped',
    globs: ['src/**/*.tsx'],
    matchingFilesRead: 5,
    matchingFilesEdited: 3,
    matchingFilesEditedWithoutRead: 2,
    sessionsWithMatch: 4,
    writeBlindnessSessions: 0,
    sessionsAnalyzed: 12,
    confidence: 'strong',
    ...overrides,
  };
}

// ---- Tests ----

describe('detectDiscrepancies', () => {
  describe('ghost delegation', () => {
    it('detects agent delegated to but not in config', () => {
      const inventory = makeInventory({
        projectAgents: [
          makeFileInfo({ path: '/project/.claude/agents/researcher.md' }),
        ],
      });
      const stats = makeStats({
        delegations: [
          { agentName: 'data-analyst', count: 5, sessionIds: ['s1', 's2', 's3', 's4', 's5'], isEphemeralTeammate: false },
          { agentName: 'researcher', count: 8, sessionIds: ['s1', 's2'], isEphemeralTeammate: false },
        ],
      });
      const utilization = makeUtilizationReport();
      const lintResult = makeLintResult();

      const result = detectDiscrepancies(inventory, stats, utilization, lintResult);

      expect(result.discrepancies).toHaveLength(1);
      expect(result.discrepancies[0].type).toBe('ghost-delegation');
      expect(result.discrepancies[0].confidence).toBe('exact');
      expect(result.discrepancies[0].componentName).toBe('data-analyst');
      expect(result.discrepancies[0].sessionCount).toBe(5);
    });

    it('excludes built-in agent types', () => {
      const inventory = makeInventory();
      const stats = makeStats({
        delegations: [
          { agentName: 'Explore', count: 40, sessionIds: ['s1'], isEphemeralTeammate: false },
          { agentName: 'Plan', count: 10, sessionIds: ['s1'], isEphemeralTeammate: false },
          { agentName: 'general-purpose', count: 5, sessionIds: ['s1'], isEphemeralTeammate: false },
          { agentName: 'code-reviewer', count: 3, sessionIds: ['s1'], isEphemeralTeammate: false },
        ],
      });
      const utilization = makeUtilizationReport();
      const lintResult = makeLintResult();

      const result = detectDiscrepancies(inventory, stats, utilization, lintResult);

      expect(result.discrepancies).toHaveLength(0);
    });

    it('does not flag agent that exists in config', () => {
      const inventory = makeInventory({
        projectAgents: [
          makeFileInfo({ path: '/project/.claude/agents/researcher.md' }),
        ],
      });
      const stats = makeStats({
        delegations: [
          { agentName: 'researcher', count: 8, sessionIds: ['s1', 's2'], isEphemeralTeammate: false },
        ],
      });
      const utilization = makeUtilizationReport();
      const lintResult = makeLintResult();

      const result = detectDiscrepancies(inventory, stats, utilization, lintResult);

      expect(result.discrepancies).toHaveLength(0);
    });

    it('matches agent names case-insensitively', () => {
      const inventory = makeInventory({
        projectAgents: [
          makeFileInfo({ path: '/project/.claude/agents/Researcher.md' }),
        ],
      });
      const stats = makeStats({
        delegations: [
          { agentName: 'researcher', count: 3, sessionIds: ['s1'], isEphemeralTeammate: false },
        ],
      });
      const utilization = makeUtilizationReport();
      const lintResult = makeLintResult();

      const result = detectDiscrepancies(inventory, stats, utilization, lintResult);

      expect(result.discrepancies).toHaveLength(0);
    });

    it('checks user agents too', () => {
      const inventory = makeInventory({
        userAgents: [
          makeFileInfo({ path: '/home/user/.claude/agents/global-helper.md' }),
        ],
      });
      const stats = makeStats({
        delegations: [
          { agentName: 'global-helper', count: 2, sessionIds: ['s1'], isEphemeralTeammate: false },
        ],
      });
      const utilization = makeUtilizationReport();
      const lintResult = makeLintResult();

      const result = detectDiscrepancies(inventory, stats, utilization, lintResult);

      expect(result.discrepancies).toHaveLength(0);
    });

    it('does not flag plugin-provided agents as ghosts', () => {
      const inventory = makeInventory({
        pluginAgents: [
          makeFileInfo({ path: '/Users/dev/.claude/plugins/cache/acme-tools/compound-impl/agents/compound-impl.md' }),
        ],
      });
      const stats = makeStats({
        delegations: [
          { agentName: 'compound-impl', count: 5, sessionIds: ['s1', 's2'], isEphemeralTeammate: false },
        ],
      });
      const utilization = makeUtilizationReport();
      const lintResult = makeLintResult();

      const result = detectDiscrepancies(inventory, stats, utilization, lintResult);

      expect(result.discrepancies).toHaveLength(0);
    });

    it('still flags non-plugin agents as ghosts when plugin agents exist', () => {
      const inventory = makeInventory({
        pluginAgents: [
          makeFileInfo({ path: '/Users/dev/.claude/plugins/cache/acme/formatter/agents/formatter.md' }),
        ],
      });
      const stats = makeStats({
        delegations: [
          { agentName: 'formatter', count: 3, sessionIds: ['s1'], isEphemeralTeammate: false },
          { agentName: 'data-analyst', count: 2, sessionIds: ['s2', 's3'], isEphemeralTeammate: false },
        ],
      });
      const utilization = makeUtilizationReport();
      const lintResult = makeLintResult();

      const result = detectDiscrepancies(inventory, stats, utilization, lintResult);

      // formatter is a plugin agent — not a ghost
      // data-analyst is unknown — flagged as ghost
      expect(result.discrepancies).toHaveLength(1);
      expect(result.discrepancies[0].type).toBe('ghost-delegation');
      expect(result.discrepancies[0].componentName).toBe('data-analyst');
    });
  });

  describe('orphan confirmed', () => {
    it('confirms orphan when lint flags it and runtime shows 0 usage', () => {
      const inventory = makeInventory();
      const stats = makeStats();
      const utilization = makeUtilizationReport({
        agents: [
          makeAgentUtilization({
            name: 'smith',
            usageCount: 0,
            used: false,
          }),
        ],
      });
      const lintResult = makeLintResult([
        {
          ruleId: 'agents/orphan-agent',
          severity: 'info',
          category: 'agents',
          message: 'Agent smith is never referenced',
          file: '/project/.claude/agents/smith.md',
          suggestion: 'Remove if unused',
          autoFixable: false,
        },
      ]);

      const result = detectDiscrepancies(inventory, stats, utilization, lintResult);

      expect(result.discrepancies).toHaveLength(1);
      expect(result.discrepancies[0].type).toBe('orphan-confirmed');
      expect(result.discrepancies[0].severity).toBe('warning');
      expect(result.discrepancies[0].componentName).toBe('smith');
    });

    it('does not confirm orphan when agent was actually used', () => {
      const inventory = makeInventory();
      const stats = makeStats();
      const utilization = makeUtilizationReport({
        agents: [
          makeAgentUtilization({
            name: 'researcher',
            usageCount: 8,
            used: true,
          }),
        ],
      });
      const lintResult = makeLintResult([
        {
          ruleId: 'agents/orphan-agent',
          severity: 'info',
          category: 'agents',
          message: 'Agent researcher is never referenced',
          file: '/project/.claude/agents/researcher.md',
          suggestion: 'Remove if unused',
          autoFixable: false,
        },
      ]);

      const result = detectDiscrepancies(inventory, stats, utilization, lintResult);

      expect(result.discrepancies).toHaveLength(0);
    });

    it('does nothing when no orphan-agent lint issues', () => {
      const inventory = makeInventory();
      const stats = makeStats();
      const utilization = makeUtilizationReport();
      const lintResult = makeLintResult([
        {
          ruleId: 'memory/line-count',
          severity: 'warning',
          category: 'memory',
          message: 'CLAUDE.md is too long',
          suggestion: 'Shorten it',
          autoFixable: false,
        },
      ]);

      const result = detectDiscrepancies(inventory, stats, utilization, lintResult);

      expect(result.discrepancies).toHaveLength(0);
    });
  });

  describe('write-blindness recurring', () => {
    it('flags rules with recurring write-blindness above threshold', () => {
      const inventory = makeInventory();
      const stats = makeStats();
      const utilization = makeUtilizationReport({
        rules: {
          pathScoped: [
            makeRuleUtilization({
              name: 'architecture.md',
              globs: ['backend/app/**'],
              writeBlindnessSessions: 5,
              writeBlindnessFiles: [
                { filePath: 'backend/app/word_service.py', editSessions: 4 },
                { filePath: 'backend/app/vocabulary.py', editSessions: 3 },
                { filePath: 'backend/app/ConfirmAction.tsx', editSessions: 2 },
              ],
            }),
          ],
          unconditional: [],
          totalUnconditionalTokens: 0,
        },
      });
      const lintResult = makeLintResult();

      const result = detectDiscrepancies(inventory, stats, utilization, lintResult);

      expect(result.discrepancies).toHaveLength(1);
      expect(result.discrepancies[0].type).toBe('write-blindness-recurring');
      expect(result.discrepancies[0].confidence).toBe('strong');
      expect(result.discrepancies[0].componentName).toBe('architecture.md');
      expect(result.discrepancies[0].evidence).toContain('word_service.py');
    });

    it('does not flag write-blindness below threshold', () => {
      const inventory = makeInventory();
      const stats = makeStats();
      const utilization = makeUtilizationReport({
        rules: {
          pathScoped: [
            makeRuleUtilization({
              writeBlindnessSessions: 1,
              writeBlindnessFiles: [
                { filePath: 'src/foo.tsx', editSessions: 1 },
              ],
            }),
          ],
          unconditional: [],
          totalUnconditionalTokens: 0,
        },
      });
      const lintResult = makeLintResult();

      const result = detectDiscrepancies(inventory, stats, utilization, lintResult);

      expect(result.discrepancies).toHaveLength(0);
    });

    it('respects custom threshold', () => {
      const inventory = makeInventory();
      const stats = makeStats();
      const utilization = makeUtilizationReport({
        rules: {
          pathScoped: [
            makeRuleUtilization({
              writeBlindnessSessions: 2,
              writeBlindnessFiles: [
                { filePath: 'src/foo.tsx', editSessions: 2 },
              ],
            }),
          ],
          unconditional: [],
          totalUnconditionalTokens: 0,
        },
      });
      const lintResult = makeLintResult();

      const result = detectDiscrepancies(inventory, stats, utilization, lintResult, {
        writeBlindnessThreshold: 2,
      });

      expect(result.discrepancies).toHaveLength(1);
    });

    it('does not flag when writeBlindnessFiles is empty', () => {
      const inventory = makeInventory();
      const stats = makeStats();
      const utilization = makeUtilizationReport({
        rules: {
          pathScoped: [
            makeRuleUtilization({
              writeBlindnessSessions: 5,
              writeBlindnessFiles: undefined,
            }),
          ],
          unconditional: [],
          totalUnconditionalTokens: 0,
        },
      });
      const lintResult = makeLintResult();

      const result = detectDiscrepancies(inventory, stats, utilization, lintResult);

      expect(result.discrepancies).toHaveLength(0);
    });
  });

  describe('ghost MCP server', () => {
    it('flags MCP servers observed at runtime but not in config', () => {
      const inventory = makeInventory();
      const stats = makeStats();
      const utilization = makeUtilizationReport({
        mcpServers: [
          makeMcpUtilization({
            name: 'github',
            configFile: '/project/.mcp.json',
            scope: 'project',
          }),
          makeMcpUtilization({
            name: 'filesystem',
            configFile: '',
            scope: 'unknown',
            usageCount: 15,
            details: '15 tool calls (not in current config)',
          }),
        ],
      });
      const lintResult = makeLintResult();

      const result = detectDiscrepancies(inventory, stats, utilization, lintResult);

      expect(result.discrepancies).toHaveLength(1);
      expect(result.discrepancies[0].type).toBe('ghost-mcp-server');
      expect(result.discrepancies[0].confidence).toBe('exact');
      expect(result.discrepancies[0].componentName).toBe('filesystem');
      expect(result.discrepancies[0].severity).toBe('info');
    });

    it('does not flag configured MCP servers', () => {
      const inventory = makeInventory();
      const stats = makeStats();
      const utilization = makeUtilizationReport({
        mcpServers: [
          makeMcpUtilization({
            name: 'github',
            configFile: '/project/.mcp.json',
            scope: 'project',
          }),
        ],
      });
      const lintResult = makeLintResult();

      const result = detectDiscrepancies(inventory, stats, utilization, lintResult);

      expect(result.discrepancies).toHaveLength(0);
    });
  });

  describe('no discrepancies', () => {
    it('returns empty array when everything is clean', () => {
      const inventory = makeInventory({
        projectAgents: [
          makeFileInfo({ path: '/project/.claude/agents/researcher.md' }),
        ],
      });
      const stats = makeStats({
        delegations: [
          { agentName: 'researcher', count: 8, sessionIds: ['s1', 's2'], isEphemeralTeammate: false },
        ],
      });
      const utilization = makeUtilizationReport({
        agents: [makeAgentUtilization()],
        mcpServers: [makeMcpUtilization()],
        rules: {
          pathScoped: [makeRuleUtilization({ writeBlindnessSessions: 0 })],
          unconditional: [],
          totalUnconditionalTokens: 0,
        },
      });
      const lintResult = makeLintResult();

      const result = detectDiscrepancies(inventory, stats, utilization, lintResult);

      expect(result.discrepancies).toHaveLength(0);
      expect(result.sessionsAnalyzed).toBe(12);
    });
  });

  describe('mixed discrepancies', () => {
    it('detects multiple discrepancy types in one run', () => {
      const inventory = makeInventory({
        projectAgents: [
          makeFileInfo({ path: '/project/.claude/agents/researcher.md' }),
        ],
      });
      const stats = makeStats({
        delegations: [
          { agentName: 'researcher', count: 8, sessionIds: ['s1'], isEphemeralTeammate: false },
          { agentName: 'ghost-agent', count: 3, sessionIds: ['s2', 's3'], isEphemeralTeammate: false },
        ],
      });
      const utilization = makeUtilizationReport({
        agents: [
          makeAgentUtilization({ name: 'researcher', usageCount: 8 }),
          makeAgentUtilization({
            name: 'orphan-bot',
            usageCount: 0,
            used: false,
          }),
        ],
        mcpServers: [
          makeMcpUtilization({
            name: 'phantom',
            configFile: '',
            scope: 'unknown',
            usageCount: 7,
          }),
        ],
        rules: {
          pathScoped: [],
          unconditional: [],
          totalUnconditionalTokens: 0,
        },
      });
      const lintResult = makeLintResult([
        {
          ruleId: 'agents/orphan-agent',
          severity: 'info',
          category: 'agents',
          message: 'Agent orphan-bot is never referenced',
          file: '/project/.claude/agents/orphan-bot.md',
          suggestion: 'Remove if unused',
          autoFixable: false,
        },
      ]);

      const result = detectDiscrepancies(inventory, stats, utilization, lintResult);

      // 1 ghost delegation + 1 orphan confirmed + 1 ghost MCP
      expect(result.discrepancies).toHaveLength(3);

      const types = result.discrepancies.map((d) => d.type);
      expect(types).toContain('ghost-delegation');
      expect(types).toContain('orphan-confirmed');
      expect(types).toContain('ghost-mcp-server');
    });
  });

  describe('ephemeral teammates', () => {
    it('collapses ephemeral teammates into a single info summary', () => {
      const inventory = makeInventory();
      const stats = makeStats({
        delegations: [
          { agentName: 'backend-agent', count: 3, sessionIds: ['s1'], isEphemeralTeammate: true },
          { agentName: 'frontend-agent', count: 2, sessionIds: ['s1'], isEphemeralTeammate: true },
          { agentName: 'db-agent', count: 1, sessionIds: ['s1'], isEphemeralTeammate: true },
          { agentName: 'reviewer', count: 4, sessionIds: ['s1', 's2'], isEphemeralTeammate: true },
          { agentName: 'tester', count: 2, sessionIds: ['s2'], isEphemeralTeammate: true },
        ],
      });
      const utilization = makeUtilizationReport();
      const lintResult = makeLintResult();

      const result = detectDiscrepancies(inventory, stats, utilization, lintResult);

      expect(result.discrepancies).toHaveLength(1);
      const d = result.discrepancies[0];
      expect(d.type).toBe('ephemeral-teammates');
      expect(d.severity).toBe('info');
      expect(d.confidence).toBe('exact');
      expect(d.message).toContain('5 ephemeral agents');
      expect(d.message).toContain('2 sessions');
      expect(d.evidence).toContain('backend-agent');
      expect(d.evidence).toContain('frontend-agent');
      expect(d.evidence).toContain('db-agent');
      expect(d.evidence).toContain('reviewer');
      expect(d.evidence).toContain('tester');
    });

    it('genuine ghost still flagged as warning alongside ephemeral teammates', () => {
      const inventory = makeInventory();
      const stats = makeStats({
        delegations: [
          { agentName: 'backend-agent', count: 3, sessionIds: ['s1'], isEphemeralTeammate: true },
          { agentName: 'frontend-agent', count: 2, sessionIds: ['s1'], isEphemeralTeammate: true },
          { agentName: 'unknown-agent', count: 5, sessionIds: ['s2', 's3'], isEphemeralTeammate: false },
        ],
      });
      const utilization = makeUtilizationReport();
      const lintResult = makeLintResult();

      const result = detectDiscrepancies(inventory, stats, utilization, lintResult);

      // 1 ephemeral-teammates info + 1 ghost-delegation warning
      expect(result.discrepancies).toHaveLength(2);
      const types = result.discrepancies.map((d) => d.type);
      expect(types).toContain('ephemeral-teammates');
      expect(types).toContain('ghost-delegation');

      const ephemeral = result.discrepancies.find((d) => d.type === 'ephemeral-teammates')!;
      expect(ephemeral.severity).toBe('info');
      expect(ephemeral.message).toContain('2 ephemeral agents');

      const ghost = result.discrepancies.find((d) => d.type === 'ghost-delegation')!;
      expect(ghost.severity).toBe('warning');
      expect(ghost.componentName).toBe('unknown-agent');
    });

    it('no ephemeral teammates produces no info summary', () => {
      const inventory = makeInventory();
      const stats = makeStats({
        delegations: [
          { agentName: 'ghost', count: 1, sessionIds: ['s1'], isEphemeralTeammate: false },
        ],
      });
      const utilization = makeUtilizationReport();
      const lintResult = makeLintResult();

      const result = detectDiscrepancies(inventory, stats, utilization, lintResult);

      const ephemeral = result.discrepancies.filter((d) => d.type === 'ephemeral-teammates');
      expect(ephemeral).toHaveLength(0);
    });

    it('single ephemeral teammate uses singular grammar', () => {
      const inventory = makeInventory();
      const stats = makeStats({
        delegations: [
          { agentName: 'solo-agent', count: 1, sessionIds: ['s1'], isEphemeralTeammate: true },
        ],
      });
      const utilization = makeUtilizationReport();
      const lintResult = makeLintResult();

      const result = detectDiscrepancies(inventory, stats, utilization, lintResult);

      expect(result.discrepancies).toHaveLength(1);
      expect(result.discrepancies[0].message).toContain('1 ephemeral agent');
      expect(result.discrepancies[0].message).toContain('1 session)');
    });
  });
});

// ---- Agent Bypass Detection ----

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolName: 'Bash',
    input: {},
    callId: 'toolu_test',
    callerType: 'tool',
    requestId: 'req_test',
    isSidechain: false,
    ...overrides,
  };
}

function makeParseResult(toolCalls: ToolCall[]): TranscriptParseResult {
  return {
    session: {
      sessionId: 'test-session',
      claudeCodeVersion: null,
      model: null,
      projectRoot: '/project',
      gitBranch: null,
      startedAt: new Date('2026-03-01'),
      endedAt: new Date('2026-03-01'),
      sourceFile: '/tmp/test.jsonl',
      events: [],
      parseWarnings: [],
      completeness: 'exact',
      skippedLineTypes: [],
    },
    toolCalls,
    toolResults: [],
    tasks: [],
    tokenUsage: makeUsage(),
    messageTokens: [],
  };
}

function registerMockAgent(
  path: string,
  name: string,
  body: string,
  frontmatter: Record<string, unknown> = {},
) {
  MOCK_AGENT_DATA.set(path, {
    filePath: path,
    frontmatter: { name, ...frontmatter },
    hasFrontmatter: true,
    content: body,
  });
}

describe('detectAgentBypasses', () => {
  beforeEach(() => {
    MOCK_AGENT_DATA.clear();
  });

  it('detects direct bypass — Bash runs agent commands without delegation', () => {
    const agentPath = '/project/.claude/agents/test-runner.md';
    registerMockAgent(agentPath, 'test-runner', 'Run `python -m pytest` to verify tests.');

    const inventory = makeInventory({
      projectAgents: [makeFileInfo({ path: agentPath })],
    });

    const parseResults = [
      makeParseResult([
        makeToolCall({
          toolName: 'Bash',
          input: { command: 'cd backend && python -m pytest -v 2>&1' },
        }),
      ]),
    ];

    const result = detectAgentBypasses(inventory, parseResults);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('agent-bypass');
    expect(result[0].severity).toBe('info');
    expect(result[0].confidence).toBe('heuristic');
    expect(result[0].componentName).toBe('test-runner');
    expect(result[0].evidence).toContain('ran commands directly');
    expect(result[0].evidence).toContain('pytest');
  });

  it('detects delegation bypass — Agent call to general-purpose with matching prompt', () => {
    const agentPath = '/project/.claude/agents/test-runner.md';
    registerMockAgent(agentPath, 'test-runner', 'Run `pytest` to verify tests.');

    const inventory = makeInventory({
      projectAgents: [makeFileInfo({ path: agentPath })],
    });

    const parseResults = [
      makeParseResult([
        makeToolCall({
          toolName: 'Agent',
          input: {
            subagent_type: 'general-purpose',
            prompt: 'Run pytest on the backend code',
          },
        }),
      ]),
    ];

    const result = detectAgentBypasses(inventory, parseResults);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('agent-bypass');
    expect(result[0].evidence).toContain('delegated to general-purpose instead');
  });

  it('no discrepancy when agent is correctly delegated', () => {
    const agentPath = '/project/.claude/agents/test-runner.md';
    registerMockAgent(agentPath, 'test-runner', 'Run `pytest` to verify tests.');

    const inventory = makeInventory({
      projectAgents: [makeFileInfo({ path: agentPath })],
    });

    const parseResults = [
      makeParseResult([
        makeToolCall({
          toolName: 'Agent',
          input: { subagent_type: 'test-runner' },
        }),
      ]),
    ];

    const result = detectAgentBypasses(inventory, parseResults);

    expect(result).toHaveLength(0);
  });

  it('handles mixed sessions — reports bypass ratio correctly', () => {
    const agentPath = '/project/.claude/agents/test-runner.md';
    registerMockAgent(agentPath, 'test-runner', 'Run `pytest` to verify tests.');

    const inventory = makeInventory({
      projectAgents: [makeFileInfo({ path: agentPath })],
    });

    const parseResults = [
      // Session 1: direct bypass
      makeParseResult([
        makeToolCall({
          toolName: 'Bash',
          input: { command: 'python -m pytest -v' },
        }),
      ]),
      // Session 2: delegation bypass
      makeParseResult([
        makeToolCall({
          toolName: 'Agent',
          input: {
            subagent_type: 'general-purpose',
            prompt: 'Run pytest on tests/',
          },
        }),
      ]),
      // Session 3: correct delegation
      makeParseResult([
        makeToolCall({
          toolName: 'Agent',
          input: { subagent_type: 'test-runner' },
        }),
      ]),
    ];

    const result = detectAgentBypasses(inventory, parseResults);

    expect(result).toHaveLength(1);
    expect(result[0].message).toContain('bypassed in 2 of 3 matching sessions');
    expect(result[0].evidence).toContain('1 session ran commands directly');
    expect(result[0].evidence).toContain('1 session delegated to general-purpose instead');
    expect(result[0].evidence).toContain('1 session delegated correctly');
  });

  it('skips agent with no extractable patterns', () => {
    const agentPath = '/project/.claude/agents/reviewer.md';
    registerMockAgent(agentPath, 'reviewer', 'Review code quality. Think carefully about edge cases.');

    const inventory = makeInventory({
      projectAgents: [makeFileInfo({ path: agentPath })],
    });

    const parseResults = [
      makeParseResult([
        makeToolCall({
          toolName: 'Bash',
          input: { command: 'npm test' },
        }),
      ]),
    ];

    const result = detectAgentBypasses(inventory, parseResults);

    expect(result).toHaveLength(0);
  });

  it('does not count sidechain Bash calls as bypass', () => {
    const agentPath = '/project/.claude/agents/test-runner.md';
    registerMockAgent(agentPath, 'test-runner', 'Run `pytest` to verify tests.');

    const inventory = makeInventory({
      projectAgents: [makeFileInfo({ path: agentPath })],
    });

    const parseResults = [
      makeParseResult([
        // Correct delegation
        makeToolCall({
          toolName: 'Agent',
          input: { subagent_type: 'test-runner' },
        }),
        // Agent's own Bash call inside sidechain
        makeToolCall({
          toolName: 'Bash',
          input: { command: 'python -m pytest tests/ -v' },
          isSidechain: true,
        }),
      ]),
    ];

    const result = detectAgentBypasses(inventory, parseResults);

    expect(result).toHaveLength(0);
  });

  it('skips agent with permissionMode: ignore', () => {
    const agentPath = '/project/.claude/agents/disabled-agent.md';
    registerMockAgent(agentPath, 'disabled-agent', 'Run `pytest` always.', {
      permissionMode: 'ignore',
    });

    const inventory = makeInventory({
      projectAgents: [makeFileInfo({ path: agentPath })],
    });

    const parseResults = [
      makeParseResult([
        makeToolCall({
          toolName: 'Bash',
          input: { command: 'pytest -v' },
        }),
      ]),
    ];

    const result = detectAgentBypasses(inventory, parseResults);

    expect(result).toHaveLength(0);
  });

  it('returns empty when no matching sessions', () => {
    const agentPath = '/project/.claude/agents/test-runner.md';
    registerMockAgent(agentPath, 'test-runner', 'Run `pytest` to verify tests.');

    const inventory = makeInventory({
      projectAgents: [makeFileInfo({ path: agentPath })],
    });

    // Sessions with only Edit/Read — no Bash, no Agent calls
    const parseResults = [
      makeParseResult([
        makeToolCall({
          toolName: 'Edit',
          input: { file: 'src/app.ts' },
        }),
      ]),
    ];

    const result = detectAgentBypasses(inventory, parseResults);

    expect(result).toHaveLength(0);
  });

  it('derives agent name from filename when frontmatter name missing', () => {
    const agentPath = '/project/.claude/agents/linter.md';
    MOCK_AGENT_DATA.set(agentPath, {
      filePath: agentPath,
      frontmatter: {},
      hasFrontmatter: true,
      content: 'Run `ruff check .` on all Python files.',
    });

    const inventory = makeInventory({
      projectAgents: [makeFileInfo({ path: agentPath })],
    });

    const parseResults = [
      makeParseResult([
        makeToolCall({
          toolName: 'Bash',
          input: { command: 'ruff check . --fix' },
        }),
      ]),
    ];

    const result = detectAgentBypasses(inventory, parseResults);

    expect(result).toHaveLength(1);
    expect(result[0].componentName).toBe('linter');
  });

  it('returns empty when no agents configured', () => {
    const inventory = makeInventory({ projectAgents: [], userAgents: [] });
    const parseResults = [
      makeParseResult([
        makeToolCall({
          toolName: 'Bash',
          input: { command: 'npm test' },
        }),
      ]),
    ];

    const result = detectAgentBypasses(inventory, parseResults);

    expect(result).toHaveLength(0);
  });

  it('returns empty when no parse results', () => {
    const agentPath = '/project/.claude/agents/test-runner.md';
    registerMockAgent(agentPath, 'test-runner', 'Run `pytest`.');

    const inventory = makeInventory({
      projectAgents: [makeFileInfo({ path: agentPath })],
    });

    const result = detectAgentBypasses(inventory, []);

    expect(result).toHaveLength(0);
  });
});
