import { createHash } from 'crypto';
import type { ConfigFileSnapshot } from '../types/history.js';

/**
 * SHA-256 hash of a string, returned as hex digest.
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Canonical hash of multiple config file snapshots.
 * Files are sorted by relativePath before hashing to ensure
 * the same files in different order produce the same hash.
 */
export function hashFiles(files: ConfigFileSnapshot[]): string {
  const sorted = [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const combined = sorted.map((f) => f.contentHash).join(':');
  return hashContent(combined);
}
