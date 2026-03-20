import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { lowTranscriptRetentionRule } from '../../src/rules/settings/low-transcript-retention.js';
import { createEmptyResolvedConfig } from '../../src/core/resolver.js';
import type { ConfigInventory, FileInfo } from '../../src/types/index.js';

const resolved = createEmptyResolvedConfig();

let tempDir: string;

function setupTempDir(): string {
  tempDir = join(tmpdir(), `cci-test-retention-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

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

function makeSettingsFile(dir: string, content: Record<string, unknown>): FileInfo {
  const filePath = join(dir, 'settings.json');
  writeFileSync(filePath, JSON.stringify(content));
  return {
    path: filePath,
    relativePath: 'settings.json',
    exists: true,
    scope: 'user',
    sizeBytes: 100,
    lineCount: 5,
    estimatedTokens: 30,
    gitTracked: false,
    lastModified: new Date(),
  };
}

describe('settings/low-transcript-retention rule', () => {
  it('fires when cleanupPeriodDays is not set anywhere (default 30)', () => {
    const inventory = makeInventory();
    const issues = lowTranscriptRetentionRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('info');
    expect(issues[0].message).toContain('not set');
    expect(issues[0].message).toContain('default: 30');
  });

  it('fires with info when cleanupPeriodDays is 30', () => {
    const dir = setupTempDir();
    const fileInfo = makeSettingsFile(dir, { cleanupPeriodDays: 30 });
    const inventory = makeInventory({ userSettings: fileInfo });
    const issues = lowTranscriptRetentionRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('info');
    expect(issues[0].message).toContain('30');
  });

  it('fires with warning when cleanupPeriodDays is 0 (CC bug #23710)', () => {
    const dir = setupTempDir();
    const fileInfo = makeSettingsFile(dir, { cleanupPeriodDays: 0 });
    const inventory = makeInventory({ userSettings: fileInfo });
    const issues = lowTranscriptRetentionRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].message).toContain('disables transcript writing');
    expect(issues[0].message).toContain('#23710');
  });

  it('does not fire when cleanupPeriodDays is 99999', () => {
    const dir = setupTempDir();
    const fileInfo = makeSettingsFile(dir, { cleanupPeriodDays: 99999 });
    const inventory = makeInventory({ userSettings: fileInfo });
    const issues = lowTranscriptRetentionRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('does not fire when cleanupPeriodDays is 365', () => {
    const dir = setupTempDir();
    const fileInfo = makeSettingsFile(dir, { cleanupPeriodDays: 365 });
    const inventory = makeInventory({ userSettings: fileInfo });
    const issues = lowTranscriptRetentionRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('does not fire when cleanupPeriodDays is exactly 90', () => {
    const dir = setupTempDir();
    const fileInfo = makeSettingsFile(dir, { cleanupPeriodDays: 90 });
    const inventory = makeInventory({ userSettings: fileInfo });
    const issues = lowTranscriptRetentionRule.check(inventory, resolved);
    expect(issues).toHaveLength(0);
  });

  it('fires with info when cleanupPeriodDays is 60', () => {
    const dir = setupTempDir();
    const fileInfo = makeSettingsFile(dir, { cleanupPeriodDays: 60 });
    const inventory = makeInventory({ userSettings: fileInfo });
    const issues = lowTranscriptRetentionRule.check(inventory, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('info');
    expect(issues[0].message).toContain('60');
  });

  it('uses highest-precedence settings file', () => {
    const dir = setupTempDir();
    // Local settings (higher precedence) has low value
    const localDir = join(dir, 'local');
    mkdirSync(localDir);
    const localFile = makeSettingsFile(localDir, { cleanupPeriodDays: 10 });
    localFile.scope = 'project-local';
    // User settings (lower precedence) has high value
    const userDir = join(dir, 'user');
    mkdirSync(userDir);
    const userFile = makeSettingsFile(userDir, { cleanupPeriodDays: 99999 });

    const inventory = makeInventory({
      localSettings: localFile,
      userSettings: userFile,
    });
    const issues = lowTranscriptRetentionRule.check(inventory, resolved);
    // Should fire because local (higher precedence) has 10
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('10');
  });

  it('skips non-existent settings files', () => {
    const inventory = makeInventory({
      userSettings: {
        path: '/nonexistent/settings.json',
        relativePath: 'settings.json',
        exists: false,
        scope: 'user',
        sizeBytes: 0,
        lineCount: 0,
        estimatedTokens: 0,
        gitTracked: false,
        lastModified: new Date(),
      },
    });
    const issues = lowTranscriptRetentionRule.check(inventory, resolved);
    // Not found → fires with default message
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('not set');
  });
});
