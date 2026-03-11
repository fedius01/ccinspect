import { describe, it, expect, vi } from 'vitest';
import { produceUtilizationReport } from '../../src/core/transcript-utilization.js';
import type { ConfigInventory, FileInfo, RuleFileInfo } from '../../src/types/inventory.js';
import type { AggregateStats, FileActivity, UsageSummary } from '../../src/types/transcript.js';

// Mock the rules parser to avoid needing actual files on disk
vi.mock('../../src/parsers/rules-md.js', () => ({
  parseRuleMd: (filePath: string, _projectRoot: string) => {
    // Return mock frontmatter based on filePath convention:
    // Files with "scoped" in path have paths: frontmatter
    // Files with "unconditional" in path have no paths: frontmatter
    const mockData = MOCK_RULE_DATA.get(filePath);
    if (!mockData) return null;
    return mockData;
  },
}));

// Mock MCP parser to avoid disk reads
vi.mock('../../src/parsers/mcp-json.js', () => ({
  parseMcpJson: () => null,
}));

// Registry for mock rule data keyed by file path
const MOCK_RULE_DATA = new Map<string, {
  filePath: string;
  frontmatter: Record<string, unknown>;
  hasFrontmatter: boolean;
  content: string;
  matchedFiles: string[];
  isDead: boolean;
}>();

// ---- Helpers ----

function makeRuleFile(overrides: Partial<RuleFileInfo> = {}): RuleFileInfo {
  return {
    path: '/project/.claude/rules/test.md',
    relativePath: '.claude/rules/test.md',
    exists: true,
    scope: 'project-shared',
    sizeBytes: 200,
    lineCount: 20,
    estimatedTokens: 100,
    gitTracked: true,
    lastModified: new Date('2026-03-01'),
    ...overrides,
  };
}

function registerPathScopedRule(filePath: string, globs: string[]): void {
  MOCK_RULE_DATA.set(filePath, {
    filePath,
    frontmatter: { paths: globs },
    hasFrontmatter: true,
    content: 'Rule content here',
    matchedFiles: [],
    isDead: false,
  });
}

function registerUnconditionalRule(filePath: string, content = 'Rule content here'): void {
  MOCK_RULE_DATA.set(filePath, {
    filePath,
    frontmatter: {},
    hasFrontmatter: false,
    content,
    matchedFiles: [],
    isDead: false,
  });
}

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

function makeActivity(overrides: Partial<FileActivity> = {}): FileActivity {
  return {
    readCount: 0,
    editCount: 0,
    writeCount: 0,
    bashCount: 0,
    sessions: new Set<string>(),
    ...overrides,
  };
}

const DEFAULT_OPTIONS = { days: 30 };

// ---- Tests ----

