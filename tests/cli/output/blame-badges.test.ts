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

// Strip ANSI escape codes for assertion matching
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function strip(s: string): string {
  return s.replace(ANSI_RE, '');
}

// ─── Tests ───

describe('blame badge system', () => {
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

  it('renders [P] badge for project settings origins', () => {
    const projectSettingsPath = '/projects/myapp/.claude/settings.json';
    const resolved = createEmptyResolvedConfig();
    resolved.permissions.effectiveAllow = [
      { pattern: 'Bash(npm test)', action: 'allow', origin: projectSettingsPath },
    ];

    const inventory = makeInventory({
      projectSettings: makeFileInfo(projectSettingsPath),
    });

    printResolvedConfig(resolved, allSections, {
      projectRoot: '/projects/myapp',
      inventory,
    });

    const plain = strip(output);
    expect(plain).toContain('[P]');
    expect(plain).not.toContain(projectSettingsPath);
  });

  it('renders [L] badge for local settings origins', () => {
    const localPath = '/projects/myapp/.claude/settings.local.json';
    const resolved = createEmptyResolvedConfig();
    resolved.environment.effective = new Map([
      ['NODE_ENV', { name: 'NODE_ENV', value: 'test', origin: localPath }],
    ]);

    const inventory = makeInventory({
      localSettings: makeFileInfo(localPath),
    });

    printResolvedConfig(resolved, allSections, {
      projectRoot: '/projects/myapp',
      inventory,
    });

    const plain = strip(output);
    expect(plain).toContain('[L]');
    expect(plain).not.toContain(localPath);
  });

  it('renders [G] badge for user global settings origins', () => {
    const home = process.env.HOME || '/home/user';
    const userPath = `${home}/.claude/settings.json`;
    const resolved = createEmptyResolvedConfig();
    resolved.model.effectiveModel = { value: 'claude-sonnet-4-20250514', origin: userPath };

    const inventory = makeInventory({
      userSettings: makeFileInfo(userPath),
    });

    printResolvedConfig(resolved, { permissions: false, env: false, mcp: false, model: true, sandbox: false }, {
      projectRoot: '/projects/myapp',
      inventory,
    });

    const plain = strip(output);
    expect(plain).toContain('[G]');
    expect(plain).not.toContain(userPath);
  });

  it('renders [M] badge for MCP config origins', () => {
    const mcpPath = '/projects/myapp/.mcp.json';
    const resolved = createEmptyResolvedConfig();
    resolved.mcpServers.effective = [
      { name: 'my-server', enabled: true, origin: mcpPath, config: {} },
    ];

    const inventory = makeInventory({
      projectMcp: makeFileInfo(mcpPath),
    });

    printResolvedConfig(resolved, { permissions: false, env: false, mcp: true, model: false, sandbox: false }, {
      projectRoot: '/projects/myapp',
      inventory,
    });

    const plain = strip(output);
    expect(plain).toContain('[M]');
    expect(plain).not.toContain(mcpPath);
  });

  it('renders (default) for default origins', () => {
    const resolved = createEmptyResolvedConfig();
    // sandbox has origin 'default' from createEmptyResolvedConfig... but it's 'none'
    // Let's set it explicitly
    resolved.sandbox.enabled = { value: false, origin: 'default' };

    printResolvedConfig(resolved, { permissions: false, env: false, mcp: false, model: false, sandbox: true }, {
      projectRoot: '/projects/myapp',
      inventory: makeInventory(),
    });

    const plain = strip(output);
    expect(plain).toContain('(default)');
  });

  it('renders Sources legend footer with existing files', () => {
    const projectPath = '/projects/myapp/.claude/settings.json';
    const localPath = '/projects/myapp/.claude/settings.local.json';
    const resolved = createEmptyResolvedConfig();
    resolved.permissions.effectiveAllow = [
      { pattern: 'Bash(npm test)', action: 'allow', origin: projectPath },
    ];
    resolved.permissions.effectiveDeny = [
      { pattern: 'Bash(rm *)', action: 'deny', origin: localPath },
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
    expect(plain).toContain('Sources');
    expect(plain).toContain('[L] .claude/settings.local.json');
    expect(plain).toContain('[P] .claude/settings.json');
  });

  it('does not render Sources legend when no inventory provided', () => {
    const resolved = createEmptyResolvedConfig();
    resolved.sandbox.enabled = { value: false, origin: 'default' };

    printResolvedConfig(resolved, allSections);

    const plain = strip(output);
    expect(plain).not.toContain('Sources');
  });

  it('falls back to raw path for unmapped origins', () => {
    const unknownPath = '/some/unknown/path.json';
    const resolved = createEmptyResolvedConfig();
    resolved.model.effectiveModel = { value: 'claude-sonnet-4-20250514', origin: unknownPath };

    printResolvedConfig(resolved, { permissions: false, env: false, mcp: false, model: true, sandbox: false }, {
      projectRoot: '/projects/myapp',
      inventory: makeInventory(),
    });

    const plain = strip(output);
    // Falls back to raw path since it's not in the badge map
    expect(plain).toContain(unknownPath);
  });

  it('does not crash when called without opts', () => {
    const resolved = createEmptyResolvedConfig();
    resolved.sandbox.enabled = { value: false, origin: 'default' };

    expect(() => {
      printResolvedConfig(resolved, allSections);
    }).not.toThrow();
  });

  it('renders env shadow origins with badges', () => {
    const projectPath = '/projects/myapp/.claude/settings.json';
    const localPath = '/projects/myapp/.claude/settings.local.json';
    const resolved = createEmptyResolvedConfig();
    resolved.environment.effective = new Map([
      ['API_URL', {
        name: 'API_URL',
        value: 'https://prod.example.com',
        origin: localPath,
        shadowedValues: [{ value: 'https://dev.example.com', origin: projectPath }],
      }],
    ]);

    const inventory = makeInventory({
      projectSettings: makeFileInfo(projectPath),
      localSettings: makeFileInfo(localPath),
    });

    printResolvedConfig(resolved, { permissions: false, env: true, mcp: false, model: false, sandbox: false }, {
      projectRoot: '/projects/myapp',
      inventory,
    });

    const plain = strip(output);
    expect(plain).toContain('[L]');
    expect(plain).toContain('[P]');
    // Shadow line should use badge, not full path
    expect(plain).not.toContain(projectPath);
    expect(plain).not.toContain(localPath);
  });

  it('skips non-existent files in the legend', () => {
    const projectPath = '/projects/myapp/.claude/settings.json';
    const resolved = createEmptyResolvedConfig();
    resolved.permissions.effectiveAllow = [
      { pattern: 'Bash(npm test)', action: 'allow', origin: projectPath },
    ];

    const inventory = makeInventory({
      projectSettings: makeFileInfo(projectPath, true),
      // localSettings exists=false should not appear in legend
      localSettings: makeFileInfo('/projects/myapp/.claude/settings.local.json', false),
    });

    printResolvedConfig(resolved, allSections, {
      projectRoot: '/projects/myapp',
      inventory,
    });

    const plain = strip(output);
    expect(plain).toContain('Sources');
    expect(plain).toContain('[P] .claude/settings.json');
    expect(plain).not.toContain('settings.local.json');
  });
});

describe('blame summary block', () => {
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

  it('renders summary with all 5 lines', () => {
    const projectPath = '/projects/myapp/.claude/settings.json';
    const mcpPath = '/projects/myapp/.mcp.json';
    const resolved = createEmptyResolvedConfig();
    resolved.model.effectiveModel = { value: 'opus', origin: projectPath };
    resolved.sandbox.enabled = { value: false, origin: 'default' };
    resolved.mcpServers.effective = [
      { name: 'github', enabled: true, origin: mcpPath, config: {} },
    ];
    resolved.environment.effective = new Map([
      ['API_KEY', { name: 'API_KEY', value: 'xxx', origin: projectPath }],
    ]);
    resolved.permissions.effectiveAllow = [
      { pattern: 'Bash(npm test)', action: 'allow', origin: projectPath },
    ];

    const inventory = makeInventory({
      projectSettings: makeFileInfo(projectPath),
      projectMcp: makeFileInfo(mcpPath),
    });

    printResolvedConfig(resolved, allSections, {
      projectRoot: '/projects/myapp',
      inventory,
    });

    const plain = strip(output);
    expect(plain).toContain('Effective config');
    expect(plain).toContain('Model:');
    expect(plain).toContain('opus');
    expect(plain).toContain('Sandbox:');
    expect(plain).toContain('MCP:');
    expect(plain).toContain('github');
    expect(plain).toContain('Env vars:');
    expect(plain).toContain('1 defined');
    expect(plain).toContain('Permissions:');
  });

  it('renders correct permission scope counts', () => {
    const projectPath = '/projects/myapp/.claude/settings.json';
    const home = process.env.HOME || '/home/user';
    const globalPath = `${home}/.claude/settings.json`;
    const resolved = createEmptyResolvedConfig();
    resolved.permissions.effectiveAllow = [
      { pattern: 'Bash(npm test)', action: 'allow', origin: projectPath },
      { pattern: 'Bash(npm run build)', action: 'allow', origin: projectPath },
      { pattern: 'Read(*)', action: 'allow', origin: globalPath },
    ];
    resolved.permissions.effectiveDeny = [
      { pattern: 'Bash(rm *)', action: 'deny', origin: projectPath },
      { pattern: 'Bash(rm -rf *)', action: 'deny', origin: projectPath },
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
    expect(plain).toContain('2 project');
    expect(plain).toContain('1 global');
    expect(plain).toContain('2 deny');
  });

  it('renders "no project servers" when no MCP servers', () => {
    const resolved = createEmptyResolvedConfig();
    resolved.sandbox.enabled = { value: false, origin: 'default' };

    printResolvedConfig(resolved, allSections, {
      projectRoot: '/projects/myapp',
      inventory: makeInventory(),
    });

    const plain = strip(output);
    expect(plain).toContain('no project servers');
  });

  it('shows shadow count in env summary', () => {
    const projectPath = '/projects/myapp/.claude/settings.json';
    const localPath = '/projects/myapp/.claude/settings.local.json';
    const resolved = createEmptyResolvedConfig();
    resolved.environment.effective = new Map([
      ['API_URL', {
        name: 'API_URL',
        value: 'https://prod.example.com',
        origin: localPath,
        shadowedValues: [{ value: 'https://dev.example.com', origin: projectPath }],
      }],
      ['NODE_ENV', { name: 'NODE_ENV', value: 'test', origin: localPath }],
    ]);
    resolved.environment.shadows = [
      { name: 'API_URL', value: 'https://dev.example.com', origin: projectPath },
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
    expect(plain).toContain('2 defined');
    expect(plain).toMatch(/1 shadowed/);
  });

  it('omits separate Sandbox section when default', () => {
    const resolved = createEmptyResolvedConfig();
    resolved.sandbox.enabled = { value: false, origin: 'default' };

    printResolvedConfig(resolved, allSections, {
      projectRoot: '/projects/myapp',
      inventory: makeInventory(),
    });

    const plain = strip(output);
    // Summary should show sandbox
    expect(plain).toContain('Sandbox:');
    expect(plain).toContain('disabled (default)');
    // But no separate underlined Sandbox section header
    const lines = plain.split('\n');
    const sectionHeaders = lines.filter(l => l.trim() === 'Sandbox');
    expect(sectionHeaders).toHaveLength(0);
  });

  it('omits separate Model section when no overrides', () => {
    const resolved = createEmptyResolvedConfig();
    resolved.model.effectiveModel = { value: 'opus', origin: 'default' };
    resolved.sandbox.enabled = { value: false, origin: 'default' };

    printResolvedConfig(resolved, allSections, {
      projectRoot: '/projects/myapp',
      inventory: makeInventory(),
    });

    const plain = strip(output);
    // Summary shows model
    expect(plain).toContain('Model:');
    expect(plain).toContain('opus');
    // But no separate underlined Model section header
    const lines = plain.split('\n');
    const sectionHeaders = lines.filter(l => l.trim() === 'Model');
    expect(sectionHeaders).toHaveLength(0);
  });

  it('shows Model section when subagent/haiku/opus overrides exist', () => {
    const projectPath = '/projects/myapp/.claude/settings.json';
    const resolved = createEmptyResolvedConfig();
    resolved.model.effectiveModel = { value: 'opus', origin: projectPath };
    resolved.model.subagentModel = { value: 'sonnet', origin: projectPath };
    resolved.sandbox.enabled = { value: false, origin: 'default' };

    const inventory = makeInventory({
      projectSettings: makeFileInfo(projectPath),
    });

    printResolvedConfig(resolved, allSections, {
      projectRoot: '/projects/myapp',
      inventory,
    });

    const plain = strip(output);
    // Summary shows model
    expect(plain).toContain('Model:');
    // Separate Model section should also render
    const lines = plain.split('\n');
    const sectionHeaders = lines.filter(l => l.trim() === 'Model');
    expect(sectionHeaders).toHaveLength(1);
    expect(plain).toContain('Subagent');
  });

  it('renders summary even with section flags', () => {
    const resolved = createEmptyResolvedConfig();
    resolved.sandbox.enabled = { value: false, origin: 'default' };

    // Only show permissions section
    printResolvedConfig(resolved, { permissions: true, env: false, mcp: false, model: false, sandbox: false }, {
      projectRoot: '/projects/myapp',
      inventory: makeInventory(),
    });

    const plain = strip(output);
    expect(plain).toContain('Effective config');
    expect(plain).toContain('Model:');
    expect(plain).toContain('Sandbox:');
    expect(plain).toContain('MCP:');
    expect(plain).toContain('Env vars:');
    expect(plain).toContain('Permissions:');
  });

  it('truncates MCP server names when more than 4', () => {
    const mcpPath = '/projects/myapp/.mcp.json';
    const resolved = createEmptyResolvedConfig();
    resolved.mcpServers.effective = [
      { name: 'server-a', enabled: true, origin: mcpPath, config: {} },
      { name: 'server-b', enabled: true, origin: mcpPath, config: {} },
      { name: 'server-c', enabled: true, origin: mcpPath, config: {} },
      { name: 'server-d', enabled: true, origin: mcpPath, config: {} },
      { name: 'server-e', enabled: true, origin: mcpPath, config: {} },
      { name: 'server-f', enabled: true, origin: mcpPath, config: {} },
    ];
    resolved.sandbox.enabled = { value: false, origin: 'default' };

    const inventory = makeInventory({
      projectMcp: makeFileInfo(mcpPath),
    });

    printResolvedConfig(resolved, allSections, {
      projectRoot: '/projects/myapp',
      inventory,
    });

    const plain = strip(output);
    expect(plain).toContain('server-a, server-b, server-c, +3 more');
  });
});

describe('blame MCP user servers note', () => {
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

  it('shows user servers note when MCP servers exist', () => {
    const mcpPath = '/projects/myapp/.mcp.json';
    const resolved = createEmptyResolvedConfig();
    resolved.mcpServers.effective = [
      { name: 'github', enabled: true, origin: mcpPath, config: {} },
      { name: 'postgres', enabled: true, origin: mcpPath, config: {} },
    ];

    const inventory = makeInventory({
      projectMcp: makeFileInfo(mcpPath),
    });

    printResolvedConfig(resolved, { permissions: false, env: false, mcp: true, model: false, sandbox: false }, {
      projectRoot: '/projects/myapp',
      inventory,
    });

    const plain = strip(output);
    expect(plain).toContain('github');
    expect(plain).toContain('postgres');
    expect(plain).toContain('(user servers in ~/.claude.json not yet scanned)');
  });

  it('shows "No project servers configured" and user note when no MCP servers', () => {
    const resolved = createEmptyResolvedConfig();

    printResolvedConfig(resolved, { permissions: false, env: false, mcp: true, model: false, sandbox: false }, {
      projectRoot: '/projects/myapp',
      inventory: makeInventory(),
    });

    const plain = strip(output);
    expect(plain).toContain('No project servers configured');
    expect(plain).not.toContain('No MCP servers configured');
    expect(plain).toContain('(user servers in ~/.claude.json not yet scanned)');
  });

  it('does not contain (shadowed) text anywhere', () => {
    const projectPath = '/projects/myapp/.claude/settings.json';
    const localPath = '/projects/myapp/.claude/settings.local.json';
    const resolved = createEmptyResolvedConfig();
    resolved.environment.effective = new Map([
      ['API_URL', {
        name: 'API_URL',
        value: 'https://prod.example.com',
        origin: localPath,
        shadowedValues: [{ value: 'https://dev.example.com', origin: projectPath }],
      }],
    ]);
    resolved.environment.shadows = [
      { name: 'API_URL', value: 'https://dev.example.com', origin: projectPath },
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
    expect(plain).not.toContain('(shadowed)');
  });
});

describe('blame permission grouping', () => {
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

  it('renders deny rules before allow groups', () => {
    const projectPath = '/projects/myapp/.claude/settings.json';
    const resolved = createEmptyResolvedConfig();
    resolved.permissions.effectiveAllow = [
      { pattern: 'Bash(npm test)', action: 'allow', origin: projectPath },
    ];
    resolved.permissions.effectiveDeny = [
      { pattern: 'Bash(rm *)', action: 'deny', origin: projectPath },
    ];

    const inventory = makeInventory({
      projectSettings: makeFileInfo(projectPath),
    });

    printResolvedConfig(resolved, allSections, {
      projectRoot: '/projects/myapp',
      inventory,
    });

    const plain = strip(output);
    const denyIdx = plain.indexOf('Deny');
    const allowIdx = plain.indexOf('allow');
    expect(denyIdx).toBeGreaterThan(-1);
    expect(allowIdx).toBeGreaterThan(-1);
    expect(denyIdx).toBeLessThan(allowIdx);
  });

  it('groups allow rules by scope with sub-headers', () => {
    const projectPath = '/projects/myapp/.claude/settings.json';
    const home = process.env.HOME || '/home/user';
    const globalPath = `${home}/.claude/settings.json`;
    const resolved = createEmptyResolvedConfig();
    resolved.permissions.effectiveAllow = [
      { pattern: 'Bash(npm test)', action: 'allow', origin: projectPath },
      { pattern: 'Read(*)', action: 'allow', origin: globalPath },
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
    expect(plain).toContain('Project allow');
    expect(plain).toContain('Global allow');
  });

  it('collapses global allow by default', () => {
    const home = process.env.HOME || '/home/user';
    const globalPath = `${home}/.claude/settings.json`;
    const resolved = createEmptyResolvedConfig();
    resolved.permissions.effectiveAllow = Array.from({ length: 12 }, (_, i) => ({
      pattern: `Bash(cmd-${i})`,
      action: 'allow' as const,
      origin: globalPath,
    }));

    const inventory = makeInventory({
      userSettings: makeFileInfo(globalPath),
    });

    printResolvedConfig(resolved, allSections, {
      projectRoot: '/projects/myapp',
      inventory,
    });

    const plain = strip(output);
    expect(plain).toContain('12 patterns (--verbose to expand)');
    // Individual patterns should NOT appear
    expect(plain).not.toContain('Bash(cmd-0)');
  });

  it('shows non-global allow patterns individually', () => {
    const projectPath = '/projects/myapp/.claude/settings.json';
    const resolved = createEmptyResolvedConfig();
    resolved.permissions.effectiveAllow = [
      { pattern: 'Bash(npm test)', action: 'allow', origin: projectPath },
      { pattern: 'Read(*)', action: 'allow', origin: projectPath },
      { pattern: 'Edit(*)', action: 'allow', origin: projectPath },
      { pattern: 'Read(src/*)', action: 'allow', origin: projectPath },
      { pattern: 'Edit(*.config.ts)', action: 'allow', origin: projectPath },
    ];

    const inventory = makeInventory({
      projectSettings: makeFileInfo(projectPath),
    });

    printResolvedConfig(resolved, allSections, {
      projectRoot: '/projects/myapp',
      inventory,
    });

    const plain = strip(output);
    expect(plain).toContain('Project allow');
    expect(plain).toContain('Bash(npm test)');
    expect(plain).toContain('Read(*)');
    expect(plain).toContain('Edit(*)');
    expect(plain).toContain('Read(src/*)');
    expect(plain).toContain('Edit(*.config.ts)');
  });

  it('collapses redundancies to a single info line', () => {
    const projectPath = '/projects/myapp/.claude/settings.json';
    const resolved = createEmptyResolvedConfig();
    resolved.permissions.effectiveAllow = [
      { pattern: 'Read(*)', action: 'allow', origin: projectPath },
      { pattern: 'Read(src/*)', action: 'allow', origin: projectPath },
      { pattern: 'Edit(*)', action: 'allow', origin: projectPath },
      { pattern: 'Edit(*.config.ts)', action: 'allow', origin: projectPath },
    ];
    resolved.permissions.redundancies = [
      {
        narrow: { pattern: 'Read(src/*)', action: 'allow', origin: projectPath },
        broad: { pattern: 'Read(*)', action: 'allow', origin: projectPath },
        explanation: '"Read(src/*)" covered by "Read(*)"',
      },
      {
        narrow: { pattern: 'Edit(*.config.ts)', action: 'allow', origin: projectPath },
        broad: { pattern: 'Edit(*)', action: 'allow', origin: projectPath },
        explanation: '"Edit(*.config.ts)" covered by "Edit(*)"',
      },
      {
        narrow: { pattern: 'Read(lib/*)', action: 'allow', origin: projectPath },
        broad: { pattern: 'Read(*)', action: 'allow', origin: projectPath },
        explanation: '"Read(lib/*)" covered by "Read(*)"',
      },
    ];

    const inventory = makeInventory({
      projectSettings: makeFileInfo(projectPath),
    });

    printResolvedConfig(resolved, allSections, {
      projectRoot: '/projects/myapp',
      inventory,
    });

    const plain = strip(output);
    // Single info line, not individual redundancy rows
    expect(plain).toContain('3 redundant rules (covered by Read(*), Edit(*))');
    // Old-style individual redundancy lines should NOT appear
    expect(plain).not.toContain('Redundancies:');
  });

  it('has no padding desert (no 10+ consecutive spaces)', () => {
    const projectPath = '/projects/myapp/.claude/settings.json';
    const home = process.env.HOME || '/home/user';
    const globalPath = `${home}/.claude/settings.json`;
    const resolved = createEmptyResolvedConfig();
    resolved.permissions.effectiveAllow = [
      { pattern: 'Bash(npm test)', action: 'allow', origin: projectPath },
      { pattern: 'Read(*)', action: 'allow', origin: globalPath },
    ];
    resolved.permissions.effectiveDeny = [
      { pattern: 'Bash(rm *)', action: 'deny', origin: projectPath },
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
    // Extract only the Permissions section
    const permStart = plain.indexOf('Permissions\n');
    const permEnd = plain.indexOf('\n', plain.indexOf('Environment Variables'));
    const permSection = plain.slice(permStart, permEnd > 0 ? permEnd : undefined);
    // No runs of 10+ spaces
    expect(permSection).not.toMatch(/ {10,}/);
  });

  it('renders allow groups in scope precedence order', () => {
    const localPath = '/projects/myapp/.claude/settings.local.json';
    const projectPath = '/projects/myapp/.claude/settings.json';
    const home = process.env.HOME || '/home/user';
    const globalPath = `${home}/.claude/settings.json`;
    const resolved = createEmptyResolvedConfig();
    resolved.permissions.effectiveAllow = [
      { pattern: 'Bash(npm test)', action: 'allow', origin: projectPath },
      { pattern: 'WebSearch', action: 'allow', origin: localPath },
      { pattern: 'Read(*)', action: 'allow', origin: globalPath },
    ];

    const inventory = makeInventory({
      projectSettings: makeFileInfo(projectPath),
      localSettings: makeFileInfo(localPath),
      userSettings: makeFileInfo(globalPath),
    });

    printResolvedConfig(resolved, allSections, {
      projectRoot: '/projects/myapp',
      inventory,
    });

    const plain = strip(output);
    const localIdx = plain.indexOf('Local allow');
    const projectIdx = plain.indexOf('Project allow');
    const globalIdx = plain.indexOf('Global allow');
    expect(localIdx).toBeGreaterThan(-1);
    expect(projectIdx).toBeGreaterThan(-1);
    expect(globalIdx).toBeGreaterThan(-1);
    // Precedence order: Local before Project before Global
    expect(localIdx).toBeLessThan(projectIdx);
    expect(projectIdx).toBeLessThan(globalIdx);
  });

  it('shows "No permission rules configured" when empty', () => {
    const resolved = createEmptyResolvedConfig();

    printResolvedConfig(resolved, allSections, {
      projectRoot: '/projects/myapp',
      inventory: makeInventory(),
    });

    const plain = strip(output);
    expect(plain).toContain('No permission rules configured');
  });

  it('shows individual badges on deny rules from different scopes', () => {
    const localPath = '/projects/myapp/.claude/settings.local.json';
    const projectPath = '/projects/myapp/.claude/settings.json';
    const resolved = createEmptyResolvedConfig();
    resolved.permissions.effectiveDeny = [
      { pattern: 'Bash(npm:*)', action: 'deny', origin: localPath },
      { pattern: 'Edit(*.config.ts)', action: 'deny', origin: projectPath },
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
    // Both badges should appear in the deny section
    const denySection = plain.slice(plain.indexOf('Deny'), plain.indexOf('\n\n', plain.indexOf('Deny')));
    expect(denySection).toContain('[L]');
    expect(denySection).toContain('[P]');
  });

  it('expands global allow patterns when verbose', () => {
    const home = process.env.HOME || '/home/user';
    const globalPath = `${home}/.claude/settings.json`;
    const resolved = createEmptyResolvedConfig();
    resolved.permissions.effectiveAllow = Array.from({ length: 5 }, (_, i) => ({
      pattern: `Bash(cmd-${i})`,
      action: 'allow' as const,
      origin: globalPath,
    }));

    const inventory = makeInventory({
      userSettings: makeFileInfo(globalPath),
    });

    printResolvedConfig(resolved, allSections, {
      projectRoot: '/projects/myapp',
      inventory,
      verbose: true,
    });

    const plain = strip(output);
    // Should NOT be collapsed
    expect(plain).not.toContain('--verbose to expand');
    // All patterns should appear
    expect(plain).toContain('Bash(cmd-0)');
    expect(plain).toContain('Bash(cmd-4)');
  });
});
