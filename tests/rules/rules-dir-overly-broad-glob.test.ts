import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { overlyBroadGlobRule } from '../../src/rules/rules-dir/overly-broad-glob.js';
import { createEmptyResolvedConfig } from '../../src/core/resolver.js';
import type { ConfigInventory, FileInfo } from '../../src/types/index.js';

function makeInventory(overrides: Partial<ConfigInventory> = {}): ConfigInventory {
  return {
    projectRoot: '/test',
    gitRoot: null,
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

function makeFileInfo(overrides: Partial<FileInfo> = {}): FileInfo {
  return {
    path: '/test/.claude/rules/test.md',
    relativePath: '.claude/rules/test.md',
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

function createRuleFile(content: string): { path: string; projectRoot: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), 'cci-broad-glob-test-'));
  const rulesDir = join(tmpDir, '.claude', 'rules');
  mkdirSync(rulesDir, { recursive: true });
  const rulePath = join(rulesDir, 'test-rule.md');
  writeFileSync(rulePath, content);
  return { path: rulePath, projectRoot: tmpDir };
}

describe('rules-dir/overly-broad-glob rule', () => {
  const resolved = createEmptyResolvedConfig();

  it('warns on paths: ["**"]', () => {
    const { path, projectRoot } = createRuleFile(
      ['---', 'paths:', '  - "**"', '---', '', '# Always apply'].join('\n'),
    );
    const inventory = makeInventory({
      projectRoot,
      rules: [makeFileInfo({ path, relativePath: '.claude/rules/test-rule.md' })],
    });
    const issues = overlyBroadGlobRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('rules-dir/overly-broad-glob');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].category).toBe('rules');
    expect(issues[0].message).toContain('**');
    expect(issues[0].message).toContain('matches all files');
    expect(issues[0].suggestion).toContain('Remove the paths:');
    expect(issues[0].autoFixable).toBe(true);
    expect(issues[0].evidence).toBeDefined();
    expect(issues[0].evidence!.length).toBeGreaterThan(0);
  });

  it('warns on paths: ["**/*"]', () => {
    const { path, projectRoot } = createRuleFile(
      ['---', 'paths:', '  - "**/*"', '---', '', '# Content'].join('\n'),
    );
    const inventory = makeInventory({
      projectRoot,
      rules: [makeFileInfo({ path, relativePath: '.claude/rules/test-rule.md' })],
    });
    const issues = overlyBroadGlobRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('**/*');
  });

  it('no issue for paths: ["src/**"]', () => {
    const { path, projectRoot } = createRuleFile(
      ['---', 'paths:', '  - "src/**"', '---', '', '# Scoped rule'].join('\n'),
    );
    const inventory = makeInventory({
      projectRoot,
      rules: [makeFileInfo({ path, relativePath: '.claude/rules/test-rule.md' })],
    });
    const issues = overlyBroadGlobRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('warns when paths has both broad and scoped entries', () => {
    const { path, projectRoot } = createRuleFile(
      ['---', 'paths:', '  - "**"', '  - "src/**"', '---', '', '# Mixed'].join('\n'),
    );
    const inventory = makeInventory({
      projectRoot,
      rules: [makeFileInfo({ path, relativePath: '.claude/rules/test-rule.md' })],
    });
    const issues = overlyBroadGlobRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('**');
  });

  it('no issue when paths field is absent', () => {
    const { path, projectRoot } = createRuleFile(
      ['---', 'description: Unconditional rule', '---', '', '# Content'].join('\n'),
    );
    const inventory = makeInventory({
      projectRoot,
      rules: [makeFileInfo({ path, relativePath: '.claude/rules/test-rule.md' })],
    });
    const issues = overlyBroadGlobRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('warns on paths: ["./**"]', () => {
    const { path, projectRoot } = createRuleFile(
      ['---', 'paths:', '  - "./**"', '---', '', '# Relative broad'].join('\n'),
    );
    const inventory = makeInventory({
      projectRoot,
      rules: [makeFileInfo({ path, relativePath: '.claude/rules/test-rule.md' })],
    });
    const issues = overlyBroadGlobRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('./**');
  });

  it('warns on paths: ["*"]', () => {
    const { path, projectRoot } = createRuleFile(
      ['---', 'paths:', '  - "*"', '---', '', '# Star'].join('\n'),
    );
    const inventory = makeInventory({
      projectRoot,
      rules: [makeFileInfo({ path, relativePath: '.claude/rules/test-rule.md' })],
    });
    const issues = overlyBroadGlobRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
  });

  it('skips non-existent rule files', () => {
    const inventory = makeInventory({
      rules: [makeFileInfo({ exists: false })],
    });
    const issues = overlyBroadGlobRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('skips rule files without frontmatter', () => {
    const { path, projectRoot } = createRuleFile('# Just content\nNo frontmatter here.\n');
    const inventory = makeInventory({
      projectRoot,
      rules: [makeFileInfo({ path, relativePath: '.claude/rules/test-rule.md' })],
    });
    const issues = overlyBroadGlobRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });
});
