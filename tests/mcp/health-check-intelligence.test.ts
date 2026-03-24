import { describe, it, expect } from 'vitest';
import type { LintIssue } from '../../src/types/lint.js';
import {
  buildComponentSummary,
  computeFixCascades,
  generateAnalysisHints,
} from '../../src/mcp/server.js';

/** Helper to create a minimal LintIssue for testing. */
function issue(overrides: Partial<LintIssue> & { ruleId: string; severity: LintIssue['severity'] }): LintIssue {
  return {
    category: 'rules',
    message: `Issue from ${overrides.ruleId}`,
    suggestion: 'Fix it',
    autoFixable: false,
    ...overrides,
  };
}

describe('buildComponentSummary', () => {
  it('groups lint issues by fileRelativePath', () => {
    const issues: LintIssue[] = [
      issue({ ruleId: 'rules-dir/overly-broad-glob', severity: 'warning', file: '/p/.claude/rules/a.md', fileRelativePath: '.claude/rules/a.md', fileType: 'rule-md', scope: 'project-shared' }),
      issue({ ruleId: 'rules-dir/overlapping-rules', severity: 'info', file: '/p/.claude/rules/a.md', fileRelativePath: '.claude/rules/a.md', fileType: 'rule-md', scope: 'project-shared' }),
      issue({ ruleId: 'agents/frontmatter-valid', severity: 'error', file: '/p/.claude/agents/rev.md', fileRelativePath: '.claude/agents/rev.md', fileType: 'agent-md', scope: 'project-shared' }),
    ];

    const result = buildComponentSummary(issues);

    expect(result).toHaveLength(2);
    // Error-severity component should sort first
    const agentEntry = result.find((c) => c.file === '.claude/agents/rev.md');
    expect(agentEntry).toBeDefined();
    expect(agentEntry!.lintIssues).toHaveLength(1);
    expect(agentEntry!.lintIssues[0].ruleId).toBe('agents/frontmatter-valid');

    const ruleEntry = result.find((c) => c.file === '.claude/rules/a.md');
    expect(ruleEntry).toBeDefined();
    expect(ruleEntry!.lintIssues).toHaveLength(2);
  });

  it('merges audit utilization into component entries', () => {
    const issues: LintIssue[] = [
      issue({ ruleId: 'agents/frontmatter-valid', severity: 'error', file: '/p/.claude/agents/rev.md', fileRelativePath: '.claude/agents/rev.md', fileType: 'agent-md', scope: 'project-shared' }),
    ];

    const auditData = {
      agents: [
        {
          name: 'reviewer',
          configFile: '.claude/agents/rev.md',
          scope: 'project',
          used: false,
          usageCount: 0,
          sessionCount: 0,
          sessionsAnalyzed: 5,
          confidence: 'exact' as const,
        },
      ],
    };

    const result = buildComponentSummary(issues, auditData);
    const entry = result.find((c) => c.file === '.claude/agents/rev.md');
    expect(entry).toBeDefined();
    expect(entry!.auditStatus).toBeDefined();
    expect(entry!.auditStatus!.used).toBe(false);
    expect(entry!.auditStatus!.sessionsAnalyzed).toBe(5);
    expect(entry!.lintIssues).toHaveLength(1);
  });

  it('merges discrepancies by component name', () => {
    const issues: LintIssue[] = [];
    const auditData = {
      agents: [
        {
          name: 'reviewer',
          configFile: '.claude/agents/reviewer.md',
          scope: 'project',
          used: true,
          usageCount: 3,
          sessionCount: 2,
          sessionsAnalyzed: 5,
          confidence: 'exact' as const,
        },
      ],
      discrepancies: [
        {
          type: 'ghost-delegation' as const,
          severity: 'warning' as const,
          confidence: 'strong' as const,
          message: 'Agent reviewer delegated but not configured',
          componentName: 'reviewer',
          componentType: 'agent' as const,
          evidence: 'found in 2 sessions',
          sessionCount: 2,
          sessionsAnalyzed: 5,
        },
      ],
    };

    const result = buildComponentSummary(issues, auditData);
    const entry = result.find((c) => c.name === 'reviewer');
    expect(entry).toBeDefined();
    expect(entry!.discrepancies).toHaveLength(1);
    expect(entry!.discrepancies![0].type).toBe('ghost-delegation');
  });

  it('merges lint and audit entries for same component when paths differ (relative vs absolute)', () => {
    const issues: LintIssue[] = [
      issue({
        ruleId: 'agents/frontmatter-valid',
        severity: 'error',
        file: '/abs/path/.claude/agents/test.md',
        fileRelativePath: '.claude/agents/test.md',
        fileType: 'agent-md',
        scope: 'project-shared',
      }),
      issue({
        ruleId: 'agents/orphan-agent',
        severity: 'info',
        file: '/abs/path/.claude/agents/test.md',
        fileRelativePath: '.claude/agents/test.md',
        fileType: 'agent-md',
        scope: 'project-shared',
      }),
    ];

    const auditData = {
      agents: [
        {
          name: 'test',
          configFile: '/abs/path/.claude/agents/test.md',
          scope: 'project',
          used: false,
          usageCount: 0,
          sessionCount: 0,
          sessionsAnalyzed: 10,
          confidence: 'exact' as const,
        },
      ],
    };

    const result = buildComponentSummary(issues, auditData);

    // Should produce ONE entry, not two
    const testEntries = result.filter((c) => c.name === 'test');
    expect(testEntries).toHaveLength(1);
    expect(testEntries[0].lintIssues).toHaveLength(2);
    expect(testEntries[0].auditStatus).toBeDefined();
    expect(testEntries[0].auditStatus!.used).toBe(false);
  });

  it('excludes ghost delegations with long/truncated names from componentSummary', () => {
    const issues: LintIssue[] = [];
    const auditData = {
      discrepancies: [
        {
          type: 'ghost-delegation' as const,
          severity: 'warning' as const,
          confidence: 'strong' as const,
          message: 'Agent delegated but not configured',
          componentName: 'Analyze transcript files for t...',
          componentType: 'agent' as const,
          evidence: 'found in 1 session',
          sessionCount: 1,
          sessionsAnalyzed: 5,
        },
        {
          type: 'ghost-delegation' as const,
          severity: 'warning' as const,
          confidence: 'strong' as const,
          message: 'Agent delegated but not configured',
          componentName: 'real-agent',
          componentType: 'agent' as const,
          evidence: 'found in 2 sessions',
          sessionCount: 2,
          sessionsAnalyzed: 5,
        },
      ],
    };

    const result = buildComponentSummary(issues, auditData);

    // The truncated name should NOT appear as a component
    expect(result.find((c) => c.name.includes('Analyze transcript'))).toBeUndefined();
    // The real agent should appear
    expect(result.find((c) => c.name === 'real-agent')).toBeDefined();
  });

  it('sorts errors first, then warnings, then info', () => {
    const issues: LintIssue[] = [
      issue({ ruleId: 'r1', severity: 'info', fileRelativePath: 'f1', fileType: 'rule-md', scope: 'project-shared' }),
      issue({ ruleId: 'r2', severity: 'error', fileRelativePath: 'f2', fileType: 'agent-md', scope: 'project-shared' }),
      issue({ ruleId: 'r3', severity: 'warning', fileRelativePath: 'f3', fileType: 'rule-md', scope: 'project-shared' }),
    ];

    const result = buildComponentSummary(issues);
    expect(result[0].file).toBe('f2'); // error first
    expect(result[1].file).toBe('f3'); // warning second
    expect(result[2].file).toBe('f1'); // info last
  });
});

