import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  appendFileSync,
  unlinkSync,
} from 'fs';
import { join, relative } from 'path';
import { homedir } from 'os';
import { encodeProjectPath } from '../utils/transcript-discovery.js';
import { hashContent, hashFiles } from '../utils/content-hash.js';
import { estimateTokens } from '../utils/tokens.js';
import { classifyConfigFile, inferScope } from '../utils/file-classifier.js';
import { mineGitHistory, extractConfigPaths } from './git-history-miner.js';
import { mineTranscriptConfigChanges } from './transcript-config-miner.js';
import type { ConfigInventory, FileInfo } from '../types/inventory.js';
import type {
  ConfigVersion,
  ConfigFileSnapshot,
  HistoryEntry,
  ReconstructionCache,
  HistoryOptions,
  GitConfigCommit,
  TranscriptConfigChange,
} from '../types/history.js';

const CACHE_FORMAT_VERSION = 1;

/**
 * Resolve the history storage directory for a project.
 * Path: ~/.ccinspect/projects/<encoded-path>/history/
 */
export function resolveHistoryDir(projectRoot: string): string {
  const encoded = encodeProjectPath(projectRoot);
  return join(homedir(), '.ccinspect', 'projects', encoded, 'history');
}

/**
 * Run the full history reconstruction pipeline.
 * Returns the complete HistoryEntry array for the project.
 *
 * This is the main orchestrator: mines git, mines transcripts,
 * takes disk snapshot, merges/deduplicates, assigns version numbers, and persists.
 */
export async function reconstruct(
  projectRoot: string,
  inventory: ConfigInventory,
  options?: HistoryOptions,
): Promise<HistoryEntry[]> {
  const historyDir = resolveHistoryDir(projectRoot);
  ensureDir(historyDir);

  const cache = readReconstructionCache(historyDir);
  const existingEntries = readHistoryLog(historyDir);

  // Determine next version number
  let nextVersion = (cache.totalVersions || 0) + 1;

  // Collect all change events
  const newVersions: ConfigVersion[] = [];

  const allFilePaths = collectInventoryPaths(inventory, options?.includeUserScope ?? false);

  // --- Source 1: Git mining ---
  const gitEnabled = options?.sources?.git !== false;
  if (gitEnabled && inventory.gitRoot) {
    const configPaths = extractConfigPaths(inventory.gitRoot, allFilePaths, false);
    const gitCommits = mineGitHistory(inventory.gitRoot, configPaths, cache.lastGitCommit);

    for (const commit of gitCommits) {
      const version = gitCommitToVersion(commit, inventory.gitRoot, nextVersion);
      if (version) {
        newVersions.push(version);
        nextVersion++;
      }
    }

    // Update cache pointer to last git commit
    if (gitCommits.length > 0) {
      cache.lastGitCommit = gitCommits[gitCommits.length - 1].commitHash;
    }
  }

  // --- Source 2: Transcript mining ---
  const transcriptsEnabled = options?.sources?.transcripts !== false;
  if (transcriptsEnabled) {
    const transcriptChanges = await mineTranscriptConfigChanges(
      projectRoot,
      allFilePaths,
      cache.lastTranscriptSession,
    );

    // Coalesce rapid edits to same file within window
    const coalesceWindow = (options?.coalesceWindowSeconds ?? 60) * 1000;
    const coalesced = coalesceTranscriptChanges(transcriptChanges, coalesceWindow);

    // Build file state tracking for Edit reconstruction
    const fileStates = buildFileStateMap(existingEntries, newVersions, historyDir);

    for (const group of coalesced) {
      const version = transcriptChangesToVersion(
        group,
        inventory.gitRoot,
        projectRoot,
        nextVersion,
        fileStates,
      );
      if (version) {
        // Update file states for subsequent Edit reconstructions
        for (const file of version.files) {
          fileStates.set(file.absolutePath, file.content);
        }
        newVersions.push(version);
        nextVersion++;
      }
    }

    // Update cache pointer to latest transcript timestamp
    if (transcriptChanges.length > 0) {
      cache.lastTranscriptSession = transcriptChanges[transcriptChanges.length - 1].timestamp;
    }
  }

  // --- Source 3: Disk snapshot (always runs) ---
  const diskEnabled = options?.sources?.disk !== false;
  if (diskEnabled) {
    const diskSnapshot = takeDiskSnapshot(
      inventory,
      options?.includeUserScope ?? false,
      options?.trigger ?? 'unknown',
    );

    if (diskSnapshot) {
      // Deduplicate: if the disk snapshot hash matches the last known version, skip
      const lastKnownHash = getLastKnownContentHash(existingEntries, newVersions);
      if (diskSnapshot.contentHash !== lastKnownHash) {
        diskSnapshot.version = nextVersion;
        diskSnapshot.parentVersion = nextVersion > 1 ? nextVersion - 1 : 0;
        newVersions.push(diskSnapshot);
        nextVersion++;
      }
    }
  }

  // Deduplicate: remove versions whose content hash matches an adjacent version
  const deduped = deduplicateVersions(newVersions);

  // Re-assign sequential version numbers after dedup
  const baseVersion = (cache.totalVersions || 0) + 1;
  for (let i = 0; i < deduped.length; i++) {
    deduped[i].version = baseVersion + i;
    deduped[i].parentVersion = baseVersion + i > 1 ? baseVersion + i - 1 : 0;
  }

  // Compute diffs between adjacent versions
  const lastExistingEntry = existingEntries[existingEntries.length - 1];
  const lastExistingVersion = lastExistingEntry
    ? loadVersion(historyDir, lastExistingEntry.version)
    : null;
  computeDiffs(deduped, lastExistingVersion);

  // Persist new versions
  for (const version of deduped) {
    writeVersionSnapshot(historyDir, version);
  }

  // Build history entries and append to log
  const newEntries = deduped.map(versionToEntry);
  if (newEntries.length > 0) {
    appendHistoryLog(historyDir, newEntries);
  }

  // Update cache
  cache.totalVersions = (cache.totalVersions || 0) + deduped.length;
  cache.lastDiskSnapshot = new Date().toISOString();
  cache.cacheVersion = CACHE_FORMAT_VERSION;
  writeReconstructionCache(historyDir, cache);

  // Enforce maxVersions
  const maxVersions = options?.maxVersions ?? 200;
  const allEntries = [...existingEntries, ...newEntries];
  if (allEntries.length > maxVersions) {
    pruneOldVersions(historyDir, allEntries, maxVersions, cache);
  }

  return allEntries;
}