describe('rules utilization', () => {
  beforeEach(() => {
    MOCK_RULE_DATA.clear();
  });

  describe('path-scoped rules', () => {
    it('detects matching files Read (rule likely loaded)', () => {
      const rulePath = '/project/.claude/rules/react.md';
      registerPathScopedRule(rulePath, ['src/**/*.tsx']);

      const inventory = makeInventory({
        rules: [makeRuleFile({ path: rulePath, relativePath: '.claude/rules/react.md' })],
      });
      const stats = makeStats({
        fileActivity: new Map([
          ['src/components/Button.tsx', makeActivity({
            readCount: 5,
            editCount: 3,
            sessions: new Set(['s1', 's2', 's3']),
          })],
        ]),
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      expect(report.rules.pathScoped).toHaveLength(1);
      const rule = report.rules.pathScoped[0];
      expect(rule.name).toBe('react.md');
      expect(rule.ruleType).toBe('path-scoped');
      expect(rule.globs).toEqual(['src/**/*.tsx']);
      expect(rule.matchingFilesRead).toBe(1);
      expect(rule.matchingFilesEdited).toBe(1);
      expect(rule.matchingFilesEditedWithoutRead).toBe(0);
      expect(rule.sessionsWithMatch).toBe(3);
      expect(rule.confidence).toBe('strong');
    });

    it('detects dormant rule (no matching files touched)', () => {
      const rulePath = '/project/.claude/rules/styles.md';
      registerPathScopedRule(rulePath, ['**/*.css']);

      const inventory = makeInventory({
        rules: [makeRuleFile({ path: rulePath })],
      });
      // Only .ts files in activity, no .css
      const stats = makeStats({
        fileActivity: new Map([
          ['src/app.ts', makeActivity({ readCount: 10, editCount: 5, sessions: new Set(['s1']) })],
        ]),
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      const rule = report.rules.pathScoped[0];
      expect(rule.matchingFilesRead).toBe(0);
      expect(rule.matchingFilesEdited).toBe(0);
      expect(rule.matchingFilesEditedWithoutRead).toBe(0);
      expect(rule.confidence).toBe('exact');
    });

    it('detects write-blindness (Edit without Read)', () => {
      const rulePath = '/project/.claude/rules/security.md';
      registerPathScopedRule(rulePath, ['src/auth/**']);

      const inventory = makeInventory({
        rules: [makeRuleFile({ path: rulePath })],
      });
      const stats = makeStats({
        fileActivity: new Map([
          ['src/auth/login.ts', makeActivity({
            readCount: 0,
            editCount: 3,
            sessions: new Set(['s1', 's2']),
          })],
        ]),
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      const rule = report.rules.pathScoped[0];
      expect(rule.matchingFilesEditedWithoutRead).toBe(1);
      expect(rule.writeBlindnessSessions).toBe(2);
      expect(rule.matchingFilesRead).toBe(0);
      expect(rule.matchingFilesEdited).toBe(1);
      expect(rule.confidence).toBe('strong');
    });

    it('includes file paths in write-blindness data', () => {
      const rulePath = '/project/.claude/rules/auth-rules.md';
      registerPathScopedRule(rulePath, ['src/auth/**']);

      const inventory = makeInventory({
        rules: [makeRuleFile({ path: rulePath })],
      });
      const stats = makeStats({
        fileActivity: new Map([
          ['src/auth/login.ts', makeActivity({
            readCount: 0,
            editCount: 3,
            sessions: new Set(['s1', 's2']),
          })],
          ['src/auth/config.ts', makeActivity({
            readCount: 0,
            editCount: 1,
            sessions: new Set(['s3']),
          })],
        ]),
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      const rule = report.rules.pathScoped[0];
      expect(rule.writeBlindnessFiles).toBeDefined();
      expect(rule.writeBlindnessFiles).toHaveLength(2);
      expect(rule.writeBlindnessFiles![0].filePath).toBe('src/auth/login.ts');
      expect(rule.writeBlindnessFiles![0].editSessions).toBe(2);
      expect(rule.writeBlindnessFiles![1].filePath).toBe('src/auth/config.ts');
      expect(rule.writeBlindnessFiles![1].editSessions).toBe(1);
    });

    it('sorts write-blindness files by session count descending', () => {
      const rulePath = '/project/.claude/rules/backend.md';
      registerPathScopedRule(rulePath, ['src/**']);

      const inventory = makeInventory({
        rules: [makeRuleFile({ path: rulePath })],
      });
      const stats = makeStats({
        fileActivity: new Map([
          ['src/a.ts', makeActivity({ editCount: 1, sessions: new Set(['s1']) })],
          ['src/b.ts', makeActivity({ editCount: 1, sessions: new Set(['s1', 's2', 's3']) })],
          ['src/c.ts', makeActivity({ editCount: 1, sessions: new Set(['s1', 's2']) })],
        ]),
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      const rule = report.rules.pathScoped[0];
      expect(rule.writeBlindnessFiles).toBeDefined();
      expect(rule.writeBlindnessFiles![0].editSessions).toBe(3); // b.ts first
      expect(rule.writeBlindnessFiles![1].editSessions).toBe(2); // c.ts second
      expect(rule.writeBlindnessFiles![2].editSessions).toBe(1); // a.ts last
    });

    it('limits write-blindness files to top 10', () => {
      const rulePath = '/project/.claude/rules/many-files.md';
      registerPathScopedRule(rulePath, ['src/**']);

      const inventory = makeInventory({
        rules: [makeRuleFile({ path: rulePath })],
      });

      // Create 15 files with write-blindness
      const fileActivity = new Map<string, FileActivity>();
      for (let i = 0; i < 15; i++) {
        fileActivity.set(`src/file${i}.ts`, makeActivity({
          editCount: 1,
          sessions: new Set([`s${i}`]),
        }));
      }

      const stats = makeStats({ fileActivity });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      const rule = report.rules.pathScoped[0];
      expect(rule.writeBlindnessFiles).toBeDefined();
      expect(rule.writeBlindnessFiles).toHaveLength(10);
    });

    it('omits writeBlindnessFiles when no write-blindness', () => {
      const rulePath = '/project/.claude/rules/clean.md';
      registerPathScopedRule(rulePath, ['src/**']);

      const inventory = makeInventory({
        rules: [makeRuleFile({ path: rulePath })],
      });
      const stats = makeStats({
        fileActivity: new Map([
          ['src/app.ts', makeActivity({ readCount: 2, editCount: 1, sessions: new Set(['s1']) })],
        ]),
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      const rule = report.rules.pathScoped[0];
      expect(rule.writeBlindnessFiles).toBeUndefined();
    });

    it('does not flag write-blindness when file was Read AND Edited', () => {
      const rulePath = '/project/.claude/rules/api-style.md';
      registerPathScopedRule(rulePath, ['src/api/**']);

      const inventory = makeInventory({
        rules: [makeRuleFile({ path: rulePath })],
      });
      const stats = makeStats({
        fileActivity: new Map([
          ['src/api/routes.ts', makeActivity({
            readCount: 2,
            editCount: 4,
            sessions: new Set(['s1', 's2']),
          })],
        ]),
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      const rule = report.rules.pathScoped[0];
      expect(rule.matchingFilesEditedWithoutRead).toBe(0);
      expect(rule.writeBlindnessSessions).toBe(0);
      expect(rule.matchingFilesRead).toBe(1);
      expect(rule.matchingFilesEdited).toBe(1);
    });

    it('handles multiple globs on one rule', () => {
      const rulePath = '/project/.claude/rules/ts-testing.md';
      registerPathScopedRule(rulePath, ['src/**/*.ts', 'tests/**/*.test.ts']);

      const inventory = makeInventory({
        rules: [makeRuleFile({ path: rulePath })],
      });
      const stats = makeStats({
        fileActivity: new Map([
          ['src/core/scanner.ts', makeActivity({ readCount: 3, sessions: new Set(['s1']) })],
          ['tests/core/scanner.test.ts', makeActivity({ readCount: 1, editCount: 2, sessions: new Set(['s2']) })],
        ]),
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      const rule = report.rules.pathScoped[0];
      expect(rule.matchingFilesRead).toBe(2);
      expect(rule.sessionsWithMatch).toBe(2); // s1 and s2
    });

    it('handles absolute paths in file activity by normalizing to relative', () => {
      const rulePath = '/project/.claude/rules/react.md';
      registerPathScopedRule(rulePath, ['src/**/*.tsx']);

      const inventory = makeInventory({
        rules: [makeRuleFile({ path: rulePath })],
      });
      // fileActivity keys are absolute paths
      const stats = makeStats({
        fileActivity: new Map([
          ['/project/src/components/Button.tsx', makeActivity({
            readCount: 2,
            sessions: new Set(['s1']),
          })],
        ]),
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      const rule = report.rules.pathScoped[0];
      expect(rule.matchingFilesRead).toBe(1);
    });

    it('does not flag Write-only files as write-blindness (new file creation)', () => {
      const rulePath = '/project/.claude/rules/python.md';
      registerPathScopedRule(rulePath, ['**/*.py']);

      const inventory = makeInventory({
        rules: [makeRuleFile({ path: rulePath })],
      });
      const stats = makeStats({
        fileActivity: new Map([
          ['script.py', makeActivity({
            readCount: 0,
            editCount: 0,
            writeCount: 2, // Write creates new file — not write-blindness
            sessions: new Set(['s1']),
          })],
        ]),
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      const rule = report.rules.pathScoped[0];
      // Write-only files are NOT write-blindness — Claude created a new file
      expect(rule.matchingFilesEditedWithoutRead).toBe(0);
      // But they still count as "modified" for general activity tracking
      expect(rule.matchingFilesEdited).toBe(1);
    });

    it('flags files with both Write and Edit but no Read as write-blindness', () => {
      const rulePath = '/project/.claude/rules/python.md';
      registerPathScopedRule(rulePath, ['**/*.py']);

      const inventory = makeInventory({
        rules: [makeRuleFile({ path: rulePath })],
      });
      const stats = makeStats({
        fileActivity: new Map([
          ['script.py', makeActivity({
            readCount: 0,
            editCount: 2,
            writeCount: 1, // Write + Edit without Read
            sessions: new Set(['s1']),
          })],
        ]),
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      const rule = report.rules.pathScoped[0];
      // Edit happened without Read — that IS write-blindness
      expect(rule.matchingFilesEditedWithoutRead).toBe(1);
      expect(rule.matchingFilesEdited).toBe(1);
    });

    it('does not flag Write-only files with Read as write-blindness', () => {
      const rulePath = '/project/.claude/rules/python.md';
      registerPathScopedRule(rulePath, ['**/*.py']);

      const inventory = makeInventory({
        rules: [makeRuleFile({ path: rulePath })],
      });
      const stats = makeStats({
        fileActivity: new Map([
          ['script.py', makeActivity({
            readCount: 1,
            editCount: 0,
            writeCount: 3,
            sessions: new Set(['s1']),
          })],
        ]),
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      const rule = report.rules.pathScoped[0];
      expect(rule.matchingFilesEditedWithoutRead).toBe(0);
      expect(rule.matchingFilesEdited).toBe(1);
      expect(rule.matchingFilesRead).toBe(1);
    });
  });

  describe('unconditional rules', () => {
    it('reports token cost for unconditional rule', () => {
      const rulePath = '/project/.claude/rules/code-style.md';
      registerUnconditionalRule(rulePath);

      const inventory = makeInventory({
        rules: [makeRuleFile({ path: rulePath, estimatedTokens: 142 })],
      });
      const stats = makeStats();

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      expect(report.rules.unconditional).toHaveLength(1);
      const rule = report.rules.unconditional[0];
      expect(rule.name).toBe('code-style.md');
      expect(rule.ruleType).toBe('unconditional');
      expect(rule.estimatedTokens).toBe(142);
      expect(rule.confidence).toBe('exact');
    });

    it('sums total unconditional tokens', () => {
      const paths = [
        '/project/.claude/rules/code-style.md',
        '/project/.claude/rules/testing.md',
        '/project/.claude/rules/naming.md',
      ];
      for (const p of paths) registerUnconditionalRule(p);

      const inventory = makeInventory({
        rules: [
          makeRuleFile({ path: paths[0], estimatedTokens: 100 }),
          makeRuleFile({ path: paths[1], estimatedTokens: 200 }),
          makeRuleFile({ path: paths[2], estimatedTokens: 150 }),
        ],
      });
      const stats = makeStats();

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      expect(report.rules.totalUnconditionalTokens).toBe(450);
      expect(report.rules.unconditional).toHaveLength(3);
    });
  });

  describe('mixed rules', () => {
    it('splits path-scoped and unconditional rules correctly', () => {
      const scopedPath1 = '/project/.claude/rules/react.md';
      const scopedPath2 = '/project/.claude/rules/api-style.md';
      const unconditionalPath1 = '/project/.claude/rules/code-style.md';
      const unconditionalPath2 = '/project/.claude/rules/testing.md';

      registerPathScopedRule(scopedPath1, ['src/**/*.tsx']);
      registerPathScopedRule(scopedPath2, ['src/api/**']);
      registerUnconditionalRule(unconditionalPath1);
      registerUnconditionalRule(unconditionalPath2);

      const inventory = makeInventory({
        rules: [
          makeRuleFile({ path: scopedPath1 }),
          makeRuleFile({ path: scopedPath2 }),
          makeRuleFile({ path: unconditionalPath1, estimatedTokens: 100 }),
          makeRuleFile({ path: unconditionalPath2, estimatedTokens: 200 }),
        ],
      });
      const stats = makeStats({
        fileActivity: new Map([
          ['src/components/App.tsx', makeActivity({ readCount: 3, sessions: new Set(['s1']) })],
        ]),
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      expect(report.rules.pathScoped).toHaveLength(2);
      expect(report.rules.unconditional).toHaveLength(2);
      expect(report.rules.totalUnconditionalTokens).toBe(300);

      // react.md should have matches, api-style.md should not
      const react = report.rules.pathScoped.find(r => r.name === 'react.md');
      const api = report.rules.pathScoped.find(r => r.name === 'api-style.md');
      expect(react?.matchingFilesRead).toBe(1);
      expect(api?.matchingFilesRead).toBe(0);
    });

    it('handles empty rules (no rules configured)', () => {
      const inventory = makeInventory({ rules: [], userRules: [] });
      const stats = makeStats();

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      expect(report.rules.pathScoped).toHaveLength(0);
      expect(report.rules.unconditional).toHaveLength(0);
      expect(report.rules.totalUnconditionalTokens).toBe(0);
    });
  });

  describe('user-scope rules', () => {
    it('includes user-scope rules with correct scope', () => {
      const userRulePath = '/Users/dev/.claude/rules/global-style.md';
      registerUnconditionalRule(userRulePath);

      const inventory = makeInventory({
        userRules: [makeRuleFile({
          path: userRulePath,
          scope: 'user',
          estimatedTokens: 75,
        })],
      });
      const stats = makeStats();

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      expect(report.rules.unconditional).toHaveLength(1);
      expect(report.rules.unconditional[0].scope).toBe('user');
      expect(report.rules.unconditional[0].estimatedTokens).toBe(75);
    });

    it('includes user-scope path-scoped rules', () => {
      const userRulePath = '/Users/dev/.claude/rules/user-react.md';
      registerPathScopedRule(userRulePath, ['**/*.tsx']);

      const inventory = makeInventory({
        userRules: [makeRuleFile({ path: userRulePath, scope: 'user' })],
      });
      const stats = makeStats({
        fileActivity: new Map([
          ['src/App.tsx', makeActivity({ readCount: 1, sessions: new Set(['s1']) })],
        ]),
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      expect(report.rules.pathScoped).toHaveLength(1);
      expect(report.rules.pathScoped[0].scope).toBe('user');
      expect(report.rules.pathScoped[0].matchingFilesRead).toBe(1);
    });
  });

  describe('CLI-grounded command-preference filtering', () => {
    it('keeps extraction when preferred term appears in Bash commands', () => {
      const rulePath = '/project/.claude/rules/tooling.md';
      registerUnconditionalRule(rulePath, 'Always use pnpm for package management.');

      const inventory = makeInventory({
        rules: [makeRuleFile({ path: rulePath, estimatedTokens: 50 })],
      });
      const stats = makeStats({
        bashCommandTokens: new Set(['pnpm', 'install', 'run', 'test']),
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);
      const rule = report.rules.unconditional[0];
      expect(rule.extractedInstructions).toBeDefined();
      expect(rule.extractedInstructions!.length).toBeGreaterThan(0);
      expect(rule.extractedInstructions![0].preferred).toBe('pnpm');
    });

    it('drops extraction when term is prose, not a CLI tool', () => {
      const rulePath = '/project/.claude/rules/testing-style.md';
      registerUnconditionalRule(rulePath, "Don't use black-box testing approaches.");

      const inventory = makeInventory({
        rules: [makeRuleFile({ path: rulePath, estimatedTokens: 50 })],
      });
      const stats = makeStats({
        bashCommandTokens: new Set(['npm', 'run', 'test', 'vitest']),
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);
      const rule = report.rules.unconditional[0];
      // "black-box" not in any Bash command → filtered out
      expect(rule.extractedInstructions).toBeUndefined();
    });

    it('keeps extraction when avoided term appears in Bash commands', () => {
      const rulePath = '/project/.claude/rules/tooling.md';
      registerUnconditionalRule(rulePath, 'Use pnpm, not npm.');

      const inventory = makeInventory({
        rules: [makeRuleFile({ path: rulePath, estimatedTokens: 50 })],
      });
      // Only npm in CLI tokens (user is still using npm despite the rule)
      const stats = makeStats({
        bashCommandTokens: new Set(['npm', 'install', 'run']),
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);
      const rule = report.rules.unconditional[0];
      expect(rule.extractedInstructions).toBeDefined();
      expect(rule.extractedInstructions!.length).toBeGreaterThan(0);
    });

    it('drops all command-preferences when no Bash calls exist', () => {
      const rulePath = '/project/.claude/rules/tooling.md';
      registerUnconditionalRule(rulePath, 'Always use pnpm for package management.');

      const inventory = makeInventory({
        rules: [makeRuleFile({ path: rulePath, estimatedTokens: 50 })],
      });
      // Empty bash tokens — no Bash calls at all
      const stats = makeStats({
        bashCommandTokens: new Set(),
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);
      const rule = report.rules.unconditional[0];
      // Nothing to validate against → filtered out
      expect(rule.extractedInstructions).toBeUndefined();
    });

    it('does not filter non-command-preference patterns', () => {
      const rulePath = '/project/.claude/rules/workflow.md';
      registerUnconditionalRule(rulePath, 'Run tests after every edit.');

      const inventory = makeInventory({
        rules: [makeRuleFile({ path: rulePath, estimatedTokens: 50 })],
      });
      // Even with empty bash tokens, test-workflow patterns are kept
      const stats = makeStats({
        bashCommandTokens: new Set(),
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);
      const rule = report.rules.unconditional[0];
      expect(rule.extractedInstructions).toBeDefined();
      expect(rule.extractedInstructions![0].patternType).toBe('test-workflow');
    });
  });

  describe('edge cases', () => {
    it('handles rule parser returning null gracefully', () => {
      // Don't register any mock data — parser returns null
      const inventory = makeInventory({
        rules: [makeRuleFile({ path: '/project/.claude/rules/broken.md' })],
      });
      const stats = makeStats();

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      // Rule that can't be parsed is treated as unconditional (null globs)
      // Actually, parseRuleMd returns null → extractRuleGlobs returns null → unconditional
      // But wait — if parseRuleMd returns null, we can't tell if it has frontmatter
      // The implementation treats null as no globs → unconditional. This is safe.
      expect(report.rules.pathScoped).toHaveLength(0);
      expect(report.rules.unconditional).toHaveLength(1);
    });

    it('handles empty file activity with path-scoped rules', () => {
      const rulePath = '/project/.claude/rules/react.md';
      registerPathScopedRule(rulePath, ['src/**/*.tsx']);

      const inventory = makeInventory({
        rules: [makeRuleFile({ path: rulePath })],
      });
      const stats = makeStats({ fileActivity: new Map() });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      const rule = report.rules.pathScoped[0];
      expect(rule.matchingFilesRead).toBe(0);
      expect(rule.matchingFilesEdited).toBe(0);
      expect(rule.matchingFilesEditedWithoutRead).toBe(0);
      expect(rule.confidence).toBe('exact');
    });

    it('counts multiple matching files separately', () => {
      const rulePath = '/project/.claude/rules/ts-all.md';
      registerPathScopedRule(rulePath, ['src/**/*.ts']);

      const inventory = makeInventory({
        rules: [makeRuleFile({ path: rulePath })],
      });
      const stats = makeStats({
        fileActivity: new Map([
          ['src/a.ts', makeActivity({ readCount: 1, editCount: 1, sessions: new Set(['s1']) })],
          ['src/b.ts', makeActivity({ readCount: 2, sessions: new Set(['s2']) })],
          ['src/c.ts', makeActivity({ editCount: 3, sessions: new Set(['s3']) })], // write-blind
        ]),
      });

      const report = produceUtilizationReport(inventory, stats, DEFAULT_OPTIONS);

      const rule = report.rules.pathScoped[0];
      expect(rule.matchingFilesRead).toBe(2);       // a.ts, b.ts
      expect(rule.matchingFilesEdited).toBe(2);      // a.ts, c.ts
      expect(rule.matchingFilesEditedWithoutRead).toBe(1); // c.ts only
      expect(rule.sessionsWithMatch).toBe(2);        // s1, s2
      expect(rule.writeBlindnessSessions).toBe(1);   // s3
    });
  });
});
