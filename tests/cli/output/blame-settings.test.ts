import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FileInfo } from '../../../src/types/index.js';
import {
  buildSettingsTable,
  printBlameSettings,
  printBlameSettingsJson,
} from '../../../src/cli/output/terminal.js';
import type { RawSettingsLayer, SettingsTableRow, SourceEntry } from '../../../src/cli/output/terminal.js';

// ─── Helpers ───

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function strip(s: string): string {
  return s.replace(ANSI_RE, '');
}

function makeBadgeMap(entries: Array<{ path: string; badge: string }>): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of entries) m.set(e.path, e.badge);
  return m;
}

// ─── buildSettingsTable Tests ───

describe('buildSettingsTable', () => {
  it('merges scalar keys from two layers with highest precedence winning', () => {
    const badgeMap = makeBadgeMap([
      { path: '/proj/.claude/settings.json', badge: '[P]' },
      { path: '/home/.claude/settings.json', badge: '[G]' },
    ]);
    const layers: RawSettingsLayer[] = [
      { path: '/proj/.claude/settings.json', data: { model: 'opus', cleanupPeriodDays: 20 } },
      { path: '/home/.claude/settings.json', data: { model: 'sonnet', outputStyle: 'Explanatory' } },
    ];

    const rows = buildSettingsTable(layers, badgeMap);

    const modelRow = rows.find((r) => r.key === 'model');
    expect(modelRow).toBeDefined();
    expect(modelRow!.displayValue).toBe('opus');
    expect(strip(modelRow!.sourceBadge)).toBe('[P]');

    // model overridden from [G]
    expect(modelRow!.overrides).toHaveLength(1);
    expect(modelRow!.overrides![0].value).toBe('sonnet');

    // outputStyle only in [G]
    const outputRow = rows.find((r) => r.key === 'outputStyle');
    expect(outputRow).toBeDefined();
    expect(outputRow!.displayValue).toBe('Explanatory');
    expect(outputRow!.overrides).toBeUndefined();
  });

  it('excludes $schema key', () => {
    const badgeMap = makeBadgeMap([{ path: '/p', badge: '[P]' }]);
    const layers: RawSettingsLayer[] = [
      { path: '/p', data: { $schema: 'http://example.com/schema.json', model: 'opus' } },
    ];

    const rows = buildSettingsTable(layers, badgeMap);
    expect(rows.find((r) => r.key === '$schema')).toBeUndefined();
    expect(rows.find((r) => r.key === 'model')).toBeDefined();
  });

  it('excludes feedbackSurveyState key', () => {
    const badgeMap = makeBadgeMap([{ path: '/p', badge: '[P]' }]);
    const layers: RawSettingsLayer[] = [
      { path: '/p', data: { feedbackSurveyState: 'dismissed', model: 'opus' } },
    ];

    const rows = buildSettingsTable(layers, badgeMap);
    expect(rows.find((r) => r.key === 'feedbackSurveyState')).toBeUndefined();
    expect(rows.find((r) => r.key === 'model')).toBeDefined();
  });

  // ─── Permissions (complex key, split into sub-keys) ───

  it('splits permissions into permissions.allow and permissions.deny sub-keys', () => {
    const badgeMap = makeBadgeMap([{ path: '/p', badge: '[P]' }]);
    const layers: RawSettingsLayer[] = [
      { path: '/p', data: { permissions: { allow: ['Read(*)', 'Edit(*)'], deny: ['Bash(rm *)'] } } },
    ];

    const rows = buildSettingsTable(layers, badgeMap);
    // No combined 'permissions' row
    expect(rows.find((r) => r.key === 'permissions')).toBeUndefined();

    const allowRow = rows.find((r) => r.key === 'permissions.allow');
    expect(allowRow).toBeDefined();
    expect(allowRow!.displayValue).toBe('2 patterns');
    expect(strip(allowRow!.sourceBadge)).toBe('[P]');

    const denyRow = rows.find((r) => r.key === 'permissions.deny');
    expect(denyRow).toBeDefined();
    expect(denyRow!.displayValue).toBe('1 pattern');
    expect(strip(denyRow!.sourceBadge)).toBe('[P]');
  });

  it('permissions.allow: highest layer wins, lower layers become overrides (BUG-1)', () => {
    const badgeMap = makeBadgeMap([
      { path: '/l', badge: '[L]' },
      { path: '/p', badge: '[P]' },
      { path: '/g', badge: '[G]' },
    ]);
    const layers: RawSettingsLayer[] = [
      { path: '/l', data: { permissions: { allow: ['Read(*)'] } } },
      { path: '/p', data: { permissions: { allow: ['Read(*)', 'Edit(*)', 'Bash(npm *)'] } } },
      { path: '/g', data: { permissions: { allow: ['WebSearch'] } } },
    ];

    const rows = buildSettingsTable(layers, badgeMap);
    const allowRow = rows.find((r) => r.key === 'permissions.allow');
    expect(allowRow).toBeDefined();
    // Highest precedence ([L]) wins
    expect(allowRow!.displayValue).toBe('1 pattern');
    expect(strip(allowRow!.sourceBadge)).toBe('[L]');
    // Two lower-precedence layers shown as overrides
    expect(allowRow!.overrides).toHaveLength(2);
    expect(allowRow!.overrides![0].value).toBe('3 patterns');
    expect(allowRow!.overrides![1].value).toBe('1 patterns');
  });

  it('permissions.deny: aggregates from ALL layers', () => {
    const badgeMap = makeBadgeMap([
      { path: '/l', badge: '[L]' },
      { path: '/p', badge: '[P]' },
    ]);
    const layers: RawSettingsLayer[] = [
      { path: '/l', data: { permissions: { deny: ['Bash(rm *)'] } } },
      { path: '/p', data: { permissions: { deny: ['Bash(shutdown)', 'Edit(.env)'] } } },
    ];

    const rows = buildSettingsTable(layers, badgeMap);
    const denyRow = rows.find((r) => r.key === 'permissions.deny');
    expect(denyRow).toBeDefined();
    // Total count from all layers: 1 + 2 = 3
    expect(denyRow!.displayValue).toBe('3 patterns');
    // Multiple sources joined
    const badges = strip(denyRow!.sourceBadge);
    expect(badges).toContain('[L]');
    expect(badges).toContain('[P]');
    // No overrides — deny is additive
    expect(denyRow!.overrides).toBeUndefined();
  });

  it('skips empty permission arrays', () => {
    const badgeMap = makeBadgeMap([{ path: '/p', badge: '[P]' }]);
    const layers: RawSettingsLayer[] = [
      { path: '/p', data: { permissions: { allow: [], deny: [] } } },
    ];

    const rows = buildSettingsTable(layers, badgeMap);
    expect(rows.find((r) => r.key === 'permissions.allow')).toBeUndefined();
    expect(rows.find((r) => r.key === 'permissions.deny')).toBeUndefined();
  });

  // ─── Env (flattened: each env var is its own row) ───

  it('env: each env var is its own row with actual value', () => {
    const badgeMap = makeBadgeMap([
      { path: '/l', badge: '[L]' },
      { path: '/p', badge: '[P]' },
      { path: '/g', badge: '[G]' },
    ]);
    const layers: RawSettingsLayer[] = [
      { path: '/l', data: { env: { NODE_ENV: 'test', DEBUG: '1' } } },
      { path: '/p', data: { env: { NODE_ENV: 'development', API_URL: 'http://localhost' } } },
      { path: '/g', data: { env: { LOG_LEVEL: 'info' } } },
    ];

    const rows = buildSettingsTable(layers, badgeMap);

    // No combined 'env' row
    expect(rows.find((r) => r.key === 'env')).toBeUndefined();

    // Individual env var rows
    const nodeEnvRow = rows.find((r) => r.key === 'env.NODE_ENV');
    expect(nodeEnvRow).toBeDefined();
    expect(nodeEnvRow!.displayValue).toBe('test');
    expect(strip(nodeEnvRow!.sourceBadge)).toBe('[L]');
    // NODE_ENV overridden from [P]
    expect(nodeEnvRow!.overrides).toHaveLength(1);
    expect(nodeEnvRow!.overrides![0].value).toBe('development');

    const debugRow = rows.find((r) => r.key === 'env.DEBUG');
    expect(debugRow).toBeDefined();
    expect(debugRow!.displayValue).toBe('1');
    expect(strip(debugRow!.sourceBadge)).toBe('[L]');
    expect(debugRow!.overrides).toBeUndefined();

    const apiUrlRow = rows.find((r) => r.key === 'env.API_URL');
    expect(apiUrlRow).toBeDefined();
    expect(apiUrlRow!.displayValue).toBe('http://localhost');

    const logRow = rows.find((r) => r.key === 'env.LOG_LEVEL');
    expect(logRow).toBeDefined();
    expect(logRow!.displayValue).toBe('info');
  });

  it('env: single layer, no overrides', () => {
    const badgeMap = makeBadgeMap([{ path: '/p', badge: '[P]' }]);
    const layers: RawSettingsLayer[] = [
      { path: '/p', data: { env: { NODE_ENV: 'test', API_URL: 'http://localhost' } } },
    ];

    const rows = buildSettingsTable(layers, badgeMap);
    const nodeEnvRow = rows.find((r) => r.key === 'env.NODE_ENV');
    expect(nodeEnvRow!.displayValue).toBe('test');
    expect(nodeEnvRow!.overrides).toBeUndefined();

    const apiUrlRow = rows.find((r) => r.key === 'env.API_URL');
    expect(apiUrlRow!.displayValue).toBe('http://localhost');
  });

  // ─── Hooks (complex key) ───

  it('hooks: aggregates count from all layers', () => {
    const badgeMap = makeBadgeMap([
      { path: '/l', badge: '[L]' },
      { path: '/p', badge: '[P]' },
    ]);
    const layers: RawSettingsLayer[] = [
      { path: '/l', data: { hooks: { PreToolUse: [{ type: 'command', command: 'echo a' }] } } },
      { path: '/p', data: { hooks: { PostToolUse: [{ type: 'command', command: 'echo b' }, { type: 'command', command: 'echo c' }] } } },
    ];

    const rows = buildSettingsTable(layers, badgeMap);
    const hookRow = rows.find((r) => r.key === 'hooks');
    expect(hookRow).toBeDefined();
    expect(hookRow!.displayValue).toBe('3 hook(s)');
    const badges = strip(hookRow!.sourceBadge);
    expect(badges).toContain('[L]');
    expect(badges).toContain('[P]');
  });

  it('hooks: empty hooks object shows (none configured)', () => {
    const badgeMap = makeBadgeMap([{ path: '/p', badge: '[P]' }]);
    const layers: RawSettingsLayer[] = [
      { path: '/p', data: { hooks: {} } },
    ];

    const rows = buildSettingsTable(layers, badgeMap);
    const hookRow = rows.find((r) => r.key === 'hooks');
    expect(hookRow!.displayValue).toBe('(none configured)');
  });

  // ─── Sandbox (flattened: sub-fields as individual rows) ───

  it('sandbox: default mode shows only sandbox.enabled', () => {
    const badgeMap = makeBadgeMap([{ path: '/p', badge: '[P]' }]);
    const layers: RawSettingsLayer[] = [
      { path: '/p', data: { sandbox: { enabled: true, autoAllowBashIfSandboxed: true } } },
    ];

    const rows = buildSettingsTable(layers, badgeMap);
    // No combined 'sandbox' row
    expect(rows.find((r) => r.key === 'sandbox')).toBeUndefined();

    const enabledRow = rows.find((r) => r.key === 'sandbox.enabled');
    expect(enabledRow).toBeDefined();
    expect(enabledRow!.displayValue).toBe('true');

    // autoAllowBashIfSandboxed NOT shown in default mode
    expect(rows.find((r) => r.key === 'sandbox.autoAllowBashIfSandboxed')).toBeUndefined();
  });

  it('sandbox: verbose mode expands all sub-fields', () => {
    const badgeMap = makeBadgeMap([{ path: '/p', badge: '[P]' }]);
    const layers: RawSettingsLayer[] = [
      { path: '/p', data: { sandbox: { enabled: false, autoAllowBashIfSandboxed: true } } },
    ];

    const rows = buildSettingsTable(layers, badgeMap, true);
    expect(rows.find((r) => r.key === 'sandbox.enabled')!.displayValue).toBe('false');
    expect(rows.find((r) => r.key === 'sandbox.autoAllowBashIfSandboxed')!.displayValue).toBe('true');
  });

  // ─── Scalars ───

  it('formats boolean and number scalars', () => {
    const badgeMap = makeBadgeMap([{ path: '/p', badge: '[P]' }]);
    const layers: RawSettingsLayer[] = [
      { path: '/p', data: { includeCoAuthoredBy: false, cleanupPeriodDays: 20 } },
    ];

    const rows = buildSettingsTable(layers, badgeMap);
    expect(rows.find((r) => r.key === 'includeCoAuthoredBy')!.displayValue).toBe('false');
    expect(rows.find((r) => r.key === 'cleanupPeriodDays')!.displayValue).toBe('20');
  });

  it('sorts keys: model before permissions.allow before sandbox.enabled before misc', () => {
    const badgeMap = makeBadgeMap([{ path: '/p', badge: '[P]' }]);
    const layers: RawSettingsLayer[] = [
      { path: '/p', data: { cleanupPeriodDays: 20, permissions: { allow: ['Read(*)'] }, model: 'opus', sandbox: { enabled: true } } },
    ];

    const rows = buildSettingsTable(layers, badgeMap);
    const keys = rows.map((r) => r.key);
    expect(keys.indexOf('model')).toBeLessThan(keys.indexOf('permissions.allow'));
    expect(keys.indexOf('permissions.allow')).toBeLessThan(keys.indexOf('sandbox.enabled'));
    expect(keys.indexOf('sandbox.enabled')).toBeLessThan(keys.indexOf('cleanupPeriodDays'));
  });

  // ─── Permissions sub-fields ───

  it('permissions: shows sub-fields like defaultMode as individual rows', () => {
    const badgeMap = makeBadgeMap([{ path: '/p', badge: '[P]' }]);
    const layers: RawSettingsLayer[] = [
      { path: '/p', data: { permissions: { allow: ['Read(*)'], defaultMode: 'acceptEdits' } } },
    ];

    const rows = buildSettingsTable(layers, badgeMap);
    const defaultModeRow = rows.find((r) => r.key === 'permissions.defaultMode');
    expect(defaultModeRow).toBeDefined();
    expect(defaultModeRow!.displayValue).toBe('acceptEdits');
  });

  // ─── Plugins ───

  it('plugins: default mode shows count summary', () => {
    const badgeMap = makeBadgeMap([{ path: '/g', badge: '[G]' }]);
    const layers: RawSettingsLayer[] = [
      { path: '/g', data: { enabledPlugins: { 'formatter@co': true, 'analyzer@sec': false } } },
    ];

    const rows = buildSettingsTable(layers, badgeMap);
    const pluginsRow = rows.find((r) => r.key === 'enabledPlugins');
    expect(pluginsRow).toBeDefined();
    expect(pluginsRow!.displayValue).toBe('2 plugin(s)');
  });

  it('plugins: verbose mode shows individual plugin rows', () => {
    const badgeMap = makeBadgeMap([{ path: '/g', badge: '[G]' }]);
    const layers: RawSettingsLayer[] = [
      { path: '/g', data: { enabledPlugins: { 'formatter@co': true, 'analyzer@sec': false } } },
    ];

    const rows = buildSettingsTable(layers, badgeMap, true);
    // No combined row
    expect(rows.find((r) => r.key === 'enabledPlugins')).toBeUndefined();

    const formatterRow = rows.find((r) => r.key === 'enabledPlugins.formatter@co');
    expect(formatterRow).toBeDefined();
    expect(formatterRow!.displayValue).toBe('true');

    const analyzerRow = rows.find((r) => r.key === 'enabledPlugins.analyzer@sec');
    expect(analyzerRow).toBeDefined();
    expect(analyzerRow!.displayValue).toBe('false');
  });

  // ─── Env override annotation ───

  it('env: override shows overridden value from lower-precedence layer', () => {
    const badgeMap = makeBadgeMap([
      { path: '/l', badge: '[L]' },
      { path: '/p', badge: '[P]' },
    ]);
    const layers: RawSettingsLayer[] = [
      { path: '/l', data: { env: { NODE_ENV: 'test' } } },
      { path: '/p', data: { env: { NODE_ENV: 'development' } } },
    ];

    const rows = buildSettingsTable(layers, badgeMap);
    const nodeEnvRow = rows.find((r) => r.key === 'env.NODE_ENV');
    expect(nodeEnvRow!.displayValue).toBe('test');
    expect(strip(nodeEnvRow!.sourceBadge)).toBe('[L]');
    expect(nodeEnvRow!.overrides).toHaveLength(1);
    expect(nodeEnvRow!.overrides![0].value).toBe('development');
    expect(strip(nodeEnvRow!.overrides![0].badge)).toBe('[P]');
  });

  it('returns empty array when no layers', () => {
    const rows = buildSettingsTable([], new Map());
    expect(rows).toHaveLength(0);
  });

  it('handles single layer with no overrides', () => {
    const badgeMap = makeBadgeMap([{ path: '/g', badge: '[G]' }]);
    const layers: RawSettingsLayer[] = [
      { path: '/g', data: { model: 'opus', outputStyle: 'Concise' } },
    ];

    const rows = buildSettingsTable(layers, badgeMap);
    for (const row of rows) {
      expect(row.overrides).toBeUndefined();
    }
  });
});