/**
 * Read the full history log for a project.
 */
export function getHistory(projectRoot: string): HistoryEntry[] {
  const historyDir = resolveHistoryDir(projectRoot);
  return readHistoryLog(historyDir);
}

/**
 * Read a specific version snapshot.
 */
export function getVersion(projectRoot: string, version: number): ConfigVersion | null {
  const historyDir = resolveHistoryDir(projectRoot);
  return loadVersion(historyDir, version);
}

/**
 * Walk the parentVersion chain from latest to v1, returning the set of
 * version numbers in the active ancestry.
 */
export function computeLineage(entries: HistoryEntry[]): Set<number> {
  const lineage = new Set<number>();
  if (entries.length === 0) return lineage;

  const entryMap = new Map<number, HistoryEntry>();
  for (const entry of entries) {
    entryMap.set(entry.version, entry);
  }

  let current: HistoryEntry | undefined = entries[entries.length - 1];
  while (current) {
    if (lineage.has(current.version)) break; // cycle guard
    lineage.add(current.version);
    current = entryMap.get(current.parentVersion);
  }

  return lineage;
}

/**
 * Append a single version to the history (used by restore).
 * Assigns the next available version number.
 * Returns the assigned version number.
 */
export function appendRestoreVersion(
  projectRoot: string,
  version: ConfigVersion,
): number {
  const historyDir = resolveHistoryDir(projectRoot);
  ensureDir(historyDir);

  const cache = readReconstructionCache(historyDir);
  const nextVersion = (cache.totalVersions || 0) + 1;

  version.version = nextVersion;

  writeVersionSnapshot(historyDir, version);

  const entry = versionToEntry(version);
  appendHistoryLog(historyDir, [entry]);

  cache.totalVersions = nextVersion;
  cache.lastDiskSnapshot = new Date().toISOString();
  writeReconstructionCache(historyDir, cache);

  return nextVersion;
}

