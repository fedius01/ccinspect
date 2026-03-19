import { execSync } from 'child_process';
import type { GitConfigCommit } from '../types/history.js';

const GIT_LOG_SEPARATOR = '---CCI_COMMIT_SEP---';

/**
 * Mine git history for commits that touched config files.
 *
 * @param projectRoot - Absolute path to the project root (must be inside a git repo)
 * @param configPaths - Relative paths (from repo root) of config files to track
 * @param since - Optional git commit hash; only return commits after this one
 * @returns Array of GitConfigCommit in chronological order (oldest first)
 */
export function mineGitHistory(
  projectRoot: string,
  configPaths: string[],
  since?: string,
): GitConfigCommit[] {
  if (configPaths.length === 0) return [];

  // Get the list of commits that touched any config file
  const commits = getCommitList(projectRoot, configPaths, since);
  if (commits.length === 0) return [];

  // For each commit, retrieve the state of each config file
  const results: GitConfigCommit[] = [];

  for (const commit of commits) {
    const files = getFilesAtCommit(projectRoot, commit.commitHash, configPaths, commit.changedPaths);
    results.push({ ...commit, files });
  }

  return results;
}

interface CommitMeta {
  commitHash: string;
  timestamp: string;
  author: string;
  commitMessage: string;
  changedPaths: Set<string>;
}

/**
 * Get the list of commits that touched any of the given config paths.
 * Returns in chronological order (oldest first).
 */
function getCommitList(
  projectRoot: string,
  configPaths: string[],
  since?: string,
): CommitMeta[] {
  // Use separator BEFORE the header so --name-only output attaches to the preceding commit.
  // Output structure per commit:
  //   ---CCI_COMMIT_SEP---HASH|DATE|AUTHOR|MESSAGE
  //   file1.md
  //   file2.md
  const format = `${GIT_LOG_SEPARATOR}%H|%aI|%an|%s`;
  const pathArgs = configPaths.map((p) => `"${p}"`).join(' ');

  let cmd = `git log --format="${format}" --name-only --diff-filter=ACDMR --reverse -- ${pathArgs}`;

  if (since) {
    cmd = `git log --format="${format}" --name-only --diff-filter=ACDMR --reverse ${since}..HEAD -- ${pathArgs}`;
  }

  let output: string;
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    output = execSync(cmd, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
  } catch {
    return [];
  }

  if (!output.trim()) return [];

  // Split by separator. First element is empty (before the first separator).
  const commits: CommitMeta[] = [];
  const blocks = output.split(GIT_LOG_SEPARATOR);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const lines = trimmed.split('\n');
    const headerLine = lines[0];
    if (!headerLine) continue;

    // Split on first 3 pipes: hash|date|author|message (message may contain |)
    const parts = headerLine.split('|');
    if (parts.length < 4) continue;

    const commitHash = parts[0];
    const timestamp = parts[1];
    const author = parts[2];
    const commitMessage = parts.slice(3).join('|');

    // Remaining lines are changed file paths (from --name-only)
    const changedPaths = new Set<string>();
    for (let i = 1; i < lines.length; i++) {
      const path = lines[i].trim();
      if (path) changedPaths.add(path);
    }

    commits.push({ commitHash, timestamp, author, commitMessage, changedPaths });
  }

  return commits;
}

/**
 * Retrieve file contents at a specific commit for the given config paths.
 * Only fetches files that were actually changed in this commit.
 */
function getFilesAtCommit(
  projectRoot: string,
  commitHash: string,
  allConfigPaths: string[],
  changedPaths: Set<string>,
): GitConfigCommit['files'] {
  const files: GitConfigCommit['files'] = [];
  // Only fetch config files that were changed in this commit
  const relevantPaths = allConfigPaths.filter((p) => changedPaths.has(p));

  for (const filePath of relevantPaths) {
    const content = gitShow(projectRoot, commitHash, filePath);

    if (content === null) {
      // File was deleted in this commit
      files.push({ path: filePath, content: null, status: 'deleted' });
    } else {
      // Determine if this is an add or modify by checking parent commit
      const parentContent = gitShow(projectRoot, `${commitHash}~1`, filePath);
      const status = parentContent === null ? 'added' : 'modified';
      files.push({ path: filePath, content, status });
    }
  }

  return files;
}

/**
 * Run `git show <ref>:<path>` to get file content at a specific revision.
 * Returns null if the file doesn't exist at that revision.
 */
function gitShow(projectRoot: string, ref: string, filePath: string): string | null {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    return execSync(`git show "${ref}:${filePath}"`, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 5 * 1024 * 1024, // 5MB per file
    });
  } catch {
    return null;
  }
}

/**
 * Get the list of config file paths (relative to git root) from a ConfigInventory.
 * Only includes files inside the git repo (project-scoped).
 */
export function extractConfigPaths(
  gitRoot: string,
  filePaths: string[],
  includeUserScope: boolean,
): string[] {
  const paths: string[] = [];
  const gitRootNorm = gitRoot.endsWith('/') ? gitRoot : gitRoot + '/';

  for (const absPath of filePaths) {
    if (absPath.startsWith(gitRootNorm)) {
      paths.push(absPath.slice(gitRootNorm.length));
    } else if (includeUserScope) {
      // User-scope files are outside git — skip for git mining
      // (they can't be mined from git anyway)
    }
  }

  return [...new Set(paths)]; // deduplicate
}
