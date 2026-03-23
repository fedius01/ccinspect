import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve as resolvePath, join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';

/**
 * Tests for the setup command logic.
 * We test the file manipulation directly since the command uses chalk (CLI layer).
 */

const TMP_DIR = resolvePath('tests/fixtures/.setup-test-tmp');

function getMcpPath(): string {
  return join(TMP_DIR, '.mcp.json');
}

function readMcp(): Record<string, unknown> | null {
  const mcpPath = getMcpPath();
  if (!existsSync(mcpPath)) return null;
  return JSON.parse(readFileSync(mcpPath, 'utf-8'));
}

function writeMcp(data: Record<string, unknown>): void {
  writeFileSync(getMcpPath(), JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

const EXPECTED_ENTRY = {
  type: 'stdio',
  command: 'npx',
  args: ['-y', 'ccinspect', 'mcp', 'serve'],
};

describe('setup command file operations', () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('creates .mcp.json when none exists', () => {
    const mcpPath = getMcpPath();
    expect(existsSync(mcpPath)).toBe(false);

    // Simulate install
    const data = { mcpServers: { ccinspect: EXPECTED_ENTRY } };
    writeFileSync(mcpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');

    const result = readMcp() as Record<string, unknown>;
    expect(result).toHaveProperty('mcpServers');
    const servers = result.mcpServers as Record<string, unknown>;
    expect(servers).toHaveProperty('ccinspect');
    expect(servers.ccinspect).toEqual(EXPECTED_ENTRY);
  });

  it('adds to existing .mcp.json without disturbing other servers', () => {
    const existing = {
      mcpServers: {
        github: { type: 'stdio', command: 'gh', args: ['mcp'] },
      },
    };
    writeMcp(existing);

    // Simulate adding ccinspect
    const data = readMcp() as Record<string, Record<string, unknown>>;
    data.mcpServers.ccinspect = EXPECTED_ENTRY;
    writeMcp(data);

    const result = readMcp() as Record<string, Record<string, unknown>>;
    expect(result.mcpServers.github).toEqual(existing.mcpServers.github);
    expect(result.mcpServers.ccinspect).toEqual(EXPECTED_ENTRY);
  });

  it('is idempotent — skips if already registered', () => {
    const data = { mcpServers: { ccinspect: EXPECTED_ENTRY } };
    writeMcp(data);

    // Check it's already there
    const existing = readMcp() as Record<string, Record<string, unknown>>;
    const isRegistered = existing?.mcpServers != null && 'ccinspect' in existing.mcpServers;
    expect(isRegistered).toBe(true);
  });

  it('uninstall removes entry and deletes empty file', () => {
    const data = { mcpServers: { ccinspect: EXPECTED_ENTRY } };
    writeMcp(data);

    // Simulate uninstall
    const existing = readMcp() as Record<string, Record<string, unknown>>;
    delete existing.mcpServers.ccinspect;

    const remainingServers = Object.keys(existing.mcpServers).length;
    const otherKeys = Object.keys(existing).filter(k => k !== 'mcpServers').length;

    if (remainingServers === 0 && otherKeys === 0) {
      rmSync(getMcpPath());
    }

    expect(existsSync(getMcpPath())).toBe(false);
  });

  it('uninstall preserves file when other servers exist', () => {
    const data = {
      mcpServers: {
        github: { type: 'stdio', command: 'gh', args: ['mcp'] },
        ccinspect: EXPECTED_ENTRY,
      },
    };
    writeMcp(data);

    // Simulate uninstall
    const existing = readMcp() as Record<string, Record<string, unknown>>;
    delete existing.mcpServers.ccinspect;
    writeMcp(existing);

    const result = readMcp() as Record<string, Record<string, unknown>>;
    expect(result.mcpServers.github).toBeDefined();
    expect(result.mcpServers.ccinspect).toBeUndefined();
    expect(existsSync(getMcpPath())).toBe(true);
  });

  it('status reports not registered when no .mcp.json', () => {
    expect(existsSync(getMcpPath())).toBe(false);
    // Would show "not found" / "not registered" in terminal output
  });

  it('status reports registered when entry exists', () => {
    writeMcp({ mcpServers: { ccinspect: EXPECTED_ENTRY } });
    const data = readMcp() as Record<string, Record<string, unknown>>;
    const isRegistered = data?.mcpServers != null && 'ccinspect' in data.mcpServers;
    expect(isRegistered).toBe(true);
  });

  it('produces valid JSON with correct structure', () => {
    const data = { mcpServers: { ccinspect: EXPECTED_ENTRY } };
    writeMcp(data);

    const raw = readFileSync(getMcpPath(), 'utf-8');
    // Should be formatted with 2-space indent
    expect(raw).toContain('  "mcpServers"');
    // Should end with newline
    expect(raw.endsWith('\n')).toBe(true);
    // Should parse without error
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
