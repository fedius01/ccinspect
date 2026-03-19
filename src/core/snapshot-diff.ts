import { readFileSync, existsSync } from 'fs';
import { relative } from 'path';
import { hashContent } from '../utils/content-hash.js';
import { estimateTokens } from '../utils/tokens.js';
import { classifyConfigFile, inferScope } from '../utils/file-classifier.js';
import { getVersion, getHistory } from './history-reconstructor.js';
import type {
  ConfigVersion,
  ConfigFileSnapshot,
  DiffLine,
  DiffHunk,
  FileDiff,
  DiffResult,
} from '../types/history.js';

/**
 * Compute a structured diff between two config versions.
 * Supports "current" as a virtual version built from disk state.
 *
 * @param projectRoot - Absolute project root path
 * @param versionA - First version number or "current"
 * @param versionB - Second version number or "current"
 * @param filePath - Optional: restrict diff to a single file (relative path)
 */
export function diffVersions(
  projectRoot: string,
  versionA: ConfigVersion,
  versionB: ConfigVersion,
  filePath?: string,
): DiffResult {
  const filesA = new Map(versionA.files.map((f) => [f.relativePath, f]));
  const filesB = new Map(versionB.files.map((f) => [f.relativePath, f]));

  // If filtering by file, only diff that one file
  const allPaths = filePath
    ? new Set([filePath].filter((p) => filesA.has(p) || filesB.has(p)))
    : new Set([...filesA.keys(), ...filesB.keys()]);

  const fileDiffs: FileDiff[] = [];
  let totalAdded = 0;
  let totalRemoved = 0;
  let tokenDelta = 0;

  for (const path of [...allPaths].sort()) {
    const fileA = filesA.get(path);
    const fileB = filesB.get(path);

    if (!fileA && fileB) {
      // File added
      const hunks = createAddedHunks(fileB.content);
      const added = fileB.content.split('\n').length;
      totalAdded += added;
      tokenDelta += fileB.estimatedTokens;
      fileDiffs.push({
        path,
        status: 'added',
        hunks,
        newTokens: fileB.estimatedTokens,
      });
    } else if (fileA && !fileB) {
      // File removed
      const hunks = createRemovedHunks(fileA.content);
      const removed = fileA.content.split('\n').length;
      totalRemoved += removed;
      tokenDelta -= fileA.estimatedTokens;
      fileDiffs.push({
        path,
        status: 'removed',
        hunks,
        oldTokens: fileA.estimatedTokens,
      });
    } else if (fileA && fileB) {
      if (fileA.contentHash === fileB.contentHash) {
        // Unchanged
        fileDiffs.push({
          path,
          status: 'unchanged',
          hunks: [],
          oldTokens: fileA.estimatedTokens,
          newTokens: fileB.estimatedTokens,
        });
      } else {
        // Modified
        const hunks = computeHunks(fileA.content, fileB.content);
        let added = 0;
        let removed = 0;
        for (const hunk of hunks) {
          for (const line of hunk.lines) {
            if (line.type === 'add') added++;
            else if (line.type === 'remove') removed++;
          }
        }
        totalAdded += added;
        totalRemoved += removed;
        tokenDelta += fileB.estimatedTokens - fileA.estimatedTokens;
        fileDiffs.push({
          path,
          status: 'modified',
          hunks,
          oldTokens: fileA.estimatedTokens,
          newTokens: fileB.estimatedTokens,
        });
      }
    }
  }

  const filesChanged = fileDiffs.filter((f) => f.status !== 'unchanged').length;

  return {
    files: fileDiffs,
    summary: {
      linesAdded: totalAdded,
      linesRemoved: totalRemoved,
      tokenDelta,
      filesChanged,
    },
  };
}

/**
 * Resolve a version argument ("v4", "4", or "current") into a ConfigVersion.
 * Returns null if the version doesn't exist.
 */
export function resolveVersion(
  projectRoot: string,
  versionArg: string,
  gitRoot: string | null,
): ConfigVersion | null {
  if (versionArg === 'current') {
    return buildCurrentVersion(projectRoot, gitRoot);
  }

  // Parse "v4" or "4"
  const num = parseInt(versionArg.replace(/^v/i, ''), 10);
  if (isNaN(num) || num < 1) return null;

  return getVersion(projectRoot, num);
}

/**
 * Build a virtual ConfigVersion from the current disk state
 * by reading the latest version's file list and refreshing content from disk.
 */
function buildCurrentVersion(
  projectRoot: string,
  gitRoot: string | null,
): ConfigVersion | null {
  // Find the latest version to get the file list
  const entries = getHistory(projectRoot);

  if (entries.length === 0) return null;

  const latestVersion = getVersion(projectRoot, entries[entries.length - 1].version);
  if (!latestVersion) return null;

  // Re-read each file from disk
  const files: ConfigFileSnapshot[] = [];
  for (const file of latestVersion.files) {
    const absPath = file.absolutePath;
    if (!existsSync(absPath)) continue;

    try {
      const content = readFileSync(absPath, 'utf-8');
      const relPath = gitRoot ? relative(gitRoot, absPath) : file.relativePath;
      const fileType = classifyConfigFile(absPath);

      files.push({
        relativePath: relPath,
        absolutePath: absPath,
        scope: fileType ? inferScope(absPath, fileType) : file.scope,
        type: fileType,
        contentHash: hashContent(content),
        content,
        sizeBytes: Buffer.byteLength(content, 'utf-8'),
        estimatedTokens: estimateTokens(content),
        lastModified: new Date().toISOString(),
      });
    } catch {
      // Skip files that can't be read
    }
  }

  if (files.length === 0) return null;

  return {
    version: 0, // virtual
    parentVersion: entries[entries.length - 1].version,
    timestamp: new Date().toISOString(),
    source: 'disk',
    trigger: 'diff-current',
    contentHash: '', // not meaningful for virtual version
    tokenCount: files.reduce((sum, f) => sum + f.estimatedTokens, 0),
    files,
  };
}

