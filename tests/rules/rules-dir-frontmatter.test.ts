import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { frontmatterValidRule } from '../../src/rules/rules-dir/frontmatter-valid.js';
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

describe('rules-dir/frontmatter-valid rule', () => {
  const resolved = resolve(makeInventory());

  it('passes for valid frontmatter (full-project typescript.md)', () => {
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
    const issues = frontmatterValidRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('warns for rule file without frontmatter', () => {
    const projectRoot = join(FIXTURES, 'full-project');
    // deploy.md has no frontmatter
    const inventory = makeInventory({
      projectRoot,
      rules: [
        makeRuleFileInfo({
          path: join(projectRoot, '.claude', 'commands', 'deploy.md'),
          relativePath: '.claude/rules/deploy.md',
        }),
      ],
    });
    const issues = frontmatterValidRule.check(inventory, resolved);
    const noFmIssues = issues.filter((i) => i.message.includes('no YAML frontmatter'));
    expect(noFmIssues).toHaveLength(1);
    expect(noFmIssues[0].severity).toBe('warning');
  });

  it('flags invalid paths type (string instead of array)', () => {
    const projectRoot = join(FIXTURES, 'overconfigured');
    const inventory = makeInventory({
      projectRoot,
      rules: [
        makeRuleFileInfo({
          path: join(projectRoot, '.claude', 'rules', 'bad-frontmatter.md'),
          relativePath: '.claude/rules/bad-frontmatter.md',
        }),
      ],
    });
    const issues = frontmatterValidRule.check(inventory, resolved);
    const pathsIssues = issues.filter((i) => i.message.includes('paths'));
    expect(pathsIssues.length).toBeGreaterThan(0);
    // Should be an error severity for invalid paths
    const errorIssues = pathsIssues.filter((i) => i.severity === 'error');
    expect(errorIssues.length).toBeGreaterThan(0);
  });

  it('warns for unknown frontmatter fields', () => {
    const projectRoot = join(FIXTURES, 'overconfigured');
    const inventory = makeInventory({
      projectRoot,
      rules: [
        makeRuleFileInfo({
          path: join(projectRoot, '.claude', 'rules', 'bad-frontmatter.md'),
          relativePath: '.claude/rules/bad-frontmatter.md',
        }),
      ],
    });
    const issues = frontmatterValidRule.check(inventory, resolved);
    const unknownFieldIssues = issues.filter((i) => i.message.includes('unknown'));
    expect(unknownFieldIssues.length).toBeGreaterThan(0);
  });

  it('passes when no rules exist', () => {
    const inventory = makeInventory({ rules: [] });
    const issues = frontmatterValidRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });
});