// ---- Transcript processing helpers ----

/**
 * Coalesce rapid transcript changes to the same file within a time window.
 * Groups consecutive changes and merges those within the window into a single group.
 * Each group becomes one version.
 */
function coalesceTranscriptChanges(
  changes: TranscriptConfigChange[],
  windowMs: number,
): TranscriptConfigChange[][] {
  if (changes.length === 0) return [];

  const groups: TranscriptConfigChange[][] = [[changes[0]]];

  for (let i = 1; i < changes.length; i++) {
    const curr = changes[i];
    const lastGroup = groups[groups.length - 1];
    const lastChange = lastGroup[lastGroup.length - 1];

    const timeDelta = new Date(curr.timestamp).getTime() - new Date(lastChange.timestamp).getTime();
    const sameSession = curr.sessionId === lastChange.sessionId;

    if (sameSession && timeDelta <= windowMs) {
      // Within coalesce window and same session — add to current group
      lastGroup.push(curr);
    } else {
      // Start a new group
      groups.push([curr]);
    }
  }

  return groups;
}

/**
 * Build a map of file absolute path → last known content from existing versions.
 * Used for Edit reconstruction (applying old_str → new_str patches).
 */
function buildFileStateMap(
  existingEntries: HistoryEntry[],
  newVersions: ConfigVersion[],
  historyDir: string,
): Map<string, string> {
  const fileStates = new Map<string, string>();

  // Start from the latest existing version
  if (existingEntries.length > 0) {
    const latestEntry = existingEntries[existingEntries.length - 1];
    const latestVersion = loadVersion(historyDir, latestEntry.version);
    if (latestVersion) {
      for (const file of latestVersion.files) {
        fileStates.set(file.absolutePath, file.content);
      }
    }
  }

  // Overlay new versions (from git mining)
  for (const version of newVersions) {
    for (const file of version.files) {
      fileStates.set(file.absolutePath, file.content);
    }
  }

  return fileStates;
}

/**
 * Convert a group of coalesced transcript changes into a ConfigVersion.
 * Uses the latest content for each file (Write takes precedence).
 * For Edit changes, applies patches to the last known file state.
 */
function transcriptChangesToVersion(
  changes: TranscriptConfigChange[],
  gitRoot: string | null,
  projectRoot: string,
  version: number,
  fileStates: Map<string, string>,
): ConfigVersion | null {
  const files: ConfigFileSnapshot[] = [];
  const processedPaths = new Set<string>();

  // Process in reverse so that the latest change for each file wins
  const reversed = [...changes].reverse();

  for (const change of reversed) {
    if (processedPaths.has(change.filePath)) continue;
    processedPaths.add(change.filePath);

    let content: string | null = null;

    if (change.toolName === 'Write' && change.content !== undefined) {
      // Write tool: full content available
      content = change.content;
    } else if (change.toolName === 'Edit' && change.editPatch) {
      // Edit tool: apply patch to known prior state
      const priorContent = fileStates.get(change.filePath);
      if (priorContent !== undefined) {
        // Apply all Edit patches for this file in chronological order
        let patched = priorContent;
        const chronological = changes
          .filter((c) => c.filePath === change.filePath && c.toolName === 'Edit' && c.editPatch);
        for (const edit of chronological) {
          if (edit.editPatch) {
            patched = patched.replace(edit.editPatch.oldStr, edit.editPatch.newStr);
          }
        }
        content = patched;
      }
      // If no prior state, we can't reconstruct — skip this file
    }

    if (content === null) continue;

    const relPath = gitRoot
      ? relative(gitRoot, change.filePath)
      : relative(projectRoot, change.filePath);

    const fileType = classifyConfigFile(change.filePath);
    files.push({
      relativePath: relPath,
      absolutePath: change.filePath,
      scope: fileType ? inferScope(change.filePath, fileType) : 'project-shared',
      type: fileType,
      contentHash: hashContent(content),
      content,
      sizeBytes: Buffer.byteLength(content, 'utf-8'),
      estimatedTokens: estimateTokens(content),
      lastModified: change.timestamp,
    });
  }

  if (files.length === 0) return null;

  const contentHash = hashFiles(files);
  const tokenCount = files.reduce((sum, f) => sum + f.estimatedTokens, 0);
  const sessionId = changes[0].sessionId;

  return {
    version,
    parentVersion: version > 1 ? version - 1 : 0,
    timestamp: changes[0].timestamp, // Use earliest timestamp in group
    source: 'transcript',
    transcriptSession: { sessionId },
    contentHash,
    tokenCount,
    files,
  };
}

