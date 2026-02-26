import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { emptyRuleFileRule } from '../../src/rules/rules-dir/empty-rule-file.js';
import { resolve } from '../../src/core/resolver.js';
import type { ConfigInventory, RuleFileInfo } from '../../src/types/index.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

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
    frontmatter: {},
    matchedFiles: [],
    isDead: false,
    ...overrides,
  };
}

describe('rules-dir/empty-rule-file rule', () => {
  const resolved = resolve(makeInventory());

  it('warns for empty rule file (0 bytes / whitespace only)', () => {
    const projectRoot = join(FIXTURES, 'overconfigured');
    const inventory = makeInventory({
      projectRoot,
      rules: [
        makeRuleFileInfo({
          path: join(projectRoot, '.claude', 'rules', 'empty-rule.md'),
          relativePath: '.claude/rules/empty-rule.md',
        }),
      ],
    });
    const issues = emptyRuleFileRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('rules-dir/empty-rule-file');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].category).toBe('rules');
    expect(issues[0].message).toContain('no content');
    expect(issues[0].suggestion).toContain('Add instruction content');
  });

  it('warns for frontmatter-only rule file (no body content)', () => {
    const projectRoot = join(FIXTURES, 'overconfigured');
    const inventory = makeInventory({
      projectRoot,
      rules: [
        makeRuleFileInfo({
          path: join(projectRoot, '.claude', 'rules', 'frontmatter-only.md'),
          relativePath: '.claude/rules/frontmatter-only.md',
        }),
      ],
    });
    const issues = emptyRuleFileRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('rules-dir/empty-rule-file');
    expect(issues[0].message).toContain('only YAML frontmatter');
  });

  it('does not warn for rule files with content (typescript.md)', () => {
    const projectRoot = join(FIXTURES, 'full-project');
    const inventory = makeInventory({
      projectRoot,
      rules: [
        makeRuleFileInfo({
          path: join(projectRoot, '.claude', 'rules', 'typescript.md'),
          relativePath: '.claude/rules/typescript.md',
        }),
      ],
    });
    const issues = emptyRuleFileRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('passes when no rules exist', () => {
    const inventory = makeInventory({ rules: [] });
    const issues = emptyRuleFileRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('skips non-existent rule files', () => {
    const inventory = makeInventory({
      rules: [makeRuleFileInfo({ exists: false })],
    });
    const issues = emptyRuleFileRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('checks multiple rule files and only flags empty ones', () => {
    const projectRoot = join(FIXTURES, 'overconfigured');
    const inventory = makeInventory({
      projectRoot,
      rules: [
        makeRuleFileInfo({
          path: join(projectRoot, '.claude', 'rules', 'empty-rule.md'),
          relativePath: '.claude/rules/empty-rule.md',
        }),
        makeRuleFileInfo({
          path: join(projectRoot, '.claude', 'rules', 'typescript.md'),
          relativePath: '.claude/rules/typescript.md',
        }),
        makeRuleFileInfo({
          path: join(projectRoot, '.claude', 'rules', 'frontmatter-only.md'),
          relativePath: '.claude/rules/frontmatter-only.md',
        }),
      ],
    });
    const issues = emptyRuleFileRule.check(inventory, resolved);
    // empty-rule.md and frontmatter-only.md should be flagged, typescript.md should not
    expect(issues).toHaveLength(2);
  });
});
