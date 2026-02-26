import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { sectionTooLargeRule } from '../../src/rules/memory/section-too-large.js';
import { resolve } from '../../src/core/resolver.js';
import type { ConfigInventory, FileInfo } from '../../src/types/index.js';

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

describe('memory/section-too-large rule', () => {
  const resolved = resolve(makeInventory());

  it('flags large sections in CLAUDE.md with a disproportionate section', () => {
    const projectRoot = join(FIXTURES, 'overconfigured');
    const inventory = makeInventory({
      projectRoot,
      projectClaudeMd: makeFileInfo({
        path: join(projectRoot, 'CLAUDE.large-section.md'),
        relativePath: 'CLAUDE.large-section.md',
      }),
    });
    const issues = sectionTooLargeRule.check(inventory, resolved);

    // The fixture has an "Architecture" section that is ~782 tokens (95% of file)
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.ruleId === 'memory/section-too-large')).toBe(true);
    expect(issues.every((i) => i.severity === 'info')).toBe(true);
    expect(issues.every((i) => i.category === 'memory')).toBe(true);

    // Check that message includes token count and percentage
    const archIssue = issues.find((i) => i.message.includes('Architecture'));
    expect(archIssue).toBeDefined();
    expect(archIssue!.message).toMatch(/\d+.*tokens/);
    expect(archIssue!.message).toMatch(/\d+%/);
    expect(archIssue!.line).toBeDefined();
  });

  it('does not flag files under 200 total tokens', () => {
    const projectRoot = join(FIXTURES, 'minimal-project');
    const inventory = makeInventory({
      projectRoot,
      projectClaudeMd: makeFileInfo({
        path: join(projectRoot, 'CLAUDE.md'),
        relativePath: 'CLAUDE.md',
      }),
    });
    const issues = sectionTooLargeRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('does not flag when no CLAUDE.md files exist', () => {
    const inventory = makeInventory();
    const issues = sectionTooLargeRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('skips non-existent CLAUDE.md files', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({ exists: false }),
    });
    const issues = sectionTooLargeRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('does not flag files with only one section', () => {
    const inventory = makeInventory({
      projectClaudeMd: makeFileInfo({
        path: join(FIXTURES, 'minimal-project', 'CLAUDE.md'),
        relativePath: 'CLAUDE.md',
      }),
    });
    const issues = sectionTooLargeRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('respects custom token threshold option', () => {
    const projectRoot = join(FIXTURES, 'overconfigured');
    const inventory = makeInventory({
      projectRoot,
      projectClaudeMd: makeFileInfo({
        path: join(projectRoot, 'CLAUDE.large-section.md'),
        relativePath: 'CLAUDE.large-section.md',
      }),
    });

    // With very high thresholds, nothing should trigger
    const issues = sectionTooLargeRule.check(inventory, resolved, {
      tokenThreshold: 50000,
      percentThreshold: 99,
    });
    expect(issues).toHaveLength(0);
  });

  it('suggestion mentions extracting to rule files', () => {
    const projectRoot = join(FIXTURES, 'overconfigured');
    const inventory = makeInventory({
      projectRoot,
      projectClaudeMd: makeFileInfo({
        path: join(projectRoot, 'CLAUDE.large-section.md'),
        relativePath: 'CLAUDE.large-section.md',
      }),
    });
    const issues = sectionTooLargeRule.check(inventory, resolved);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].suggestion).toContain('.claude/rules/');
  });

  it('does not flag overconfigured CLAUDE.md with many small subsections', () => {
    // The overconfigured CLAUDE.md has 48 granular subsections — none over 500 tokens
    const projectRoot = join(FIXTURES, 'overconfigured');
    const inventory = makeInventory({
      projectRoot,
      projectClaudeMd: makeFileInfo({
        path: join(projectRoot, 'CLAUDE.md'),
        relativePath: 'CLAUDE.md',
      }),
    });
    const issues = sectionTooLargeRule.check(inventory, resolved);
    // With default thresholds (500 tokens, 40%), no single subsection should trigger
    // because the overconfigured file is split into many small ### subsections
    // Key Commands at 216 tokens is the largest — well under 500
    expect(issues).toHaveLength(0);
  });
});
