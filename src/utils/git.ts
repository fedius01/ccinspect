import { execSync } from 'child_process';
import { dirname } from 'path';

export function findGitRoot(startDir: string): string | null {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    const result = execSync('git rev-parse --show-toplevel', {
      cwd: startDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}

export function isGitTracked(filePath: string): boolean {
  try {
    const dir = dirname(filePath);
    // eslint-disable-next-line sonarjs/os-command
    execSync(`git ls-files --error-unmatch "${filePath}"`, {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

export function getProjectIdentifier(gitRoot: string): string {
  // Claude Code uses the git remote URL or directory name to derive the project identifier.
  // We replicate this by hashing the absolute path to create a deterministic directory name.
  // The actual format used by Claude Code: encode the absolute path as a safe directory name.
  return gitRoot.replace(/\//g, '-').replace(/^-/, '');
}