describe('computeFixCascades', () => {
  it('sets fixCascadeCount on overly-broad-glob when overlapping-rules reference same file', () => {
    const broadFile = '/p/.claude/rules/broad.md';
    const issues: LintIssue[] = [
      issue({ ruleId: 'rules-dir/overly-broad-glob', severity: 'warning', file: broadFile }),
      issue({ ruleId: 'rules-dir/overlapping-rules', severity: 'info', file: broadFile }),
      issue({ ruleId: 'rules-dir/overlapping-rules', severity: 'info', file: broadFile }),
      issue({ ruleId: 'rules-dir/overlapping-rules', severity: 'info', file: broadFile }),
    ];

    computeFixCascades(issues);

    const broadIssue = issues.find((i) => i.ruleId === 'rules-dir/overly-broad-glob');
    expect(broadIssue!.fixCascadeCount).toBe(3);
  });

  it('sets fixCascadeCount on frontmatter-valid when orphan-agent exists for same file', () => {
    const agentFile = '/p/.claude/agents/broken.md';
    const issues: LintIssue[] = [
      issue({ ruleId: 'agents/frontmatter-valid', severity: 'error', file: agentFile }),
      issue({ ruleId: 'agents/orphan-agent', severity: 'info', file: agentFile }),
    ];

    computeFixCascades(issues);

    const frontmatterIssue = issues.find((i) => i.ruleId === 'agents/frontmatter-valid');
    expect(frontmatterIssue!.fixCascadeCount).toBe(1);
  });

  it('does not set fixCascadeCount when no related issues exist', () => {
    const issues: LintIssue[] = [
      issue({ ruleId: 'rules-dir/overly-broad-glob', severity: 'warning', file: '/p/.claude/rules/a.md' }),
      issue({ ruleId: 'memory/line-count', severity: 'warning', file: '/p/CLAUDE.md' }),
    ];

    computeFixCascades(issues);

    expect(issues[0].fixCascadeCount).toBeUndefined();
    expect(issues[1].fixCascadeCount).toBeUndefined();
  });
});