// ---- Line-based diff algorithm (Myers-like with context) ----

/**
 * Compute diff hunks between two text contents using a simple LCS-based approach.
 * Returns hunks with 3 lines of context around changes.
 */
function computeHunks(oldContent: string, newContent: string, contextLines = 3): DiffHunk[] {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // Compute edit script using simple LCS
  const ops = computeEditOps(oldLines, newLines);

  // Group ops into hunks with context
  return groupIntoHunks(ops, oldLines, newLines, contextLines);
}

interface EditOp {
  type: 'equal' | 'insert' | 'delete';
  oldIdx: number; // line index in old (for equal/delete)
  newIdx: number; // line index in new (for equal/insert)
}

/**
 * Compute edit operations between two line arrays using LCS.
 * For config files (typically <300 lines), O(n*m) is fine.
 */
function computeEditOps(oldLines: string[], newLines: string[]): EditOp[] {
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce edit operations
  const ops: EditOp[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: 'equal', oldIdx: i - 1, newIdx: j - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'insert', oldIdx: i, newIdx: j - 1 });
      j--;
    } else {
      ops.push({ type: 'delete', oldIdx: i - 1, newIdx: j });
      i--;
    }
  }

  return ops.reverse();
}

/**
 * Group edit operations into hunks with surrounding context lines.
 */
function groupIntoHunks(
  ops: EditOp[],
  oldLines: string[],
  newLines: string[],
  contextLines: number,
): DiffHunk[] {
  if (ops.length === 0) return [];

  // Find change regions (non-equal ops)
  const changeIndices: number[] = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type !== 'equal') {
      changeIndices.push(i);
    }
  }

  if (changeIndices.length === 0) return [];

  // Group changes that are within 2*contextLines of each other
  const groups: Array<{ start: number; end: number }> = [];
  let groupStart = changeIndices[0];
  let groupEnd = changeIndices[0];

  for (let i = 1; i < changeIndices.length; i++) {
    // Count equal ops between this change and the previous one
    let equalsBetween = 0;
    for (let j = groupEnd + 1; j < changeIndices[i]; j++) {
      if (ops[j].type === 'equal') equalsBetween++;
    }

    if (equalsBetween <= contextLines * 2) {
      // Merge into current group
      groupEnd = changeIndices[i];
    } else {
      groups.push({ start: groupStart, end: groupEnd });
      groupStart = changeIndices[i];
      groupEnd = changeIndices[i];
    }
  }
  groups.push({ start: groupStart, end: groupEnd });

  // Build hunks from groups
  const hunks: DiffHunk[] = [];

  for (const group of groups) {
    // Expand to include context lines
    const contextStart = Math.max(0, group.start - contextLines);
    const contextEnd = Math.min(ops.length - 1, group.end + contextLines);

    const lines: DiffLine[] = [];
    let oldStart = -1;
    let newStart = -1;
    let oldCount = 0;
    let newCount = 0;

    for (let i = contextStart; i <= contextEnd; i++) {
      const op = ops[i];

      if (op.type === 'equal') {
        if (oldStart === -1) {
          oldStart = op.oldIdx;
          newStart = op.newIdx;
        }
        lines.push({ type: 'context', content: oldLines[op.oldIdx] });
        oldCount++;
        newCount++;
      } else if (op.type === 'delete') {
        if (oldStart === -1) {
          oldStart = op.oldIdx;
          newStart = op.newIdx;
        }
        lines.push({ type: 'remove', content: oldLines[op.oldIdx] });
        oldCount++;
      } else if (op.type === 'insert') {
        if (oldStart === -1) {
          oldStart = op.oldIdx;
          newStart = op.newIdx;
        }
        lines.push({ type: 'add', content: newLines[op.newIdx] });
        newCount++;
      }
    }

    hunks.push({
      oldStart: oldStart + 1, // 1-indexed
      oldCount,
      newStart: newStart + 1,
      newCount,
      lines,
    });
  }

  return hunks;
}

/**
 * Create hunks for an entirely new file (all lines added).
 */
function createAddedHunks(content: string): DiffHunk[] {
  const lines = content.split('\n');
  return [
    {
      oldStart: 0,
      oldCount: 0,
      newStart: 1,
      newCount: lines.length,
      lines: lines.map((l) => ({ type: 'add' as const, content: l })),
    },
  ];
}

/**
 * Create hunks for a removed file (all lines deleted).
 */
function createRemovedHunks(content: string): DiffHunk[] {
  const lines = content.split('\n');
  return [
    {
      oldStart: 1,
      oldCount: lines.length,
      newStart: 0,
      newCount: 0,
      lines: lines.map((l) => ({ type: 'remove' as const, content: l })),
    },
  ];
}