// ─── printBlameSettings Tests ───

describe('printBlameSettings', () => {
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

  it('renders header without sources legend in default mode', () => {
    const legend: SourceEntry[] = [
      { badge: '[P]', shortPath: '.claude/settings.json', fullPath: '/proj/.claude/settings.json' },
      { badge: '[G]', shortPath: '~/.claude/settings.json', fullPath: '/home/.claude/settings.json' },
    ];
    const rows: SettingsTableRow[] = [
      { key: 'model', displayValue: 'opus', sourceBadge: '[G]' },
    ];

    printBlameSettings(rows, legend, false);

    const plain = strip(output);
    expect(plain).toContain('ccinspect blame settings');
    // No Sources legend in default mode
    expect(plain).not.toContain('Sources');
    expect(plain).not.toContain('.claude/settings.json');
  });

  it('renders sources legend in verbose mode', () => {
    const legend: SourceEntry[] = [
      { badge: '[P]', shortPath: '.claude/settings.json', fullPath: '/proj/.claude/settings.json' },
      { badge: '[G]', shortPath: '~/.claude/settings.json', fullPath: '/home/.claude/settings.json' },
    ];
    const rows: SettingsTableRow[] = [
      { key: 'model', displayValue: 'opus', sourceBadge: '[G]' },
    ];

    printBlameSettings(rows, legend, true);

    const plain = strip(output);
    expect(plain).toContain('Sources');
    expect(plain).toContain('[P] Project .claude/settings.json');
    expect(plain).toContain('[G] Global ~/.claude/settings.json');
  });

  it('renders columnar table with Key/Value/Source headers and badge labels', () => {
    const legend: SourceEntry[] = [
      { badge: '[P]', shortPath: '.claude/settings.json', fullPath: '/p' },
    ];
    const rows: SettingsTableRow[] = [
      { key: 'model', displayValue: 'opus', sourceBadge: '[P]' },
      { key: 'cleanupPeriodDays', displayValue: '20', sourceBadge: '[P]' },
    ];

    printBlameSettings(rows, legend, false);

    const plain = strip(output);
    expect(plain).toContain('Key');
    expect(plain).toContain('Value');
    expect(plain).toContain('Source');
    expect(plain).toContain('model');
    expect(plain).toContain('opus');
    expect(plain).toContain('[P] Project');
    expect(plain).toContain('cleanupPeriodDays');
    expect(plain).toContain('20');
  });

  it('shows footer with file and key counts', () => {
    const legend: SourceEntry[] = [
      { badge: '[P]', shortPath: '.claude/settings.json', fullPath: '/p' },
      { badge: '[G]', shortPath: '~/.claude/settings.json', fullPath: '/g' },
    ];
    const rows: SettingsTableRow[] = [
      { key: 'model', displayValue: 'opus', sourceBadge: '[P]' },
      { key: 'outputStyle', displayValue: 'Concise', sourceBadge: '[G]' },
      { key: 'cleanupPeriodDays', displayValue: '20', sourceBadge: '[P]' },
    ];

    printBlameSettings(rows, legend, false);

    const plain = strip(output);
    expect(plain).toContain('2 files loaded');
    expect(plain).toContain('3 keys resolved');
  });

  it('shows inline override annotation with labels in default mode', () => {
    const legend: SourceEntry[] = [
      { badge: '[P]', shortPath: '.claude/settings.json', fullPath: '/p' },
    ];
    const rows: SettingsTableRow[] = [
      {
        key: 'model',
        displayValue: 'opus',
        sourceBadge: '[P]',
        overrides: [{ value: 'sonnet', badge: '[G]' }],
      },
    ];

    printBlameSettings(rows, legend, false);

    const plain = strip(output);
    // Inline annotation with label: "(overrides [G] Global)"
    expect(plain).toContain('[P] Project');
    expect(plain).toContain('(overrides [G] Global)');
    // No verbose ↳ lines in default mode
    expect(plain).not.toContain('↳');
  });

  it('shows expanded overrides in verbose mode', () => {
    const legend: SourceEntry[] = [
      { badge: '[P]', shortPath: '.claude/settings.json', fullPath: '/p' },
    ];
    const rows: SettingsTableRow[] = [
      {
        key: 'model',
        displayValue: 'opus',
        sourceBadge: '[P]',
        overrides: [{ value: 'sonnet', badge: '[G]' }],
      },
    ];

    printBlameSettings(rows, legend, true);

    const plain = strip(output);
    // Inline override still present
    expect(plain).toContain('(overrides [G] Global)');
    // Verbose ↳ detail lines also present
    expect(plain).toContain('↳ overridden value: "sonnet" from [G] Global');
  });

  it('no override annotation when no overrides exist', () => {
    const legend: SourceEntry[] = [
      { badge: '[P]', shortPath: '.claude/settings.json', fullPath: '/p' },
    ];
    const rows: SettingsTableRow[] = [
      { key: 'model', displayValue: 'opus', sourceBadge: '[P]' },
    ];

    printBlameSettings(rows, legend, false);

    const plain = strip(output);
    expect(plain).not.toContain('overrides');
    expect(plain).not.toContain('↳');
    // Badge still has label
    expect(plain).toContain('[P] Project');
  });

  it('shows multi-source labels for aggregated badges', () => {
    const legend: SourceEntry[] = [
      { badge: '[L]', shortPath: '.claude/settings.local.json', fullPath: '/l' },
      { badge: '[P]', shortPath: '.claude/settings.json', fullPath: '/p' },
    ];
    const rows: SettingsTableRow[] = [
      { key: 'permissions.deny', displayValue: '3 patterns', sourceBadge: '[L] + [P]' },
    ];

    printBlameSettings(rows, legend, false);

    const plain = strip(output);
    expect(plain).toContain('[L] Local + [P] Project');
  });

  it('shows graceful message when no settings files found', () => {
    printBlameSettings([], [], false);

    const plain = strip(output);
    expect(plain).toContain('No settings files found.');
  });

  it('renders separator lines', () => {
    const legend: SourceEntry[] = [
      { badge: '[P]', shortPath: '.claude/settings.json', fullPath: '/p' },
    ];
    const rows: SettingsTableRow[] = [
      { key: 'model', displayValue: 'opus', sourceBadge: '[P]' },
    ];

    printBlameSettings(rows, legend, false);

    const plain = strip(output);
    expect(plain).toContain('─'.repeat(10));
  });
});