describe('generateAnalysisHints', () => {
  it('Pattern 1: generates hint when component has lint issues AND audit findings', () => {
    const summary = [
      {
        name: 'reviewer',
        type: 'agent',
        scope: 'project',
        file: '.claude/agents/reviewer.md',
        lintIssues: [{ ruleId: 'agents/frontmatter-valid', severity: 'error', message: 'Missing name' }],
        auditStatus: { used: false, usageCount: 0, sessionsAnalyzed: 5 },
      },
    ];

    const hints = generateAnalysisHints(summary, []);

    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('reviewer');
    expect(hints[0]).toContain('lint issues');
    expect(hints[0]).toContain('audit findings');
  });

  it('Pattern 2: generates hint for fix cascade', () => {
    const issues: LintIssue[] = [
      issue({
        ruleId: 'rules-dir/overly-broad-glob',
        severity: 'warning',
        file: '/p/.claude/rules/broad.md',
        fileRelativePath: '.claude/rules/broad.md',
      }),
    ];
    issues[0].fixCascadeCount = 3;

    const hints = generateAnalysisHints([], issues);

    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('Fixing');
    expect(hints[0]).toContain('3');
    expect(hints[0]).toContain('related findings');
  });

  it('Pattern 3: generates hint for user-scope findings', () => {
    const issues: LintIssue[] = [
      issue({ ruleId: 'settings/dangerous-allow', severity: 'warning', scope: 'user' }),
      issue({ ruleId: 'settings/unknown-key', severity: 'info', scope: 'user' }),
    ];

    const hints = generateAnalysisHints([], issues);

    expect(hints.length).toBeGreaterThan(0);
    const userHint = hints.find((h) => h.includes('user-scope'));
    expect(userHint).toBeDefined();
    expect(userHint).toContain('2 findings');
  });

  it('Pattern 5: generates hint for broad allow + missing deny', () => {
    const issues: LintIssue[] = [
      issue({ ruleId: 'settings/dangerous-allow', severity: 'warning' }),
      issue({ ruleId: 'settings/deny-env-files', severity: 'info' }),
    ];

    const hints = generateAnalysisHints([], issues);

    const secHint = hints.find((h) => h.includes('Broad allow'));
    expect(secHint).toBeDefined();
    expect(secHint).toContain('bypass intended protections');
  });

  it('caps hints at 5 maximum', () => {
    // Create many components that trigger Pattern 1
    const summary = Array.from({ length: 10 }, (_, i) => ({
      name: `agent-${i}`,
      type: 'agent',
      scope: 'project',
      file: `.claude/agents/agent-${i}.md`,
      lintIssues: [{ ruleId: 'agents/frontmatter-valid', severity: 'error', message: 'Missing name' }],
      auditStatus: { used: false, usageCount: 0, sessionsAnalyzed: 5 },
    }));

    const hints = generateAnalysisHints(summary, []);

    expect(hints.length).toBeLessThanOrEqual(5);
  });

  it('Pattern 1 fires after component merge (lint relative path + audit absolute path)', () => {
    // Simulate the merged result: a single component with both lint issues and unused audit
    const summary = [
      {
        name: 'nlp-reviewer',
        type: 'agent',
        scope: 'project-shared',
        file: '.claude/agents/nlp-reviewer.md',
        lintIssues: [
          { ruleId: 'agents/frontmatter-valid', severity: 'error', message: 'Missing name field' },
          { ruleId: 'agents/orphan-agent', severity: 'info', message: 'Never referenced' },
        ],
        auditStatus: { used: false, usageCount: 0, sessionsAnalyzed: 12 },
      },
    ];

    const hints = generateAnalysisHints(summary, []);

    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('nlp-reviewer');
    expect(hints[0]).toContain('lint issues');
    expect(hints[0]).toContain('audit findings');
    expect(hints[0]).toContain('unused');
  });

  it('returns empty array when no co-occurrence patterns exist', () => {
    const summary = [
      {
        name: 'clean-rule',
        type: 'rule',
        scope: 'project',
        file: '.claude/rules/clean.md',
        lintIssues: [],
      },
    ];

    const hints = generateAnalysisHints(summary, []);

    expect(hints).toEqual([]);
  });
});
