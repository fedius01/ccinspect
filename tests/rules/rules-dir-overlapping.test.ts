import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { overlappingRulesRule } from '../../src/rules/rules-dir/overlapping-rules.js';
import { resolve } from '../../src/core/resolver.js';
import type { ConfigInventory, RuleFileInfo } from '../../src/types/index.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const TMP_FIXTURE = join(import.meta.dirname, '..', 'fixtures', '_tmp_overlapping');

function makeInventory(overrides: Partial<ConfigInventory> = {}): ConfigInventory {
  return {
    projectRoot: '/test',
    gitRoot: null,
    userSettings: null,
    projectSettings: null,
    localSettings: null,
    managedSettings: null,
    preferences: null,
    globalClaudeMd: null,
    projectClaudeMd: null,
    localClaudeMd: null,
    subdirClaudeMds: [],
    autoMemory: null,
    autoMemoryTopics: [],
    rules: [],
    projectAgents: [],
    userAgents: [],
    projectCommands: [],
    userCommands: [],
    projectSkills: [],
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

function makeRuleFileInfo(overrides: Partial<RuleFileInfo> = {}): RuleFileInfo {
  return {
    path: '/test/rule.md',
    relativePath: '.claude/rules/rule.md',
    exists: true,
    scope: 'project-shared',
    sizeBytes: 100,
    lineCount: 10,
    estimatedTokens: 50,
    gitTracked: true,
    lastModified: new Date(),
    ...overrides,
  };
}

// Helper to create a temporary rule file and return its RuleFileInfo
function createTempRule(name: string, content: string): RuleFileInfo {
  const rulesDir = join(TMP_FIXTURE, '.claude', 'rules');
  const filePath = join(rulesDir, name);
  writeFileSync(filePath, content, 'utf-8');
  return makeRuleFileInfo({
    path: filePath,
    relativePath: `.claude/rules/${name}`,
  });
}

describe('rules-dir/overlapping-rules rule', () => {
  const resolved = resolve(makeInventory());

  beforeAll(() => {
    mkdirSync(join(TMP_FIXTURE, '.claude', 'rules'), { recursive: true });
    mkdirSync(join(TMP_FIXTURE, 'src', 'lib'), { recursive: true });
    mkdirSync(join(TMP_FIXTURE, 'tests'), { recursive: true });
    mkdirSync(join(TMP_FIXTURE, 'backend'), { recursive: true });

    // Source files for glob matching
    writeFileSync(join(TMP_FIXTURE, 'src', 'app.ts'), '');
    writeFileSync(join(TMP_FIXTURE, 'src', 'app.tsx'), '');
    writeFileSync(join(TMP_FIXTURE, 'src', 'style.css'), '');
    writeFileSync(join(TMP_FIXTURE, 'src', 'lib', 'utils.ts'), '');
    writeFileSync(join(TMP_FIXTURE, 'src', 'app.test.ts'), '');
    writeFileSync(join(TMP_FIXTURE, 'tests', 'e2e.test.ts'), '');
    writeFileSync(join(TMP_FIXTURE, 'backend', 'server.py'), '');
  });

  afterAll(() => {
    rmSync(TMP_FIXTURE, { recursive: true, force: true });
  });

  // --- Existing test cases (updated for new evidence format) ---

  it('detects overlapping rules in overconfigured fixture', () => {
    const projectRoot = join(FIXTURES, 'overconfigured');
    const inventory = makeInventory({
      projectRoot,
      rules: [
        makeRuleFileInfo({
          path: join(projectRoot, '.claude', 'rules', 'typescript.md'),
          relativePath: '.claude/rules/typescript.md',
        }),
        makeRuleFileInfo({
          path: join(projectRoot, '.claude', 'rules', 'ts-strict.md'),
          relativePath: '.claude/rules/ts-strict.md',
        }),
      ],
    });
    const issues = overlappingRulesRule.check(inventory, resolved);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].ruleId).toBe('rules-dir/overlapping-rules');
    expect(issues[0].severity).toBe('info');
    expect(issues[0].category).toBe('rules');
  });

  it('passes when rules have non-overlapping scopes', () => {
    const projectRoot = join(FIXTURES, 'full-project');
    const inventory = makeInventory({
      projectRoot,
      rules: [
        makeRuleFileInfo({
          path: join(projectRoot, '.claude', 'rules', 'typescript.md'),
          relativePath: '.claude/rules/typescript.md',
        }),
        makeRuleFileInfo({
          path: join(projectRoot, '.claude', 'rules', 'testing.md'),
          relativePath: '.claude/rules/testing.md',
        }),
      ],
    });
    const issues = overlappingRulesRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('passes when no rules exist', () => {
    const inventory = makeInventory({ rules: [] });
    const issues = overlappingRulesRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('passes with single rule', () => {
    const projectRoot = join(FIXTURES, 'overconfigured');
    const inventory = makeInventory({
      projectRoot,
      rules: [
        makeRuleFileInfo({
          path: join(projectRoot, '.claude', 'rules', 'typescript.md'),
          relativePath: '.claude/rules/typescript.md',
        }),
      ],
    });
    const issues = overlappingRulesRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('includes evidence with glob patterns when rules overlap', () => {
    const projectRoot = join(FIXTURES, 'overconfigured');
    const inventory = makeInventory({
      projectRoot,
      rules: [
        makeRuleFileInfo({
          path: join(projectRoot, '.claude', 'rules', 'typescript.md'),
          relativePath: '.claude/rules/typescript.md',
        }),
        makeRuleFileInfo({
          path: join(projectRoot, '.claude', 'rules', 'ts-strict.md'),
          relativePath: '.claude/rules/ts-strict.md',
        }),
      ],
    });
    const issues = overlappingRulesRule.check(inventory, resolved);
    expect(issues.length).toBeGreaterThan(0);

    const issue = issues[0];
    expect(issue.evidence).toBeDefined();
    expect(Array.isArray(issue.evidence)).toBe(true);

    // Evidence now shows glob patterns, not file counts
    expect(issue.evidence![0].content).toMatch(/globs:/);
    expect(issue.evidence![1].content).toMatch(/globs:/);
  });

  // --- Global-rule cluster ---

  describe('global rule cluster', () => {
    it('3 rules with no frontmatter → 1 grouped issue', () => {
      const ruleA = createTempRule('style.md', '# Style\nUse consistent formatting.');
      const ruleB = createTempRule('naming.md', '# Naming\nUse descriptive names.');
      const ruleC = createTempRule('docs.md', '# Docs\nDocument all public APIs.');

      const inventory = makeInventory({
        projectRoot: TMP_FIXTURE,
        rules: [ruleA, ruleB, ruleC],
      });
      const issues = overlappingRulesRule.check(inventory, resolved);

      const clusterIssues = issues.filter((i) => i.message.includes('rule files have no scope'));
      expect(clusterIssues).toHaveLength(1);
      expect(clusterIssues[0].message).toContain('3 rule files have no scope');
      expect(clusterIssues[0].message).toContain('style.md');
      expect(clusterIssues[0].message).toContain('naming.md');
      expect(clusterIssues[0].message).toContain('docs.md');

      expect(clusterIssues[0].evidence).toBeDefined();
      expect(clusterIssues[0].evidence!.length).toBe(3);
      for (const ev of clusterIssues[0].evidence!) {
        expect(ev.content).toMatch(/global scope \(no-frontmatter\)/);
      }
    });

    it('1 rule with alwaysApply + 1 rule with no frontmatter → 1 grouped issue', () => {
      const ruleA = createTempRule(
        'always-on.md',
        '---\nalwaysApply: true\n---\n# Always On\nApply everywhere.',
      );
      const ruleB = createTempRule('plain.md', '# Plain\nNo frontmatter here.');

      const inventory = makeInventory({
        projectRoot: TMP_FIXTURE,
        rules: [ruleA, ruleB],
      });
      const issues = overlappingRulesRule.check(inventory, resolved);

      const clusterIssues = issues.filter((i) => i.message.includes('rule files have no scope'));
      expect(clusterIssues).toHaveLength(1);
      expect(clusterIssues[0].message).toContain('2 rule files have no scope');

      const reasons = clusterIssues[0].evidence!.map((e) => e.content);
      expect(reasons).toContain('global scope (always-apply)');
      expect(reasons).toContain('global scope (no-frontmatter)');
    });

    it('1 global rule alone → no cluster issue', () => {
      const ruleA = createTempRule('solo.md', '# Solo\nOne global rule alone.');

      const inventory = makeInventory({
        projectRoot: TMP_FIXTURE,
        rules: [ruleA],
      });
      const issues = overlappingRulesRule.check(inventory, resolved);

      const clusterIssues = issues.filter((i) => i.message.includes('rule files have no scope'));
      expect(clusterIssues).toHaveLength(0);
    });
  });

  // --- Global-vs-scoped ---

  describe('global vs scoped', () => {
    it('1 global rule + 1 scoped rule → 1 overlap issue', () => {
      const globalRule = createTempRule('global-rule.md', '# Global\nApplies everywhere.');
      const scopedRule = createTempRule(
        'scoped-rule.md',
        '---\nglobs:\n  - "src/**/*.ts"\n---\n# Scoped\nOnly for TypeScript.',
      );

      const inventory = makeInventory({
        projectRoot: TMP_FIXTURE,
        rules: [globalRule, scopedRule],
      });
      const issues = overlappingRulesRule.check(inventory, resolved);

      const globalVsScoped = issues.filter((i) => i.message.includes('global, no globs'));
      expect(globalVsScoped).toHaveLength(1);
      expect(globalVsScoped[0].message).toContain('global-rule.md');
      expect(globalVsScoped[0].message).toContain('scoped-rule.md');
    });

    it('global rule overlaps every scoped rule', () => {
      const globalRule = createTempRule('catch-all.md', '# Catch All\nNo globs.');
      const scopedA = createTempRule(
        'ts-rules.md',
        '---\nglobs:\n  - "src/**/*.ts"\n---\n# TS Rules',
      );
      const scopedB = createTempRule(
        'css-rules.md',
        '---\nglobs:\n  - "src/**/*.css"\n---\n# CSS Rules',
      );

      const inventory = makeInventory({
        projectRoot: TMP_FIXTURE,
        rules: [globalRule, scopedA, scopedB],
      });
      const issues = overlappingRulesRule.check(inventory, resolved);

      const globalVsScoped = issues.filter((i) => i.message.includes('global, no globs'));
      expect(globalVsScoped).toHaveLength(2);
    });
  });

  // --- Dead rules excluded ---

  describe('dead rules excluded', () => {
    it('2 rules with globs matching no files → 0 overlap issues', () => {
      const ruleA = createTempRule(
        'dead-a.md',
        '---\nglobs:\n  - "nonexistent-dir-a/**"\n---\n# Dead A',
      );
      const ruleB = createTempRule(
        'dead-b.md',
        '---\nglobs:\n  - "nonexistent-dir-b/**"\n---\n# Dead B',
      );

      const inventory = makeInventory({
        projectRoot: TMP_FIXTURE,
        rules: [ruleA, ruleB],
      });
      const issues = overlappingRulesRule.check(inventory, resolved);
      expect(issues).toHaveLength(0);
    });

    it('1 dead rule + 1 scoped rule → 0 overlap issues from dead rule', () => {
      const deadRule = createTempRule(
        'dead-rule.md',
        '---\nglobs:\n  - "nonexistent/**"\n---\n# Dead Rule',
      );
      const scopedRule = createTempRule(
        'live-rule.md',
        '---\nglobs:\n  - "src/**/*.ts"\n---\n# Live Rule',
      );

      const inventory = makeInventory({
        projectRoot: TMP_FIXTURE,
        rules: [deadRule, scopedRule],
      });
      const issues = overlappingRulesRule.check(inventory, resolved);
      expect(issues).toHaveLength(0);
    });
  });

  // --- Scoped-vs-scoped with extension precision ---

  describe('scoped vs scoped — extension precision', () => {
    it('same directory, different extensions → no overlap', () => {
      const ruleA = createTempRule(
        'ts-only.md',
        '---\nglobs:\n  - "src/**/*.ts"\n---\n# TS Only',
      );
      const ruleB = createTempRule(
        'css-only.md',
        '---\nglobs:\n  - "src/**/*.css"\n---\n# CSS Only',
      );

      const inventory = makeInventory({
        projectRoot: TMP_FIXTURE,
        rules: [ruleA, ruleB],
      });
      const issues = overlappingRulesRule.check(inventory, resolved);
      expect(issues).toHaveLength(0);
    });

    it('same directory, same extension → overlap', () => {
      const ruleA = createTempRule(
        'broad-ts.md',
        '---\nglobs:\n  - "src/**/*.ts"\n---\n# Broad TS',
      );
      const ruleB = createTempRule(
        'lib-all.md',
        '---\nglobs:\n  - "src/lib/**"\n---\n# Lib All',
      );

      const inventory = makeInventory({
        projectRoot: TMP_FIXTURE,
        rules: [ruleA, ruleB],
      });
      const issues = overlappingRulesRule.check(inventory, resolved);
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain('overlapping scope');
    });

    it('compound extension overlap', () => {
      const ruleA = createTempRule(
        'test-files.md',
        '---\nglobs:\n  - "**/*.test.ts"\n---\n# Test Files',
      );
      const ruleB = createTempRule(
        'all-ts.md',
        '---\nglobs:\n  - "src/**/*.ts"\n---\n# All TS',
      );

      const inventory = makeInventory({
        projectRoot: TMP_FIXTURE,
        rules: [ruleA, ruleB],
      });
      const issues = overlappingRulesRule.check(inventory, resolved);
      // *.ts matches foo.test.ts — picomatch treats .test.ts as matching *.ts
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain('overlapping scope');
    });
  });

  // --- alwaysApply semantics ---

  describe('alwaysApply', () => {
    it('alwaysApply: true with globs still treated as global', () => {
      const ruleA = createTempRule(
        'always-scoped.md',
        '---\nalwaysApply: true\nglobs:\n  - "src/**"\n---\n# Always Apply with globs',
      );
      const ruleB = createTempRule(
        'normal-scoped.md',
        '---\nglobs:\n  - "tests/**/*.ts"\n---\n# Normal Scoped',
      );

      const inventory = makeInventory({
        projectRoot: TMP_FIXTURE,
        rules: [ruleA, ruleB],
      });
      const issues = overlappingRulesRule.check(inventory, resolved);

      const globalVsScoped = issues.filter((i) => i.message.includes('global, no globs'));
      expect(globalVsScoped).toHaveLength(1);
      expect(globalVsScoped[0].evidence![0].content).toBe('global scope (always-apply)');
    });
  });

  // --- Grouped global-vs-scoped for large products ---

  describe('grouped global-vs-scoped', () => {
    it('many global rules × scoped rules → grouped issue when >10 pairs', () => {
      const rules: RuleFileInfo[] = [];

      // Create 3 global rules
      for (let i = 0; i < 3; i++) {
        rules.push(createTempRule(`global-${i}.md`, `# Global ${i}\nNo frontmatter.`));
      }
      // Create 4 scoped rules with globs matching existing files (3*4 = 12 > 10 threshold)
      const scopedGlobs = ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.css', 'tests/**/*.ts'];
      for (let i = 0; i < 4; i++) {
        rules.push(
          createTempRule(
            `scoped-${i}.md`,
            `---\nglobs:\n  - "${scopedGlobs[i]}"\n---\n# Scoped ${i}`,
          ),
        );
      }

      const inventory = makeInventory({
        projectRoot: TMP_FIXTURE,
        rules,
      });
      const issues = overlappingRulesRule.check(inventory, resolved);

      // Should have: 1 global cluster issue + 1 grouped global-vs-scoped issue
      const clusterIssues = issues.filter((i) => i.message.includes('rule files have no scope'));
      const groupedIssues = issues.filter((i) =>
        i.message.includes('global rules overlap with all'),
      );
      expect(clusterIssues).toHaveLength(1);
      expect(groupedIssues).toHaveLength(1);
      expect(groupedIssues[0].message).toContain('3 global rules overlap with all 4 scoped rules');
    });
  });
});
