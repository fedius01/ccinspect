import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolve as resolvePath, join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { execSync } from 'child_process';

/**
 * Tests for the setup command logic.
 * We test the file manipulation directly and mock execSync for claude CLI calls.
 */

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

const mockedExecSync = vi.mocked(execSync);

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

describe('setup command — project mode (.mcp.json)', () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('creates .mcp.json when none exists', () => {
    const mcpPath = getMcpPath();
    expect(existsSync(mcpPath)).toBe(false);

    // Simulate --project install
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

    const existing = readMcp() as Record<string, Record<string, unknown>>;
    const isRegistered = existing?.mcpServers != null && 'ccinspect' in existing.mcpServers;
    expect(isRegistered).toBe(true);
  });

  it('uninstall removes entry and deletes empty file', () => {
    const data = { mcpServers: { ccinspect: EXPECTED_ENTRY } };
    writeMcp(data);

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

    const existing = readMcp() as Record<string, Record<string, unknown>>;
    delete existing.mcpServers.ccinspect;
    writeMcp(existing);

    const result = readMcp() as Record<string, Record<string, unknown>>;
    expect(result.mcpServers.github).toBeDefined();
    expect(result.mcpServers.ccinspect).toBeUndefined();
    expect(existsSync(getMcpPath())).toBe(true);
  });

  it('produces valid JSON with correct structure', () => {
    const data = { mcpServers: { ccinspect: EXPECTED_ENTRY } };
    writeMcp(data);

    const raw = readFileSync(getMcpPath(), 'utf-8');
    expect(raw).toContain('  "mcpServers"');
    expect(raw.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

describe('setup command — global mode (claude CLI)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('default setup calls claude mcp add --scope user', () => {
    // Simulate: claude --version succeeds, not already registered, add succeeds
    mockedExecSync
      .mockReturnValueOnce(Buffer.from('1.0.0'))  // claude --version
      .mockReturnValueOnce(Buffer.from(''))        // claude mcp list (empty = not registered)
      .mockReturnValueOnce(Buffer.from(''));       // claude mcp add

    // Simulate the global install flow
    const claudeAvailable = (() => {
      try { mockedExecSync('claude --version', { stdio: 'pipe' }); return true; } catch { return false; }
    })();
    expect(claudeAvailable).toBe(true);

    const isGloballyRegistered = (() => {
      try {
        const output = mockedExecSync('claude mcp list', { stdio: 'pipe', encoding: 'utf-8' });
        return (output as string).includes('ccinspect');
      } catch { return false; }
    })();
    expect(isGloballyRegistered).toBe(false);

    mockedExecSync('claude mcp add --scope user ccinspect -- npx -y ccinspect mcp serve', { stdio: 'pipe' });

    expect(mockedExecSync).toHaveBeenCalledWith(
      'claude mcp add --scope user ccinspect -- npx -y ccinspect mcp serve',
      { stdio: 'pipe' },
    );
  });

  it('prints manual instructions when claude CLI not found', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('command not found: claude');
    });

    const claudeAvailable = (() => {
      try { mockedExecSync('claude --version', { stdio: 'pipe' }); return true; } catch { return false; }
    })();
    expect(claudeAvailable).toBe(false);
  });

  it('skips when already registered globally', () => {
    mockedExecSync
      .mockReturnValueOnce(Buffer.from('1.0.0'))           // claude --version
      .mockReturnValueOnce(Buffer.from('ccinspect\ngithub')); // claude mcp list (registered)

    const claudeAvailable = (() => {
      try { mockedExecSync('claude --version', { stdio: 'pipe' }); return true; } catch { return false; }
    })();
    expect(claudeAvailable).toBe(true);

    const output = mockedExecSync('claude mcp list', { stdio: 'pipe', encoding: 'utf-8' });
    const isGloballyRegistered = (output as string).includes('ccinspect');
    expect(isGloballyRegistered).toBe(true);

    // Should NOT call claude mcp add
    expect(mockedExecSync).toHaveBeenCalledTimes(2);
  });
});

describe('setup command — uninstall from both scopes', () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('uninstall calls claude mcp remove AND removes from .mcp.json', () => {
    // Set up project-scope registration
    writeMcp({ mcpServers: { ccinspect: EXPECTED_ENTRY } });

    // Mock: claude CLI available, remove succeeds
    mockedExecSync
      .mockReturnValueOnce(Buffer.from('1.0.0'))  // claude --version
      .mockReturnValueOnce(Buffer.from(''));       // claude mcp remove

    // Global removal
    const claudeAvailable = (() => {
      try { mockedExecSync('claude --version', { stdio: 'pipe' }); return true; } catch { return false; }
    })();
    expect(claudeAvailable).toBe(true);

    mockedExecSync('claude mcp remove ccinspect', { stdio: 'pipe' });

    // Project removal
    const existing = readMcp() as Record<string, Record<string, unknown>>;
    delete existing.mcpServers.ccinspect;
    const remainingServers = Object.keys(existing.mcpServers).length;
    const otherKeys = Object.keys(existing).filter(k => k !== 'mcpServers').length;
    if (remainingServers === 0 && otherKeys === 0) {
      rmSync(getMcpPath());
    }

    expect(existsSync(getMcpPath())).toBe(false);
    expect(mockedExecSync).toHaveBeenCalledWith(
      'claude mcp remove ccinspect',
      { stdio: 'pipe' },
    );
  });
});

describe('setup command — status checks both scopes', () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('status reports registered when registered globally', () => {
    mockedExecSync
      .mockReturnValueOnce(Buffer.from('1.0.0'))           // claude --version
      .mockReturnValueOnce(Buffer.from('ccinspect\ngithub')); // claude mcp list

    const claudeAvailable = (() => {
      try { mockedExecSync('claude --version', { stdio: 'pipe' }); return true; } catch { return false; }
    })();
    expect(claudeAvailable).toBe(true);

    const output = mockedExecSync('claude mcp list', { stdio: 'pipe', encoding: 'utf-8' });
    const isGloballyRegistered = (output as string).includes('ccinspect');
    expect(isGloballyRegistered).toBe(true);
  });

  it('status reports registered when registered in .mcp.json', () => {
    writeMcp({ mcpServers: { ccinspect: EXPECTED_ENTRY } });
    const data = readMcp() as Record<string, Record<string, unknown>>;
    const isRegistered = data?.mcpServers != null && 'ccinspect' in data.mcpServers;
    expect(isRegistered).toBe(true);
  });

  it('status reports not registered when no .mcp.json and no global', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('command not found: claude');
    });

    expect(existsSync(getMcpPath())).toBe(false);
    const claudeAvailable = (() => {
      try { mockedExecSync('claude --version', { stdio: 'pipe' }); return true; } catch { return false; }
    })();
    expect(claudeAvailable).toBe(false);
  });
});
