import type { FileScope, ConfigFileType } from './index.js';

/** Per-file snapshot at a given version */
export interface ConfigFileSnapshot {
  relativePath: string;
  absolutePath: string;
  scope: FileScope;
  type: ConfigFileType | null;
  contentHash: string;
  content: string;
  sizeBytes: number;
  estimatedTokens: number;
  lastModified: string; // ISO 8601
}

/** Git commit metadata attached to git-sourced versions */
export interface GitCommitInfo {
  hash: string;
  author: string;
  message: string;
}

/** Full version record with file contents (stored as vNNN.json) */
export interface ConfigVersion {
  version: number;
  parentVersion: number; // 0 = sentinel for v1
  restoredFrom?: number; // only on restore versions
  timestamp: string; // ISO 8601
  source: 'git' | 'transcript' | 'disk' | 'restore';
  gitCommit?: GitCommitInfo;
  transcriptSession?: { sessionId: string };
  trigger?: string; // for disk/restore: which cci command
  contentHash: string; // SHA-256 of all files combined
  tokenCount: number;
  files: ConfigFileSnapshot[];
}

/** Lightweight summary for history.jsonl (no file contents) */
export interface HistoryEntry {
  version: number;
  parentVersion: number;
  restoredFrom?: number;
  timestamp: string;
  source: 'git' | 'transcript' | 'disk' | 'restore';
  gitCommit?: GitCommitInfo;
  transcriptSession?: { sessionId: string };
  trigger?: string;
  contentHash: string;
  tokenCount: number;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  summary: string;
}

/** Tracks where each source left off for incremental updates */
export interface ReconstructionCache {
  lastGitCommit?: string;
  lastTranscriptSession?: string;
  lastDiskSnapshot?: string;
  totalVersions: number;
  cacheVersion: number;
}

/** Raw git commit data returned by the git miner */
export interface GitConfigCommit {
  commitHash: string;
  timestamp: string; // ISO 8601
  author: string;
  commitMessage: string;
  files: Array<{
    path: string; // relative to repo root
    content: string | null; // null = deleted
    status: 'added' | 'modified' | 'deleted';
  }>;
}

/** Options for history reconstruction */
export interface HistoryOptions {
  maxVersions?: number;
  sources?: {
    git?: boolean;
    transcripts?: boolean;
    disk?: boolean;
  };
  coalesceWindowSeconds?: number;
  includeUserScope?: boolean;
  trigger?: string; // which cci command triggered this
}

/** A config file change detected in a Claude Code transcript */
export interface TranscriptConfigChange {
  sessionId: string;
  timestamp: string; // ISO 8601
  toolName: 'Edit' | 'Write';
  filePath: string; // Absolute path
  changeType: 'edit' | 'create' | 'overwrite';
  content?: string; // Full content (available for Write)
  editPatch?: {
    // Available for Edit
    oldStr: string;
    newStr: string;
  };
  confidence: 'high' | 'low';
}

/** Configuration for history feature in .ccinspect.json */
export interface HistoryConfig {
  enabled?: boolean;
  maxVersions?: number;
  sources?: {
    git?: boolean;
    transcripts?: boolean;
    disk?: boolean;
  };
  coalesceWindowSeconds?: number;
  includeUserScope?: boolean;
}

// ---- Diff types ----

/** A single line in a diff hunk */
export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
}

/** A contiguous chunk of changes in a file diff */
export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

/** Diff result for a single file between two versions */
export interface FileDiff {
  path: string;
  status: 'added' | 'removed' | 'modified' | 'unchanged';
  hunks: DiffHunk[];
  oldTokens?: number;
  newTokens?: number;
}

/** Complete diff result between two config versions */
export interface DiffResult {
  files: FileDiff[];
  summary: {
    linesAdded: number;
    linesRemoved: number;
    tokenDelta: number;
    filesChanged: number;
  };
}
