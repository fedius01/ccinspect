import { readdir, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { homedir } from 'os';
import type { SessionFileInfo, TranscriptDiscoveryResult } from '../types/transcript.js';

/**
 * Encode a project path the way Claude Code does:
 * replace every `/` and `.` with `-`.
 *
 * Example: `/Users/dev/my-project` → `-Users-dev-my-project`
 * Example: `/Users/john.doe/.claude` → `-Users-john-doe--claude`
 *
 * The leading `-` comes from the root `/`.
 */
export function encodeProjectPath(projectRoot: string): string {
  return projectRoot.replace(/[/.]/g, '-');
}

/**
 * Get the base directory where Claude Code stores all project transcripts.
 * Default: `~/.claude/projects/`
 */
export function getTranscriptsBaseDir(home?: string): string {
  return join(home ?? homedir(), '.claude', 'projects');
}

/**
 * Discover transcript session files for a given project root.
 *
 * Strategy:
 * 1. Resolve projectRoot to absolute path
 * 2. Encode with slash-to-dash
 * 3. Look for `~/.claude/projects/<encoded>/`
 * 4. Enumerate *.jsonl files (each is a session)
 * 5. Check for sessions-index.json
 *
 * @param projectRoot - Absolute or relative path to the project
 * @param home - Override home directory (for testing)
 * @returns Discovery result, or null if no transcript directory found
 */
export async function discoverTranscripts(
  projectRoot: string,
  home?: string,
): Promise<TranscriptDiscoveryResult | null> {
  const absRoot = resolve(projectRoot);
  const encoded = encodeProjectPath(absRoot);
  const baseDir = getTranscriptsBaseDir(home);
  const projectDir = join(baseDir, encoded);

  let entries: string[];
  try {
    entries = await readdir(projectDir);
  } catch {
    // Directory doesn't exist or permission error
    return null;
  }

  const sessionFiles: SessionFileInfo[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.jsonl')) continue;

    const filePath = join(projectDir, entry);
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) continue;

      sessionFiles.push({
        sessionId: entry.slice(0, -'.jsonl'.length),
        filePath,
        fileSize: fileStat.size,
        lastModified: fileStat.mtime,
      });
    } catch {
      // Skip files we can't stat
    }
  }

  // Sort by lastModified descending (newest first)
  sessionFiles.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

  // Check for sessions-index.json
  let sessionsIndexPath: string | null = null;
  const indexPath = join(projectDir, 'sessions-index.json');
  try {
    const indexStat = await stat(indexPath);
    if (indexStat.isFile()) {
      sessionsIndexPath = indexPath;
    }
  } catch {
    // No index file
  }

  return {
    projectDir,
    sessionFiles,
    sessionsIndexPath,
  };
}

/**
 * List all project directories under ~/.claude/projects/.
 * Useful for fallback discovery when encoding doesn't match.
 *
 * @param home - Override home directory (for testing)
 * @returns Array of absolute paths to project directories
 */
export async function listAllProjectDirs(home?: string): Promise<string[]> {
  const baseDir = getTranscriptsBaseDir(home);

  let entries: string[];
  try {
    entries = await readdir(baseDir);
  } catch {
    return [];
  }

  const dirs: string[] = [];
  for (const entry of entries) {
    const fullPath = join(baseDir, entry);
    try {
      const entryStat = await stat(fullPath);
      if (entryStat.isDirectory()) {
        dirs.push(fullPath);
      }
    } catch {
      // Skip entries we can't stat
    }
  }

  return dirs;
}