// ─── printBlameSettingsJson Tests ───

describe('printBlameSettingsJson', () => {
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

  it('outputs valid JSON with key, value, source fields', () => {
    const rows: SettingsTableRow[] = [
      { key: 'model', displayValue: 'opus', sourceBadge: '[P]' },
      { key: 'cleanupPeriodDays', displayValue: '20', sourceBadge: '[G]' },
    ];

    printBlameSettingsJson(rows);

    const parsed = JSON.parse(output.trim());
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ key: 'model', value: 'opus', source: '[P]' });
    expect(parsed[1]).toEqual({ key: 'cleanupPeriodDays', value: '20', source: '[G]' });
  });

  it('includes overrides in JSON when present', () => {
    const rows: SettingsTableRow[] = [
      {
        key: 'model',
        displayValue: 'opus',
        sourceBadge: '[P]',
        overrides: [{ value: 'sonnet', badge: '[G]' }],
      },
    ];

    printBlameSettingsJson(rows);

    const parsed = JSON.parse(output.trim());
    expect(parsed[0].overrides).toEqual([{ value: 'sonnet', badge: '[G]' }]);
  });

  it('omits overrides key when not present', () => {
    const rows: SettingsTableRow[] = [
      { key: 'model', displayValue: 'opus', sourceBadge: '[P]' },
    ];

    printBlameSettingsJson(rows);

    const parsed = JSON.parse(output.trim());
    expect(parsed[0]).not.toHaveProperty('overrides');
  });
});
