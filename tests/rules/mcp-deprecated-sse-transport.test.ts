import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { deprecatedSseTransportRule } from '../../src/rules/mcp/deprecated-sse-transport.js';
import { createEmptyResolvedConfig } from '../../src/core/resolver.js';
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

describe('mcp/deprecated-sse-transport rule', () => {
  const resolved = createEmptyResolvedConfig();

  it('flags server with "type": "sse"', () => {
    const inventory = makeInventory({
      projectMcp: makeFileInfo({
        path: join(FIXTURES, 'full-project', '.mcp.sse.json'),
        relativePath: '.mcp.sse.json',
      }),
    });
    const issues = deprecatedSseTransportRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('mcp/deprecated-sse-transport');
    expect(issues[0].severity).toBe('info');
    expect(issues[0].category).toBe('mcp');
    expect(issues[0].message).toContain('remote-api');
    expect(issues[0].message).toContain('deprecated SSE');
    expect(issues[0].suggestion).toContain('"type": "http"');
    expect(issues[0].evidence).toBeDefined();
    expect(issues[0].evidence![0].content).toContain('"sse"');
  });

  it('does not flag server with "type": "http"', () => {
    const inventory = makeInventory({
      projectMcp: makeFileInfo({
        path: join(FIXTURES, 'full-project', '.mcp.json'),
        relativePath: '.mcp.json',
      }),
    });
    const issues = deprecatedSseTransportRule.check(inventory, resolved);
    // full-project .mcp.json has no type field (stdio server)
    expect(issues).toHaveLength(0);
  });

  it('does not flag server with "type": "stdio"', () => {
    const inventory = makeInventory({
      projectMcp: makeFileInfo({
        path: join(FIXTURES, 'full-project', '.mcp.sse.json'),
        relativePath: '.mcp.sse.json',
      }),
    });
    const issues = deprecatedSseTransportRule.check(inventory, resolved);
    // Only remote-api (sse) should be flagged, not local-db (stdio) or another-remote (http)
    const stdioIssues = issues.filter(i => i.message.includes('local-db'));
    expect(stdioIssues).toHaveLength(0);
  });

  it('flags only SSE servers when multiple servers exist', () => {
    const inventory = makeInventory({
      projectMcp: makeFileInfo({
        path: join(FIXTURES, 'full-project', '.mcp.sse.json'),
        relativePath: '.mcp.sse.json',
      }),
    });
    const issues = deprecatedSseTransportRule.check(inventory, resolved);
    // .mcp.sse.json has 3 servers: remote-api (sse), local-db (stdio), another-remote (http)
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('remote-api');
  });

  it('no issues when no MCP files exist', () => {
    const inventory = makeInventory();
    const issues = deprecatedSseTransportRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('skips non-existent MCP files', () => {
    const inventory = makeInventory({
      projectMcp: makeFileInfo({ exists: false }),
    });
    const issues = deprecatedSseTransportRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });
});
