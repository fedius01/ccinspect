import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { missingEnvVarsRule } from '../../src/rules/mcp/missing-env-vars.js';
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
    path: '/test/.mcp.json',
    relativePath: '.mcp.json',
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

describe('mcp/missing-env-vars rule', () => {
  const resolved = resolve(makeInventory());

  it('does not flag when no MCP files exist', () => {
    const inventory = makeInventory();
    const issues = missingEnvVarsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('flags empty env vars', () => {
    const inventory = makeInventory({
      projectMcp: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.mcp.missing-env.json'),
        relativePath: '.mcp.missing-env.json',
      }),
    });
    const issues = missingEnvVarsRule.check(inventory, resolved);

    const emptyIssue = issues.find((i) => i.message.includes('empty env var "GITHUB_TOKEN"'));
    expect(emptyIssue).toBeDefined();
    expect(emptyIssue!.message).toContain('github');
    expect(emptyIssue!.severity).toBe('warning');
    expect(emptyIssue!.category).toBe('mcp');
  });

  it('flags placeholder env vars', () => {
    const inventory = makeInventory({
      projectMcp: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.mcp.missing-env.json'),
        relativePath: '.mcp.missing-env.json',
      }),
    });
    const issues = missingEnvVarsRule.check(inventory, resolved);

    // "<your-slack-token>" should be flagged as placeholder
    const slackIssue = issues.find((i) => i.message.includes('SLACK_TOKEN'));
    expect(slackIssue).toBeDefined();
    expect(slackIssue!.message).toContain('placeholder');

    // "TODO: set this" should be flagged as placeholder
    const redisIssue = issues.find((i) => i.message.includes('REDIS_URL'));
    expect(redisIssue).toBeDefined();
    expect(redisIssue!.message).toContain('placeholder');
  });

  it('does not flag actual env var values', () => {
    const inventory = makeInventory({
      projectMcp: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.mcp.missing-env.json'),
        relativePath: '.mcp.missing-env.json',
      }),
    });
    const issues = missingEnvVarsRule.check(inventory, resolved);

    // "acme-corp" (GITHUB_ORG) should not be flagged
    const orgIssue = issues.find((i) => i.message.includes('GITHUB_ORG'));
    expect(orgIssue).toBeUndefined();

    // "postgresql://localhost:5432/dev" should not be flagged
    const pgIssue = issues.find((i) => i.message.includes('POSTGRES_CONNECTION_STRING'));
    expect(pgIssue).toBeUndefined();

    // "acme" (SLACK_WORKSPACE) should not be flagged
    const workspaceIssue = issues.find((i) => i.message.includes('SLACK_WORKSPACE'));
    expect(workspaceIssue).toBeUndefined();
  });

  it('does not flag env var references ($VAR, ${VAR})', () => {
    const inventory = makeInventory({
      projectMcp: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.mcp.missing-env.json'),
        relativePath: '.mcp.missing-env.json',
      }),
    });
    const issues = missingEnvVarsRule.check(inventory, resolved);

    // "${API_KEY}" and "$SECRET" are env var references — should not be flagged
    const apiKeyIssue = issues.find((i) => i.message.includes('API_KEY'));
    expect(apiKeyIssue).toBeUndefined();

    const secretIssue = issues.find((i) => i.message.includes('"SECRET"'));
    expect(secretIssue).toBeUndefined();
  });

  it('does not flag servers without env field', () => {
    const inventory = makeInventory({
      projectMcp: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.mcp.missing-env.json'),
        relativePath: '.mcp.missing-env.json',
      }),
    });
    const issues = missingEnvVarsRule.check(inventory, resolved);

    // "no-env" server has no env field — should not produce any issue
    const noEnvIssue = issues.find((i) => i.message.includes('no-env'));
    expect(noEnvIssue).toBeUndefined();
  });

  it('does not flag valid MCP config', () => {
    const inventory = makeInventory({
      projectMcp: makeFileInfo({
        path: join(FIXTURES, 'full-project', '.mcp.json'),
        relativePath: '.mcp.json',
      }),
    });
    const issues = missingEnvVarsRule.check(inventory, resolved);
    // full-project .mcp.json has a valid POSTGRES_CONNECTION_STRING
    expect(issues).toHaveLength(0);
  });

  it('skips non-existent MCP files', () => {
    const inventory = makeInventory({
      projectMcp: makeFileInfo({ exists: false }),
    });
    const issues = missingEnvVarsRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('reports correct total issue count', () => {
    const inventory = makeInventory({
      projectMcp: makeFileInfo({
        path: join(FIXTURES, 'conflicting', '.mcp.missing-env.json'),
        relativePath: '.mcp.missing-env.json',
      }),
    });
    const issues = missingEnvVarsRule.check(inventory, resolved);

    // Expected issues:
    // 1. github/GITHUB_TOKEN (empty)
    // 2. slack/SLACK_TOKEN (placeholder: <your-slack-token>)
    // 3. redis/REDIS_URL (placeholder: TODO)
    expect(issues).toHaveLength(3);
  });
});
