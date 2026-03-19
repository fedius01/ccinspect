import { describe, it, expect } from 'vitest';
import { hashContent, hashFiles } from '../../src/utils/content-hash.js';
import type { ConfigFileSnapshot } from '../../src/types/history.js';

describe('hashContent', () => {
  it('returns a 64-char hex string', () => {
    const hash = hashContent('hello world');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic', () => {
    expect(hashContent('test')).toBe(hashContent('test'));
  });

  it('differs for different inputs', () => {
    expect(hashContent('foo')).not.toBe(hashContent('bar'));
  });

  it('handles empty string', () => {
    const hash = hashContent('');
    expect(hash).toHaveLength(64);
  });
});

describe('hashFiles', () => {
  const makeSnapshot = (path: string, content: string): ConfigFileSnapshot => ({
    relativePath: path,
    absolutePath: `/project/${path}`,
    scope: 'project-shared',
    type: 'claude-md',
    contentHash: hashContent(content),
    content,
    sizeBytes: content.length,
    estimatedTokens: 10,
    lastModified: '2026-01-01T00:00:00Z',
  });

  it('returns a 64-char hex string', () => {
    const files = [makeSnapshot('CLAUDE.md', 'hello')];
    const hash = hashFiles(files);
    expect(hash).toHaveLength(64);
  });

  it('is deterministic', () => {
    const files = [makeSnapshot('a.md', 'one'), makeSnapshot('b.md', 'two')];
    expect(hashFiles(files)).toBe(hashFiles(files));
  });

  it('produces same hash regardless of file order', () => {
    const a = makeSnapshot('a.md', 'alpha');
    const b = makeSnapshot('b.md', 'beta');
    expect(hashFiles([a, b])).toBe(hashFiles([b, a]));
  });

  it('differs when content changes', () => {
    const v1 = [makeSnapshot('a.md', 'version1')];
    const v2 = [makeSnapshot('a.md', 'version2')];
    expect(hashFiles(v1)).not.toBe(hashFiles(v2));
  });

  it('handles empty array', () => {
    const hash = hashFiles([]);
    expect(hash).toHaveLength(64);
  });
});