// ---- Internal helpers ----

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function readReconstructionCache(historyDir: string): ReconstructionCache {
  const cachePath = join(historyDir, 'reconstruction-cache.json');
  if (!existsSync(cachePath)) {
    return { totalVersions: 0, cacheVersion: CACHE_FORMAT_VERSION };
  }
  try {
    const raw = readFileSync(cachePath, 'utf-8');
    const parsed = JSON.parse(raw) as ReconstructionCache;
    if (parsed.cacheVersion !== CACHE_FORMAT_VERSION) {
      // Format migration: reset cache
      return { totalVersions: 0, cacheVersion: CACHE_FORMAT_VERSION };
    }
    return parsed;
  } catch {
    return { totalVersions: 0, cacheVersion: CACHE_FORMAT_VERSION };
  }
}

function writeReconstructionCache(historyDir: string, cache: ReconstructionCache): void {
  const cachePath = join(historyDir, 'reconstruction-cache.json');
  const tmpPath = cachePath + '.tmp';
  try {
    writeFileSync(tmpPath, JSON.stringify(cache, null, 2), 'utf-8');
    renameSync(tmpPath, cachePath);
  } catch {
    // Non-fatal: cache write failure doesn't block primary command
  }
}

function readHistoryLog(historyDir: string): HistoryEntry[] {
  const logPath = join(historyDir, 'history.jsonl');
  if (!existsSync(logPath)) return [];

  try {
    const raw = readFileSync(logPath, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim());
    return lines.map((line) => JSON.parse(line) as HistoryEntry);
  } catch {
    return [];
  }
}

function appendHistoryLog(historyDir: string, entries: HistoryEntry[]): void {
  const logPath = join(historyDir, 'history.jsonl');
  const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  try {
    appendFileSync(logPath, lines, 'utf-8');
  } catch {
    // Non-fatal
  }
}

function writeVersionSnapshot(historyDir: string, version: ConfigVersion): void {
  const fileName = `v${String(version.version).padStart(3, '0')}.json`;
  const filePath = join(historyDir, fileName);
  try {
    writeFileSync(filePath, JSON.stringify(version, null, 2), 'utf-8');
  } catch {
    // Non-fatal
  }
}

function loadVersion(historyDir: string, version: number): ConfigVersion | null {
  const fileName = `v${String(version).padStart(3, '0')}.json`;
  const filePath = join(historyDir, fileName);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as ConfigVersion;
  } catch {
    return null;
  }
}

/**
 * Collect all absolute file paths from the inventory.
 */
