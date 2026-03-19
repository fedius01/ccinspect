import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  reconstruct,
  getHistory,
  getVersion,
  computeLineage,
  resolveHistoryDir,
} from '../../src/core/history-reconstructor.js';
import type { ConfigInventory, FileInfo } from '../../src/types/inventory.js';
import type { HistoryEntry } from '../../src/types/history.js';

// Mock git-history-miner to avoid real git calls
vi.mock('../../src/core/git-history-miner.js', () => ({
  mineGitHistory: vi.fn().mockReturnValue([]),
  extractConfigPaths: vi.fn().mockReturnValue([]),
}));

// Mock transcript-config-miner to avoid real transcript parsing
vi.mock('../../src/core/transcript-config-miner.js', () => ({
  mineTranscriptConfigChanges: vi.fn().mockResolvedValue([]),
}));

// Mock transcript-discovery to avoid home dir access
vi.mock('../../src/utils/transcript-discovery.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/transcript-discovery.js')>();
  return {
    ...actual,
    encodeProjectPath: actual.encodeProjectPath,
  };
});

const TEST_DIR = join(tmpdir(), 'ccinspect-history-test-' + Date.now());
const PROJECT_DIR = join(TEST_DIR, 'project');
const CLAUDE_MD_PATH = join(PROJECT_DIR, 'CLAUDE.md');

function makeInventory(claudeMdContent?: string): ConfigInventory {
  // Write a real CLAUDE.md file if content is provided
  if (claudeMdContent) {
    mkdirSync(PROJECT_DIR, { recursive: true });
    writeFileSync(CLAUDE_MD_PATH, claudeMdContent, 'utf-8');
  }

  const makeFileInfo = (path: string, exists: boolean): FileInfo => ({
    path,
    relativePath: path.replace(PROJECT_DIR + '/', ''),
    exists,
    scope: 'project-shared',
    sizeBytes: exists ? 100 : 0,
    lineCount: exists ? 10 : 0,
    estimatedTokens: exists ? 25 : 0,
    gitTracked: false,
    lastModified: new Date(),
  });

  return {
    projectRoot: PROJECT_DIR,
    gitRoot: PROJECT_DIR,
    userSettings: null,
    projectSettings: null,
    localSettings: null,
    managedSettings: null,
    preferences: null,
    enterpriseClaudeMd: null,
    globalClaudeMd: null,
    projectClaudeMd: claudeMdContent ? makeFileInfo(CLAUDE_MD_PATH, true) : null,
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
    totalFiles: claudeMdContent ? 1 : 0,
    totalStartupTokens: 0,
    totalOnDemandTokens: 0,
  };
}

