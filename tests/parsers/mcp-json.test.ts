import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { parseMcpJson } from '../../src/parsers/mcp-json.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

describe('mcp-json parser', () => {
  describe('full-project .mcp.json', () => {
    const filePath = join(FIXTURES, 'full-project', '.mcp.json');

    it('returns non-null for valid MCP config', () => {
      const result = parseMcpJson(filePath, 'project');
      expect(result).not.toBeNull();
    });

    it('extracts server list', () => {
      const result = parseMcpJson(filePath, 'project')!;
      expect(result.servers).toHaveLength(1);
    });

    it('parses server name', () => {
      const result = parseMcpJson(filePath, 'project')!;
      expect(result.servers[0].name).toBe('postgres');
    });

    it('parses server command', () => {
      const result = parseMcpJson(filePath, 'project')!;
      expect(result.servers[0].command).toBe('npx');
    });

    it('parses server args', () => {
      const result = parseMcpJson(filePath, 'project')!;
      expect(result.servers[0].args).toEqual(['-y', '@modelcontextprotocol/server-postgres']);
    });

    it('parses server env', () => {
      const result = parseMcpJson(filePath, 'project')!;
      expect(result.servers[0].env.POSTGRES_CONNECTION_STRING).toBe(
        'postgresql://localhost:5432/acme_dev',
      );
    });

    it('preserves source', () => {
      const result = parseMcpJson(filePath, 'project')!;
      expect(result.source).toBe('project');
    });
  });

  describe('overconfigured .mcp.json', () => {
    const filePath = join(FIXTURES, 'overconfigured', '.mcp.json');

    it('extracts multiple servers', () => {
      const result = parseMcpJson(filePath, 'project')!;
      expect(result.servers).toHaveLength(2);
      const names = result.servers.map((s) => s.name);
      expect(names).toContain('postgres');
      expect(names).toContain('filesystem');
    });
  });

  describe('error handling', () => {
    it('returns null for non-existent file', () => {
      const result = parseMcpJson('/nonexistent/mcp.json', 'test');
      expect(result).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      // CLAUDE.md is not valid JSON
      const result = parseMcpJson(join(FIXTURES, 'full-project', 'CLAUDE.md'), 'test');
      expect(result).toBeNull();
    });

    it('returns empty servers for JSON without mcpServers key', () => {
      // settings.local.json has no mcpServers key
      const result = parseMcpJson(
        join(FIXTURES, 'full-project', '.claude', 'settings.local.json'),
        'test',
      );
      expect(result).not.toBeNull();
      expect(result!.servers).toHaveLength(0);
    });
  });
});