function collectInventoryPaths(inventory: ConfigInventory, includeUserScope: boolean): string[] {
  const paths: string[] = [];

  const addIfExists = (fi: FileInfo | null) => {
    if (fi?.exists) paths.push(fi.path);
  };

  // Project-scoped files
  addIfExists(inventory.projectSettings);
  addIfExists(inventory.localSettings);
  addIfExists(inventory.projectClaudeMd);
  addIfExists(inventory.localClaudeMd);
  addIfExists(inventory.projectMcp);
  for (const fi of inventory.subdirClaudeMds) if (fi.exists) paths.push(fi.path);
  for (const fi of inventory.rules) if (fi.exists) paths.push(fi.path);
  for (const fi of inventory.projectAgents) if (fi.exists) paths.push(fi.path);
  for (const fi of inventory.projectCommands) if (fi.exists) paths.push(fi.path);
  for (const fi of inventory.projectSkills) if (fi.exists) paths.push(fi.path);

  // User-scoped files (outside git)
  if (includeUserScope) {
    addIfExists(inventory.userSettings);
    addIfExists(inventory.globalClaudeMd);
    for (const fi of inventory.userRules) if (fi.exists) paths.push(fi.path);
    for (const fi of inventory.userAgents) if (fi.exists) paths.push(fi.path);
    for (const fi of inventory.userCommands) if (fi.exists) paths.push(fi.path);
    for (const fi of inventory.userSkills) if (fi.exists) paths.push(fi.path);
  }

  return paths;
}

/**
 * Build a ConfigFileSnapshot from a FileInfo.
 */