describe('history-reconstructor', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(PROJECT_DIR, { recursive: true });

    // Override HOME to use test dir for history storage
    vi.stubEnv('HOME', TEST_DIR);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // cleanup failure is ok
    }
  });

  describe('resolveHistoryDir', () => {
    it('encodes project path into history directory', () => {
      const dir = resolveHistoryDir('/Users/dev/my-project');
      expect(dir).toContain('.ccinspect/projects/');
      expect(dir).toContain('history');
    });
  });

  describe('reconstruct', () => {
    it('creates history directory on first run', async () => {
      const inventory = makeInventory('# My Project');
      await reconstruct(PROJECT_DIR, inventory, { sources: { git: false } });

      const historyDir = resolveHistoryDir(PROJECT_DIR);
      expect(existsSync(historyDir)).toBe(true);
    });

    it('creates v1 from disk snapshot on first run', async () => {
      const inventory = makeInventory('# My Project\nSome content');
      const entries = await reconstruct(PROJECT_DIR, inventory, { sources: { git: false } });

      expect(entries.length).toBeGreaterThanOrEqual(1);
      const firstEntry = entries[0];
      expect(firstEntry.version).toBe(1);
      expect(firstEntry.source).toBe('disk');
      expect(firstEntry.contentHash).toBeTruthy();
      expect(firstEntry.tokenCount).toBeGreaterThan(0);
    });

    it('does not create duplicate versions on second run with no changes', async () => {
      const inventory = makeInventory('# My Project\nSame content');

      const entries1 = await reconstruct(PROJECT_DIR, inventory, { sources: { git: false } });
      const entries2 = await reconstruct(PROJECT_DIR, inventory, { sources: { git: false } });

      // Second run should not add new versions
      expect(entries2.length).toBe(entries1.length);
    });

    it('creates new version when content changes between runs', async () => {
      const inventory1 = makeInventory('# Version 1');
      const entries1 = await reconstruct(PROJECT_DIR, inventory1, { sources: { git: false } });

      // Change the file content
      writeFileSync(CLAUDE_MD_PATH, '# Version 2 with changes', 'utf-8');
      const inventory2 = makeInventory(); // reuse the existing file
      // Need to update the inventory to reflect the new content
      if (inventory2.projectClaudeMd) {
        inventory2.projectClaudeMd = {
          ...inventory2.projectClaudeMd,
          path: CLAUDE_MD_PATH,
          exists: true,
        };
      } else {
        inventory2.projectClaudeMd = {
          path: CLAUDE_MD_PATH,
          relativePath: 'CLAUDE.md',
          exists: true,
          scope: 'project-shared',
          sizeBytes: 100,
          lineCount: 1,
          estimatedTokens: 10,
          gitTracked: false,
          lastModified: new Date(),
        };
      }

      const entries2 = await reconstruct(PROJECT_DIR, inventory2, { sources: { git: false } });

      expect(entries2.length).toBe(entries1.length + 1);
      const newEntry = entries2[entries2.length - 1];
      expect(newEntry.version).toBe(2);
      expect(newEntry.source).toBe('disk');
    });

    it('writes reconstruction cache', async () => {
      const inventory = makeInventory('# Test');
      await reconstruct(PROJECT_DIR, inventory, { sources: { git: false } });

      const historyDir = resolveHistoryDir(PROJECT_DIR);
      const cachePath = join(historyDir, 'reconstruction-cache.json');
      expect(existsSync(cachePath)).toBe(true);

      const cache = JSON.parse(readFileSync(cachePath, 'utf-8'));
      expect(cache.cacheVersion).toBe(1);
      expect(cache.totalVersions).toBeGreaterThan(0);
    });

    it('writes history.jsonl with valid JSON lines', async () => {
      const inventory = makeInventory('# Test content');
      await reconstruct(PROJECT_DIR, inventory, { sources: { git: false } });

      const historyDir = resolveHistoryDir(PROJECT_DIR);
      const logPath = join(historyDir, 'history.jsonl');
      expect(existsSync(logPath)).toBe(true);

      const content = readFileSync(logPath, 'utf-8');
      const lines = content.trim().split('\n');
      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed.version).toBeDefined();
        expect(parsed.timestamp).toBeDefined();
        expect(parsed.contentHash).toBeDefined();
      }
    });

    it('writes version snapshot files', async () => {
      const inventory = makeInventory('# Snapshot test');
      await reconstruct(PROJECT_DIR, inventory, { sources: { git: false } });

      const historyDir = resolveHistoryDir(PROJECT_DIR);
      expect(existsSync(join(historyDir, 'v001.json'))).toBe(true);

      const snapshot = JSON.parse(readFileSync(join(historyDir, 'v001.json'), 'utf-8'));
      expect(snapshot.version).toBe(1);
      expect(snapshot.files).toBeDefined();
      expect(snapshot.files.length).toBeGreaterThan(0);
      expect(snapshot.files[0].content).toBeTruthy();
    });

    it('handles empty inventory (no config files)', async () => {
      const inventory = makeInventory();
      const entries = await reconstruct(PROJECT_DIR, inventory, { sources: { git: false } });
      expect(entries).toHaveLength(0);
    });
  });

  describe('getHistory', () => {
    it('returns empty for non-existent history', () => {
      const entries = getHistory('/nonexistent/path');
      expect(entries).toHaveLength(0);
    });

    it('returns entries after reconstruction', async () => {
      const inventory = makeInventory('# History test');
      await reconstruct(PROJECT_DIR, inventory, { sources: { git: false } });

      const entries = getHistory(PROJECT_DIR);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0].version).toBe(1);
    });
  });

  describe('getVersion', () => {
    it('returns null for non-existent version', () => {
      const version = getVersion('/nonexistent/path', 99);
      expect(version).toBeNull();
    });

    it('returns version snapshot after reconstruction', async () => {
      const inventory = makeInventory('# Version test');
      await reconstruct(PROJECT_DIR, inventory, { sources: { git: false } });

      const version = getVersion(PROJECT_DIR, 1);
      expect(version).not.toBeNull();
      expect(version!.version).toBe(1);
      expect(version!.files.length).toBeGreaterThan(0);
    });
  });

  describe('computeLineage', () => {
    it('returns empty set for empty entries', () => {
      const lineage = computeLineage([]);
      expect(lineage.size).toBe(0);
    });

    it('returns all versions for a simple chain', () => {
      const entries: HistoryEntry[] = [
        makeEntry(1, 0),
        makeEntry(2, 1),
        makeEntry(3, 2),
        makeEntry(4, 3),
        makeEntry(5, 4),
      ];

      const lineage = computeLineage(entries);
      expect(lineage.size).toBe(5);
      expect(lineage.has(1)).toBe(true);
      expect(lineage.has(5)).toBe(true);
    });

    it('follows parentVersion chain for restore operations', () => {
      const entries: HistoryEntry[] = [
        makeEntry(1, 0),
        makeEntry(2, 1),
        makeEntry(3, 2),  // superseded
        makeEntry(4, 3),  // superseded
        makeEntry(5, 2),  // restore from v2 — skips v3 and v4
      ];

      const lineage = computeLineage(entries);
      expect(lineage.has(5)).toBe(true);
      expect(lineage.has(2)).toBe(true);
      expect(lineage.has(1)).toBe(true);
      // v3 and v4 are not in lineage because v5 points to v2
      expect(lineage.has(3)).toBe(false);
      expect(lineage.has(4)).toBe(false);
    });

    it('handles single version', () => {
      const entries: HistoryEntry[] = [makeEntry(1, 0)];
      const lineage = computeLineage(entries);
      expect(lineage.size).toBe(1);
      expect(lineage.has(1)).toBe(true);
    });

    it('breaks on cycles', () => {
      // Shouldn't happen in practice, but guard against infinite loops
      const entries: HistoryEntry[] = [
        makeEntry(1, 2), // circular
        makeEntry(2, 1),
      ];
      const lineage = computeLineage(entries);
      // Should terminate without hanging
      expect(lineage.size).toBeLessThanOrEqual(2);
    });
  });
});

function makeEntry(version: number, parentVersion: number): HistoryEntry {
  return {
    version,
    parentVersion,
    timestamp: new Date().toISOString(),
    source: 'git',
    contentHash: 'hash' + version,
    tokenCount: 100,
    filesChanged: 1,
    linesAdded: 5,
    linesRemoved: 2,
    summary: `Version ${version}`,
  };
}
