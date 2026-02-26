import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { todoFixmeRule } from '../../src/rules/memory/todo-fixme.js';
import { resolve } from '../../src/core/resolver.js';
import type { ConfigInventory, FileInfo, RuleFileInfo } from '../../src/types/index.js';

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

function makeFileInfo(overrides: Partial<FileInfo> = {}): FileInfo {
  return {
    path: '/test/CLAUDE.md',
    relativePath: 'CLAUDE.md',
    exists: true,
    scope: 'project-shared',
    sizeBytes: 100,
    lineCount: 10,
    estimatedTokens: 50,
    gitTracked: false,
    lastModified: new Date(),
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

describe('memory/todo-fixme rule', () => {
  const resolved = resolve(makeInventory());

  it('flags TODO, FIXME, HACK, XXX, TEMP, PLACEHOLDER markers', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: join(FIXTURES, 'conflicting', 'CLAUDE.todo-markers.md'),
        relativePath: 'CLAUDE.todo-markers.md',
      }),
    });
    const issues = todoFixmeRule.check(inventory, resolved);

    // Should find: TODO, FIXME, HACK, XXX, TEMP, PLACEHOLDER outside code blocks
    // Should NOT find: TODO and FIXME inside ``` code blocks
    expect(issues.length).toBeGreaterThanOrEqual(6);
    expect(issues.every((i) => i.ruleId === 'memory/todo-fixme')).toBe(true);
    expect(issues.every((i) => i.severity === 'info')).toBe(true);
    expect(issues.every((i) => i.category === 'memory')).toBe(true);

    // Verify specific markers are found
    const markers = issues.map((i) => {
      const match = i.message.match(/Contains "(\w+)" marker/);
      return match ? match[1] : null;
    });
    expect(markers).toContain('TODO');
    expect(markers).toContain('FIXME');
    expect(markers).toContain('HACK');
    expect(markers).toContain('XXX');
    expect(markers).toContain('TEMP');
    expect(markers).toContain('PLACEHOLDER');
  });

  it('does not flag markers inside fenced code blocks', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: join(FIXTURES, 'conflicting', 'CLAUDE.todo-markers.md'),
        relativePath: 'CLAUDE.todo-markers.md',
      }),
    });
    const issues = todoFixmeRule.check(inventory, resolved);

    // The fixture has TODO and FIXME inside ``` blocks on lines 21 and 23
    // These should NOT be flagged
    const codeBlockTodo = issues.find((i) => i.message.includes('just an example'));
    expect(codeBlockTodo).toBeUndefined();
  });

  it('reports correct line numbers', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: join(FIXTURES, 'conflicting', 'CLAUDE.todo-markers.md'),
        relativePath: 'CLAUDE.todo-markers.md',
      }),
    });
    const issues = todoFixmeRule.check(inventory, resolved);

    // All issues should have line numbers
    expect(issues.every((i) => typeof i.line === 'number' && i.line > 0)).toBe(true);
  });

  it('does not flag when no CLAUDE.md or rule files exist', () => {
    const inventory = makeInventory();
    const issues = todoFixmeRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('skips non-existent files', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({ exists: false }),
      rules: [makeRuleFileInfo({ exists: false })],
    });
    const issues = todoFixmeRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('does not flag clean CLAUDE.md without markers', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: join(FIXTURES, 'full-project', 'CLAUDE.md'),
        relativePath: 'CLAUDE.md',
      }),
    });
    const issues = todoFixmeRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('also scans rule files', () => {
    const inventory = makeInventory({
      rules: [
        makeRuleFileInfo({
          path: join(FIXTURES, 'conflicting', 'CLAUDE.todo-markers.md'),
          relativePath: '.claude/rules/todo-rule.md',
        }),
      ],
    });
    const issues = todoFixmeRule.check(inventory, resolved);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('suggestion mentions resolving the marker', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: join(FIXTURES, 'conflicting', 'CLAUDE.todo-markers.md'),
        relativePath: 'CLAUDE.todo-markers.md',
      }),
    });
    const issues = todoFixmeRule.check(inventory, resolved);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].suggestion).toContain('Resolve the');
  });
});