function fileInfoToSnapshot(
  fi: FileInfo,
  gitRoot: string | null,
): ConfigFileSnapshot | null {
  if (!fi.exists) return null;

  try {
    const content = readFileSync(fi.path, 'utf-8');
    const relPath = gitRoot ? relative(gitRoot, fi.path) : fi.relativePath;
    return {
      relativePath: relPath,
      absolutePath: fi.path,
      scope: fi.scope,
      type: classifyConfigFile(fi.path),
      contentHash: hashContent(content),
      content,
      sizeBytes: fi.sizeBytes,
      estimatedTokens: fi.estimatedTokens,
      lastModified: fi.lastModified.toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Take a disk snapshot of all config files from the inventory.
 */
function takeDiskSnapshot(
  inventory: ConfigInventory,
  includeUserScope: boolean,
  trigger: string,
): ConfigVersion | null {
  const files: ConfigFileSnapshot[] = [];

  const addFile = (fi: FileInfo | null) => {
    if (!fi) return;
    const snap = fileInfoToSnapshot(fi, inventory.gitRoot);
    if (snap) files.push(snap);
  };

  const addFiles = (fis: FileInfo[]) => {
    for (const fi of fis) addFile(fi);
  };

  // Project-scoped
  addFile(inventory.projectSettings);
  addFile(inventory.localSettings);
  addFile(inventory.projectClaudeMd);
  addFile(inventory.localClaudeMd);
  addFile(inventory.projectMcp);
  addFiles(inventory.subdirClaudeMds);
  addFiles(inventory.rules);
  addFiles(inventory.projectAgents);
  addFiles(inventory.projectCommands);
  addFiles(inventory.projectSkills);

  if (includeUserScope) {
    addFile(inventory.userSettings);
    addFile(inventory.globalClaudeMd);
    addFiles(inventory.userRules);
    addFiles(inventory.userAgents);
    addFiles(inventory.userCommands);
    addFiles(inventory.userSkills);
  }

  if (files.length === 0) return null;

  const contentHash = hashFiles(files);
  const tokenCount = files.reduce((sum, f) => sum + f.estimatedTokens, 0);

  return {
    version: 0, // assigned later
    parentVersion: 0,
    timestamp: new Date().toISOString(),
    source: 'disk',
    trigger,
    contentHash,
    tokenCount,
    files,
  };
}

/**
 * Convert a git commit to a ConfigVersion.
 * Only includes files that have content (not deleted).
 */
function gitCommitToVersion(
  commit: GitConfigCommit,
  gitRoot: string,
  version: number,
): ConfigVersion | null {
  const files: ConfigFileSnapshot[] = [];

  for (const file of commit.files) {
    if (file.content === null) continue; // deleted

    const absPath = join(gitRoot, file.path);
    const content = file.content;
    files.push({
      relativePath: file.path,
      absolutePath: absPath,
      scope: 'project-shared', // git files are always project-scoped
      type: classifyConfigFile(absPath),
      contentHash: hashContent(content),
      content,
      sizeBytes: Buffer.byteLength(content, 'utf-8'),
      estimatedTokens: estimateTokens(content),
      lastModified: commit.timestamp,
    });
  }

  if (files.length === 0) return null;

  const contentHash = hashFiles(files);
  const tokenCount = files.reduce((sum, f) => sum + f.estimatedTokens, 0);

  return {
    version,
    parentVersion: version > 1 ? version - 1 : 0,
    timestamp: commit.timestamp,
    source: 'git',
    gitCommit: {
      hash: commit.commitHash,
      author: commit.author,
      message: commit.commitMessage,
    },
    contentHash,
    tokenCount,
    files,
  };
}

/**
 * Get the content hash of the most recent version (from existing entries or new versions).
 */
function getLastKnownContentHash(
  existingEntries: HistoryEntry[],
  newVersions: ConfigVersion[],
): string | null {
  if (newVersions.length > 0) {
    return newVersions[newVersions.length - 1].contentHash;
  }
  if (existingEntries.length > 0) {
    return existingEntries[existingEntries.length - 1].contentHash;
  }
  return null;
}

/**
 * Remove versions with duplicate content hashes adjacent to each other.
 * When duplicated, keep the git version (richer metadata) over disk.
 */
function deduplicateVersions(versions: ConfigVersion[]): ConfigVersion[] {
  if (versions.length <= 1) return versions;

  const result: ConfigVersion[] = [versions[0]];
  for (let i = 1; i < versions.length; i++) {
    const prev = result[result.length - 1];
    const curr = versions[i];
    if (curr.contentHash === prev.contentHash) {
      // Keep the one with richer metadata
      if (curr.source === 'git' && prev.source !== 'git') {
        result[result.length - 1] = curr;
      }
      // Otherwise keep prev (already in result)
    } else {
      result.push(curr);
    }
  }
  return result;
}

/**
 * Compute diff stats between adjacent versions.
 */
function computeDiffs(versions: ConfigVersion[], lastExisting: ConfigVersion | null): void {
  for (let i = 0; i < versions.length; i++) {
    const prev = i === 0 ? lastExisting : versions[i - 1];
    const curr = versions[i];

    if (!prev) {
      // First version ever — no diff to compute, all files are "added"
      continue;
    }

    const { filesChanged, linesAdded, linesRemoved } = diffVersions(prev, curr);
    // Store in a side channel — the ConfigVersion type doesn't have these fields
    // They get picked up by versionToEntry
    (curr as ConfigVersion & { _filesChanged: string[]; _linesAdded: number; _linesRemoved: number })._filesChanged = filesChanged;
    (curr as ConfigVersion & { _linesAdded: number })._linesAdded = linesAdded;
    (curr as ConfigVersion & { _linesRemoved: number })._linesRemoved = linesRemoved;
  }
}

function diffVersions(
  prev: ConfigVersion,
  curr: ConfigVersion,
): { filesChanged: string[]; linesAdded: number; linesRemoved: number } {
  const prevFiles = new Map(prev.files.map((f) => [f.relativePath, f]));
  const currFiles = new Map(curr.files.map((f) => [f.relativePath, f]));
  const allPaths = new Set([...prevFiles.keys(), ...currFiles.keys()]);

  const filesChanged: string[] = [];
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const path of allPaths) {
    const prevFile = prevFiles.get(path);
    const currFile = currFiles.get(path);

    if (!prevFile && currFile) {
      // Added
      filesChanged.push(path);
      linesAdded += currFile.content.split('\n').length;
    } else if (prevFile && !currFile) {
      // Deleted
      filesChanged.push(path);
      linesRemoved += prevFile.content.split('\n').length;
    } else if (prevFile && currFile && prevFile.contentHash !== currFile.contentHash) {
      // Modified
      filesChanged.push(path);
      const prevLines = prevFile.content.split('\n');
      const currLines = currFile.content.split('\n');
      // Simple line diff: count added and removed lines
      const prevSet = new Set(prevLines);
      const currSet = new Set(currLines);
      for (const line of currLines) {
        if (!prevSet.has(line)) linesAdded++;
      }
      for (const line of prevLines) {
        if (!currSet.has(line)) linesRemoved++;
      }
    }
  }

  return { filesChanged, linesAdded, linesRemoved };
}

/**
 * Convert a ConfigVersion to a lightweight HistoryEntry.
 */
function versionToEntry(version: ConfigVersion): HistoryEntry {
  const extended = version as ConfigVersion & {
    _filesChanged?: string[];
    _linesAdded?: number;
    _linesRemoved?: number;
  };

  const filesChanged = extended._filesChanged ?? version.files.map((f) => f.relativePath);

  return {
    version: version.version,
    parentVersion: version.parentVersion,
    ...(version.restoredFrom !== undefined ? { restoredFrom: version.restoredFrom } : {}),
    timestamp: version.timestamp,
    source: version.source,
    ...(version.gitCommit ? { gitCommit: version.gitCommit } : {}),
    ...(version.transcriptSession ? { transcriptSession: version.transcriptSession } : {}),
    ...(version.trigger ? { trigger: version.trigger } : {}),
    contentHash: version.contentHash,
    tokenCount: version.tokenCount,
    filesChanged: filesChanged.length,
    linesAdded: extended._linesAdded ?? 0,
    linesRemoved: extended._linesRemoved ?? 0,
    summary: generateSummary(version, filesChanged),
  };
}

/**
 * Auto-generate a human-readable change summary.
 */
function generateSummary(version: ConfigVersion, filesChanged: string[]): string {
  if (version.source === 'git' && version.gitCommit) {
    return version.gitCommit.message;
  }
  if (version.source === 'disk') {
    if (filesChanged.length === 0) {
      return 'Disk snapshot (no changes detected)';
    }
    if (filesChanged.length <= 3) {
      return `Changed: ${filesChanged.join(', ')}`;
    }
    return `Changed ${filesChanged.length} files`;
  }
  if (version.source === 'transcript') {
    return `Claude Code edit: ${filesChanged.join(', ')}`;
  }
  if (version.source === 'restore' && version.restoredFrom !== undefined) {
    return `Restored from v${version.restoredFrom}`;
  }
  return `Config version ${version.version}`;
}

/**
 * Prune old versions when maxVersions is exceeded.
 * Removes superseded versions first, then oldest lineage versions.
 * Always keeps v1.
 */
function pruneOldVersions(
  historyDir: string,
  allEntries: HistoryEntry[],
  maxVersions: number,
  cache: ReconstructionCache,
): void {
  if (allEntries.length <= maxVersions) return;

  const lineage = computeLineage(allEntries);
  const toRemove: number[] = [];

  // First pass: remove superseded versions (not in lineage, not v1)
  for (const entry of allEntries) {
    if (allEntries.length - toRemove.length <= maxVersions) break;
    if (entry.version === 1) continue;
    if (!lineage.has(entry.version)) {
      toRemove.push(entry.version);
    }
  }

  // Second pass: if still over limit, remove oldest lineage versions (except v1)
  if (allEntries.length - toRemove.length > maxVersions) {
    const lineageEntries = allEntries
      .filter((e) => lineage.has(e.version) && e.version !== 1)
      .sort((a, b) => a.version - b.version);

    for (const entry of lineageEntries) {
      if (allEntries.length - toRemove.length <= maxVersions) break;
      toRemove.push(entry.version);
    }
  }

  // Delete version files
  const removeSet = new Set(toRemove);
  for (const version of removeSet) {
    const fileName = `v${String(version).padStart(3, '0')}.json`;
    const filePath = join(historyDir, fileName);
    try {
      unlinkSync(filePath);
    } catch {
      // Non-fatal
    }
  }

  // Rewrite history.jsonl without pruned entries
  const remaining = allEntries.filter((e) => !removeSet.has(e.version));
  const logPath = join(historyDir, 'history.jsonl');
  const lines = remaining.map((e) => JSON.stringify(e)).join('\n') + '\n';
  try {
    writeFileSync(logPath, lines, 'utf-8');
  } catch {
    // Non-fatal
  }

  // Update cache
  cache.totalVersions = remaining.length;
  writeReconstructionCache(historyDir, cache);
}
