import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ConfigInventory, FileInfo } from '../../../src/types/index.js';
import { printResolvedConfig } from '../../../src/cli/output/terminal.js';
import { createEmptyResolvedConfig } from '../../../src/core/resolver.js';

// ─── Helpers ───

function makeFileInfo(path: string, exists = true): FileInfo {
  return {
    path,
    relativePath: path,
    exists,
    scope: 'project-shared',
    sizeBytes: 100,
    lineCount: 10,
    estimatedTokens: 50,
    gitTracked: true,
    lastModified: new Date(),
  };
}

function makeInventory(overrides: Partial<ConfigInventory> = {}): ConfigInventory {
  return {
    projectRoot: '/projects/myapp',
    gitRoot: '/projects/myapp',
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

const allSections = { permissions: true, env: true, mcp: true, model: true, sandbox: true };

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function strip(s: string): string {
  return s.replace(ANSI_RE, '');
}

// ─── Tests ───

describe('blame key findings', () => {
  let output: string;

  beforeEach(() => {
    output = '';
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output += args.map(String).join(' ') + '\n';
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows deny rules as findings', () => {
    const localPath = '/projects/myapp/.claude/settings.local.json';
    const resolved = createEmptyResolvedConfig();
    resolved.permissions.effectiveDeny = [
      { pattern: 'Bash(npm:*)', action: 'deny', origin: localPath },
    ];

    const inventory = makeInventory({
      localSettings: makeFileInfo(localPath),
    });

    printResolvedConfig(resolved, allSections, {
      projectRoot: '/projects/myapp',
      inventory,
    });

    const plain = strip(output);
    expect(plain).toContain('Key findings');
    expect(plain).toContain('! Bash(npm:*) denied');
    expect(plain).toContain('[L]');
  });

  it('shows env shadow as finding with arrow badge', () => {
    const projectPath = '/projects/myapp/.claude/settings.json';
    const localPath = '/projects/myapp/.claude/settings.local.json';
    const resolved = createEmptyResolvedConfig();
    resolved.environment.effective = new Map([
      ['NODE_ENV', {
        name: 'NODE_ENV',
        value: 'test',
        origin: localPath,
        shadowedValues: [{ value: 'development', origin: projectPath }],
      }],
    ]);
    resolved.environment.shadows = [
      { name: 'NODE_ENV', value: 'development', origin: projectPath },
    ];

    const inventory = makeInventory({
      projectSettings: makeFileInfo(projectPath),
      localSettings: makeFileInfo(localPath),
    });

    printResolvedConfig(resolved, allSections, {
      projectRoot: '/projects/myapp',
      inventory,
    });

    const plain = strip(output);
    expect(plain).toContain('Key findings');
    expect(plain).toContain('NODE_ENV=test shadows "development"');
    expect(plain).toContain('[L]');
    expect(plain).toContain('[P]');
    // Arrow between badges
    expect(plain).toMatch(/\[L\].*→.*\[P\]/);
  });

  it('omits Key findings section when no denies, shadows, or conflicts', () => {
    const projectPath = '/projects/myapp/.claude/settings.json';
    const resolved = createEmptyResolvedConfig();
    resolved.permissions.effectiveAllow = [
      { pattern: 'Bash(npm test)', action: 'allow', origin: projectPath },
    ];

    const inventory = makeInventory({
      projectSettings: makeFileInfo(projectPath),
    });

    printResolvedConfig(resolved, allSections, {
      projectRoot: '/projects/myapp',
      inventory,
    });

    const plain = strip(output);
    expect(plain).not.toContain('Key findings');
  });

  it('caps findings at 5 and shows overflow message', () => {
    const localPath = '/projects/myapp/.claude/settings.local.json';
    const resolved = createEmptyResolvedConfig();
    // Create 7 deny rules to exceed the cap
    resolved.permissions.effectiveDeny = Array.from({ length: 7 }, (_, i) => ({
      pattern: `Bash(cmd-${i})`,
      action: 'deny' as const,
      origin: localPath,
    }));

    const inventory = makeInventory({
      localSettings: makeFileInfo(localPath),
    });

    printResolvedConfig(resolved, allSections, {
      projectRoot: '/projects/myapp',
      inventory,
    });

    const plain = strip(output);
    expect(plain).toContain('Key findings');
    // First 5 should appear
    expect(plain).toContain('Bash(cmd-0) denied');
    expect(plain).toContain('Bash(cmd-4) denied');
    // 6th and 7th should NOT appear
    expect(plain).not.toContain('Bash(cmd-5) denied');
    expect(plain).not.toContain('Bash(cmd-6) denied');
    // Overflow message
    expect(plain).toContain('and 2 more (see details below)');
  });

  it('shows "denied despite Tool(*) allow" when broader allow exists', () => {
    const projectPath = '/projects/myapp/.claude/settings.json';
    const resolved = createEmptyResolvedConfig();
    resolved.permissions.effectiveAllow = [
      { pattern: 'Edit(*)', action: 'allow', origin: projectPath },
    ];
    resolved.permissions.effectiveDeny = [
      { pattern: 'Edit(*.config.ts)', action: 'deny', origin: projectPath },
    ];

    const inventory = makeInventory({
      projectSettings: makeFileInfo(projectPath),
    });

    printResolvedConfig(resolved, allSections, {
      projectRoot: '/projects/myapp',
      inventory,
    });

    const plain = strip(output);
    expect(plain).toContain('Key findings');
    expect(plain).toContain('Edit(*.config.ts) denied despite Edit(*) allow');
  });

  it('shows permission conflict as finding', () => {
    const projectPath = '/projects/myapp/.claude/settings.json';
    const home = process.env.HOME || '/home/user';
    const globalPath = `${home}/.claude/settings.json`;
    const resolved = createEmptyResolvedConfig();
    resolved.permissions.conflicts = [
      {
        pattern: 'Bash(npm run *)',
        rules: [
          { pattern: 'Bash(npm run *)', action: 'allow', origin: projectPath },
          { pattern: 'Bash(npm run *)', action: 'deny', origin: globalPath },
        ],
        resolution: 'deny',
        explanation: 'allowed at project level but denied at global level',
      },
    ];

    const inventory = makeInventory({
      projectSettings: makeFileInfo(projectPath),
      userSettings: makeFileInfo(globalPath),
    });

    printResolvedConfig(resolved, allSections, {
      projectRoot: '/projects/myapp',
      inventory,
    });

    const plain = strip(output);
    expect(plain).toContain('Key findings');
    expect(plain).toContain('Bash(npm run *)');
    expect(plain).toContain('allowed at project level but denied at global level');
  });

  it('shows MCP conflict as finding', () => {
    const projectPath = '/projects/myapp/.mcp.json';
    const home = process.env.HOME || '/home/user';
    const globalPath = `${home}/.claude.json`;
    const resolved = createEmptyResolvedConfig();
    resolved.mcpServers.conflicts = [
      {
        name: 'my-server',
        enabled: true,
        origin: projectPath,
        config: {},
        conflicts: [{ enabled: false, origin: globalPath }],
      },
    ];

    const inventory = makeInventory({
      projectMcp: makeFileInfo(projectPath),
    });

    printResolvedConfig(resolved, allSections, {
      projectRoot: '/projects/myapp',
      inventory,
    });

    const plain = strip(output);
    expect(plain).toContain('Key findings');
    expect(plain).toContain('MCP "my-server" conflict across scopes');
  });

  it('renders Key findings between summary and Permissions', () => {
    const localPath = '/projects/myapp/.claude/settings.local.json';
    const resolved = createEmptyResolvedConfig();
    resolved.permissions.effectiveDeny = [
      { pattern: 'Bash(rm *)', action: 'deny', origin: localPath },
    ];

    const inventory = makeInventory({
      localSettings: makeFileInfo(localPath),
    });

    printResolvedConfig(resolved, allSections, {
      projectRoot: '/projects/myapp',
      inventory,
    });

    const plain = strip(output);
    const summaryIdx = plain.indexOf('Effective config');
    const findingsIdx = plain.indexOf('Key findings');
    const permissionsIdx = plain.indexOf('Permissions\n');
    expect(summaryIdx).toBeGreaterThan(-1);
    expect(findingsIdx).toBeGreaterThan(-1);
    expect(permissionsIdx).toBeGreaterThan(-1);
    expect(summaryIdx).toBeLessThan(findingsIdx);
    expect(findingsIdx).toBeLessThan(permissionsIdx);
  });
});
