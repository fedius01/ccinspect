import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { diffVersions, resolveVersion } from '../../src/core/snapshot-diff.js';
import {
  reconstruct,
  getHistory,
  getVersion,
  computeLineage,
  appendRestoreVersion,
} from '../../src/core/history-reconstructor.js';
import type { ConfigVersion, ConfigFileSnapshot } from '../../src/types/history.js';
import type { ConfigInventory, FileInfo } from '../../src/types/inventory.js';

// Mock git and transcript miners
vi.mock('../../src/core/git-history-miner.js', () => ({
  mineGitHistory: vi.fn().mockReturnValue([]),
  extractConfigPaths: vi.fn().mockReturnValue([]),
}));

vi.mock('../../src/core/transcript-config-miner.js', () => ({
  mineTranscriptConfigChanges: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/utils/transcript-discovery.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/transcript-discovery.js')>();
  return { ...actual, encodeProjectPath: actual.encodeProjectPath };
});

const TEST_DIR = join(tmpdir(), 'ccinspect-diff-test-' + Date.now());
const PROJECT_DIR = join(TEST_DIR, 'project');
const CLAUDE_MD_PATH = join(PROJECT_DIR, 'CLAUDE.md');
const SETTINGS_PATH = join(PROJECT_DIR, '.claude', 'settings.json');

function makeSnapshot(
  relPath: string,
  absPath: string,
  content: string,
): ConfigFileSnapshot {
  return {
    relativePath: relPath,
    absolutePath: absPath,
    scope: 'project-shared',
    type: 'claude-md',
    contentHash: `hash-${content.length}`,
    content,
    sizeBytes: Buffer.byteLength(content),
    estimatedTokens: Math.ceil(content.length / 4),
    lastModified: new Date().toISOString(),
  };
}

function makeVersion(
  version: number,
  files: ConfigFileSnapshot[],
  overrides?: Partial<ConfigVersion>,
): ConfigVersion {
  return {
    version,
    parentVersion: version > 1 ? version - 1 : 0,
    timestamp: new Date().toISOString(),
    source: 'git',
    contentHash: `version-hash-${version}`,
    tokenCount: files.reduce((s, f) => s + f.estimatedTokens, 0),
    files,
    ...overrides,
  };
}

function makeInventory(claudeMdContent?: string): ConfigInventory {
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

describe('snapshot-diff', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(PROJECT_DIR, { recursive: true });
    vi.stubEnv('HOME', TEST_DIR);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // cleanup ok
    }
  });

  describe('diffVersions', () => {
    it('detects no changes between identical versions', () => {
      const file = makeSnapshot('CLAUDE.md', CLAUDE_MD_PATH, '# Hello\nWorld');
      const v1 = makeVersion(1, [file]);
      const v2 = makeVersion(2, [file]);

      const result = diffVersions(PROJECT_DIR, v1, v2);
      expect(result.summary.filesChanged).toBe(0);
      expect(result.files).toHaveLength(1);
      expect(result.files[0].status).toBe('unchanged');
    });

    it('detects added file', () => {
      const v1 = makeVersion(1, []);
      const file = makeSnapshot('CLAUDE.md', CLAUDE_MD_PATH, '# New\nContent');
      const v2 = makeVersion(2, [file]);

      const result = diffVersions(PROJECT_DIR, v1, v2);
      expect(result.summary.filesChanged).toBe(1);
      expect(result.summary.linesAdded).toBe(2);
      expect(result.summary.linesRemoved).toBe(0);
      expect(result.files[0].status).toBe('added');
      expect(result.files[0].hunks).toHaveLength(1);
      expect(result.files[0].hunks[0].lines.every((l) => l.type === 'add')).toBe(true);
    });

    it('detects removed file', () => {
      const file = makeSnapshot('CLAUDE.md', CLAUDE_MD_PATH, '# Old\nContent');
      const v1 = makeVersion(1, [file]);
      const v2 = makeVersion(2, []);

      const result = diffVersions(PROJECT_DIR, v1, v2);
      expect(result.summary.filesChanged).toBe(1);
      expect(result.summary.linesRemoved).toBe(2);
      expect(result.summary.linesAdded).toBe(0);
      expect(result.files[0].status).toBe('removed');
    });

    it('detects modified file with hunks', () => {
      const fileA = makeSnapshot('CLAUDE.md', CLAUDE_MD_PATH, '# Title\nLine 1\nLine 2\nLine 3');
      // Give fileB a different contentHash
      const fileB: ConfigFileSnapshot = {
        ...makeSnapshot('CLAUDE.md', CLAUDE_MD_PATH, '# Title\nLine 1 changed\nLine 2\nLine 3'),
        contentHash: 'different-hash',
      };

      const v1 = makeVersion(1, [fileA]);
      const v2 = makeVersion(2, [fileB]);

      const result = diffVersions(PROJECT_DIR, v1, v2);
      expect(result.summary.filesChanged).toBe(1);
      expect(result.files[0].status).toBe('modified');
      expect(result.files[0].hunks.length).toBeGreaterThan(0);

      // Should have at least one add and one remove
      const allLines = result.files[0].hunks.flatMap((h) => h.lines);
      expect(allLines.some((l) => l.type === 'add')).toBe(true);
      expect(allLines.some((l) => l.type === 'remove')).toBe(true);
    });

    it('filters by file path when specified', () => {
      const fileA = makeSnapshot('CLAUDE.md', CLAUDE_MD_PATH, '# A');
      const fileB = makeSnapshot('.claude/settings.json', SETTINGS_PATH, '{}');
      const fileC: ConfigFileSnapshot = {
        ...makeSnapshot('CLAUDE.md', CLAUDE_MD_PATH, '# A changed'),
        contentHash: 'changed',
      };

      const v1 = makeVersion(1, [fileA, fileB]);
      const v2 = makeVersion(2, [fileC, fileB]);

      // Filter to CLAUDE.md only
      const result = diffVersions(PROJECT_DIR, v1, v2, 'CLAUDE.md');
      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe('CLAUDE.md');
    });

    it('computes token delta correctly', () => {
      const fileA: ConfigFileSnapshot = {
        ...makeSnapshot('CLAUDE.md', CLAUDE_MD_PATH, '# Short'),
        estimatedTokens: 10,
      };
      const fileB: ConfigFileSnapshot = {
        ...makeSnapshot('CLAUDE.md', CLAUDE_MD_PATH, '# Much longer content here'),
        contentHash: 'different',
        estimatedTokens: 30,
      };

      const v1 = makeVersion(1, [fileA]);
      const v2 = makeVersion(2, [fileB]);

      const result = diffVersions(PROJECT_DIR, v1, v2);
      expect(result.summary.tokenDelta).toBe(20);
    });
  });

  describe('resolveVersion', () => {
    it('parses "v3" format', async () => {
      const inventory = makeInventory('# Test');
      await reconstruct(PROJECT_DIR, inventory, { sources: { git: false } });

      const version = resolveVersion(PROJECT_DIR, 'v1', PROJECT_DIR);
      expect(version).not.toBeNull();
      expect(version!.version).toBe(1);
    });

    it('parses bare number "3" format', async () => {
      const inventory = makeInventory('# Test');
      await reconstruct(PROJECT_DIR, inventory, { sources: { git: false } });

      const version = resolveVersion(PROJECT_DIR, '1', PROJECT_DIR);
      expect(version).not.toBeNull();
      expect(version!.version).toBe(1);
    });

    it('returns null for non-existent version', () => {
      const version = resolveVersion(PROJECT_DIR, 'v999', PROJECT_DIR);
      expect(version).toBeNull();
    });

    it('returns null for invalid input', () => {
      expect(resolveVersion(PROJECT_DIR, 'abc', PROJECT_DIR)).toBeNull();
      expect(resolveVersion(PROJECT_DIR, 'v0', PROJECT_DIR)).toBeNull();
      expect(resolveVersion(PROJECT_DIR, 'v-1', PROJECT_DIR)).toBeNull();
    });

    it('resolves "current" to disk state', async () => {
      const inventory = makeInventory('# Current content');
      await reconstruct(PROJECT_DIR, inventory, { sources: { git: false } });

      const version = resolveVersion(PROJECT_DIR, 'current', PROJECT_DIR);
      expect(version).not.toBeNull();
      expect(version!.source).toBe('disk');

      // Should contain the current file content
      const claudeMdFile = version!.files.find((f) => f.relativePath === 'CLAUDE.md');
      expect(claudeMdFile).toBeTruthy();
      expect(claudeMdFile!.content).toBe('# Current content');
    });
  });

  describe('diff with current', () => {
    it('shows differences between historical version and current disk', async () => {
      // Create initial version
      const inventory = makeInventory('# Version 1\nOriginal');
      await reconstruct(PROJECT_DIR, inventory, { sources: { git: false } });

      // Modify the file on disk
      writeFileSync(CLAUDE_MD_PATH, '# Version 1\nModified on disk', 'utf-8');

      const v1 = resolveVersion(PROJECT_DIR, '1', PROJECT_DIR);
      const current = resolveVersion(PROJECT_DIR, 'current', PROJECT_DIR);

      expect(v1).not.toBeNull();
      expect(current).not.toBeNull();

      const result = diffVersions(PROJECT_DIR, v1!, current!);
      expect(result.summary.filesChanged).toBe(1);
    });
  });

  describe('appendRestoreVersion', () => {
    it('appends a restore version with correct version number', async () => {
      const inventory = makeInventory('# Initial');
      await reconstruct(PROJECT_DIR, inventory, { sources: { git: false } });

      const entries1 = getHistory(PROJECT_DIR);
      expect(entries1).toHaveLength(1);

      // Create a restore version
      const targetVersion = getVersion(PROJECT_DIR, 1)!;
      const restoreVersion: ConfigVersion = {
        version: 0,
        parentVersion: 1,
        restoredFrom: 1,
        timestamp: new Date().toISOString(),
        source: 'restore',
        trigger: 'restore',
        contentHash: targetVersion.contentHash,
        tokenCount: targetVersion.tokenCount,
        files: targetVersion.files,
      };

      const assigned = appendRestoreVersion(PROJECT_DIR, restoreVersion);
      expect(assigned).toBe(2);

      const entries2 = getHistory(PROJECT_DIR);
      expect(entries2).toHaveLength(2);
      expect(entries2[1].version).toBe(2);
      expect(entries2[1].source).toBe('restore');
      expect(entries2[1].restoredFrom).toBe(1);
      expect(entries2[1].parentVersion).toBe(1);
    });

    it('restore version makes superseded versions drop from lineage', async () => {
      const inventory = makeInventory('# V1');
      await reconstruct(PROJECT_DIR, inventory, { sources: { git: false } });

      // Create v2
      writeFileSync(CLAUDE_MD_PATH, '# V2 content', 'utf-8');
      inventory.projectClaudeMd = {
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
      await reconstruct(PROJECT_DIR, inventory, { sources: { git: false } });

      // Create v3
      writeFileSync(CLAUDE_MD_PATH, '# V3 content', 'utf-8');
      await reconstruct(PROJECT_DIR, inventory, { sources: { git: false } });

      const entries3 = getHistory(PROJECT_DIR);
      expect(entries3.length).toBeGreaterThanOrEqual(3);

      // Restore to v1 — this should make v2 and v3 superseded
      const v1 = getVersion(PROJECT_DIR, 1)!;
      const restoreVersion: ConfigVersion = {
        version: 0,
        parentVersion: 1,
        restoredFrom: 1,
        timestamp: new Date().toISOString(),
        source: 'restore',
        trigger: 'restore',
        contentHash: v1.contentHash,
        tokenCount: v1.tokenCount,
        files: v1.files,
      };

      const assigned = appendRestoreVersion(PROJECT_DIR, restoreVersion);
      const entriesAfter = getHistory(PROJECT_DIR);
      const lineage = computeLineage(entriesAfter);

      // Active lineage: v_restore → v1
      expect(lineage.has(assigned)).toBe(true);
      expect(lineage.has(1)).toBe(true);

      // v2 and v3 should NOT be in lineage
      expect(lineage.has(2)).toBe(false);
      expect(lineage.has(3)).toBe(false);
    });
  });

  describe('hunk generation', () => {
    it('produces context lines around changes', () => {
      const oldContent = 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10';
      const newContent = 'line 1\nline 2\nline 3\nline 4\nLINE 5 CHANGED\nline 6\nline 7\nline 8\nline 9\nline 10';

      const fileA: ConfigFileSnapshot = {
        ...makeSnapshot('CLAUDE.md', CLAUDE_MD_PATH, oldContent),
        contentHash: 'old',
      };
      const fileB: ConfigFileSnapshot = {
        ...makeSnapshot('CLAUDE.md', CLAUDE_MD_PATH, newContent),
        contentHash: 'new',
      };

      const result = diffVersions(PROJECT_DIR, makeVersion(1, [fileA]), makeVersion(2, [fileB]));
      expect(result.files[0].hunks.length).toBeGreaterThan(0);

      const hunk = result.files[0].hunks[0];
      // Should have context lines around the change
      expect(hunk.lines.some((l) => l.type === 'context')).toBe(true);
      expect(hunk.lines.some((l) => l.type === 'remove' && l.content === 'line 5')).toBe(true);
      expect(hunk.lines.some((l) => l.type === 'add' && l.content === 'LINE 5 CHANGED')).toBe(true);
    });

    it('handles completely different content', () => {
      const fileA: ConfigFileSnapshot = {
        ...makeSnapshot('CLAUDE.md', CLAUDE_MD_PATH, 'AAA\nBBB\nCCC'),
        contentHash: 'old',
      };
      const fileB: ConfigFileSnapshot = {
        ...makeSnapshot('CLAUDE.md', CLAUDE_MD_PATH, 'XXX\nYYY\nZZZ'),
        contentHash: 'new',
      };

      const result = diffVersions(PROJECT_DIR, makeVersion(1, [fileA]), makeVersion(2, [fileB]));
      expect(result.summary.filesChanged).toBe(1);
      expect(result.summary.linesAdded).toBe(3);
      expect(result.summary.linesRemoved).toBe(3);
    });

    it('handles empty content', () => {
      const fileA: ConfigFileSnapshot = {
        ...makeSnapshot('CLAUDE.md', CLAUDE_MD_PATH, ''),
        contentHash: 'empty',
      };
      const fileB: ConfigFileSnapshot = {
        ...makeSnapshot('CLAUDE.md', CLAUDE_MD_PATH, '# New content'),
        contentHash: 'new',
      };

      const result = diffVersions(PROJECT_DIR, makeVersion(1, [fileA]), makeVersion(2, [fileB]));
      expect(result.summary.filesChanged).toBe(1);
      expect(result.summary.linesAdded).toBeGreaterThan(0);
    });
  });
});
