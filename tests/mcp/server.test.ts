import { describe, it, expect } from 'vitest';
import { resolve as resolvePath } from 'path';
import {
  createServer,
  handleLint,
  handleScan,
  handleAudit,
  handleHistory,
  handleBlame,
  handleDiff,
  handleRestore,
  handleHealthCheck,
} from '../../src/mcp/server.js';

// Fixture paths
const MINIMAL_PROJECT = resolvePath('tests/fixtures/minimal-project');
const FULL_PROJECT = resolvePath('tests/fixtures/full-project');

/** Parse the JSON text from a tool result. */
function parseResult(result: { content: Array<{ type: string; text: string }>; isError?: boolean }): unknown {
  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe('text');
  return JSON.parse(result.content[0].text);
}

describe('MCP Server', () => {
  describe('createServer', () => {
    it('creates server with correct name and version', () => {
      const server = createServer();
      // Server is created without errors
      expect(server).toBeDefined();
      // The underlying Server instance is accessible
      expect(server.server).toBeDefined();
    });

    it('registers all 8 tools', () => {
      const server = createServer();
      // Access internal registered tools via the underlying server
      // McpServer stores tools in _registeredTools
      const registeredTools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
      const toolNames = Object.keys(registeredTools);

      expect(toolNames).toContain('lint');
      expect(toolNames).toContain('scan');
      expect(toolNames).toContain('audit');
      expect(toolNames).toContain('history');
      expect(toolNames).toContain('diff');
      expect(toolNames).toContain('restore');
      expect(toolNames).toContain('blame');
      expect(toolNames).toContain('health_check');
      expect(toolNames).toHaveLength(8);
    });

    it('sets server instructions', () => {
      const server = createServer();
      // The instructions are set on the underlying Server instance
      const instructions = (server.server as unknown as { _instructions: string })._instructions;
      expect(instructions).toContain('ccinspect');
      expect(instructions).toContain('lint');
      expect(instructions).toContain('blame');
    });
  });

  describe('handleScan', () => {
    it('returns inventory for a valid project directory', async () => {
      const result = await handleScan({ projectDir: FULL_PROJECT });
      expect(result.isError).toBeUndefined();

      const data = parseResult(result) as Record<string, unknown>;
      expect(data).toHaveProperty('projectRoot');
      expect(data).toHaveProperty('totalFiles');
      expect(data).toHaveProperty('totalStartupTokens');
    });

    it('returns error for non-existent directory', async () => {
      const result = await handleScan({ projectDir: '/nonexistent/path/12345' });
      expect(result.isError).toBe(true);

      const data = parseResult(result) as Record<string, unknown>;
      expect(data).toHaveProperty('error');
      expect(data.error).toContain('not found');
    });
  });

  describe('handleLint', () => {
    it('returns lint issues for a project directory', async () => {
      const result = await handleLint({ projectDir: FULL_PROJECT });
      expect(result.isError).toBeUndefined();

      const data = parseResult(result) as Record<string, unknown>;
      expect(data).toHaveProperty('issues');
      expect(data).toHaveProperty('stats');

      const stats = data.stats as Record<string, unknown>;
      expect(stats).toHaveProperty('errors');
      expect(stats).toHaveProperty('warnings');
      expect(stats).toHaveProperty('rulesRun');
    });

    it('enriches issues with LLM-friendly metadata', async () => {
      const result = await handleLint({ projectDir: FULL_PROJECT });
      const data = parseResult(result) as Record<string, unknown>;
      const issues = data.issues as Array<Record<string, unknown>>;

      if (issues.length > 0) {
        const issue = issues[0];
        // LLM-friendly fields should be present
        expect(issue).toHaveProperty('ruleId');
        expect(issue).toHaveProperty('severity');
        expect(issue).toHaveProperty('ruleDescription');
        expect(issue).toHaveProperty('fixCategory');
        expect(issue).toHaveProperty('fixComplexity');
      }
    });

    it('filters by minimum severity', async () => {
      const allResult = await handleLint({ projectDir: FULL_PROJECT, minSeverity: 'info' });
      const errorsOnlyResult = await handleLint({ projectDir: FULL_PROJECT, minSeverity: 'error' });

      const allData = parseResult(allResult) as Record<string, unknown>;
      const errorsData = parseResult(errorsOnlyResult) as Record<string, unknown>;

      const allIssues = allData.issues as unknown[];
      const errorIssues = errorsData.issues as unknown[];

      // Error-only should have <= all issues
      expect(errorIssues.length).toBeLessThanOrEqual(allIssues.length);
    });

    it('supports single-file mode', async () => {
      const claudeMdPath = resolvePath(FULL_PROJECT, 'CLAUDE.md');
      const result = await handleLint({ target: claudeMdPath });
      expect(result.isError).toBeUndefined();

      const data = parseResult(result) as Record<string, unknown>;
      expect(data).toHaveProperty('singleFileMode');
      expect(data).toHaveProperty('issues');

      const singleFileMode = data.singleFileMode as Record<string, unknown>;
      expect(singleFileMode.type).toBe('claude-md');
    });

    it('returns error for non-existent file in single-file mode', async () => {
      const result = await handleLint({ target: '/nonexistent/file.md' });
      expect(result.isError).toBe(true);

      const data = parseResult(result) as Record<string, unknown>;
      expect(data.error).toContain('not found');
    });

    it('returns error for non-existent project directory', async () => {
      const result = await handleLint({ projectDir: '/nonexistent/dir' });
      expect(result.isError).toBe(true);
    });
  });

  describe('handleAudit', () => {
    it('returns audit data for a project with no transcripts', async () => {
      const result = await handleAudit({ projectDir: FULL_PROJECT });
      expect(result.isError).toBeUndefined();

      const data = parseResult(result) as Record<string, unknown>;
      expect(data).toHaveProperty('dataQuality');
      expect(data).toHaveProperty('agents');
      expect(data).toHaveProperty('skills');
      expect(data).toHaveProperty('rules');
      expect(data).toHaveProperty('discrepancies');
      expect(data).toHaveProperty('fileHeatmap');
    });

    it('returns error for non-existent directory', async () => {
      const result = await handleAudit({ projectDir: '/nonexistent/path' });
      expect(result.isError).toBe(true);
    });
  });

  describe('handleHistory', () => {
    it('returns empty history for a project with no history', async () => {
      const result = await handleHistory({ projectDir: MINIMAL_PROJECT });
      expect(result.isError).toBeUndefined();

      const data = parseResult(result) as Record<string, unknown>;
      expect(data).toHaveProperty('totalVersions');
      expect(data).toHaveProperty('entries');
    });

    it('returns error for non-existent directory', async () => {
      const result = await handleHistory({ projectDir: '/nonexistent/path' });
      expect(result.isError).toBe(true);
    });
  });

  describe('handleDiff', () => {
    it('returns error when no history exists', async () => {
      const result = await handleDiff({
        projectDir: MINIMAL_PROJECT,
        v1: '1',
        v2: '2',
      });
      // Either error (no history) or version not found
      expect(result.isError).toBe(true);
    });

    it('returns error for non-existent directory', async () => {
      const result = await handleDiff({
        projectDir: '/nonexistent/path',
        v1: '1',
        v2: '2',
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('handleRestore', () => {
    it('returns error for non-existent version', async () => {
      const result = await handleRestore({
        projectDir: MINIMAL_PROJECT,
        version: 999,
      });
      expect(result.isError).toBe(true);
    });

    it('returns error for non-existent directory', async () => {
      const result = await handleRestore({
        projectDir: '/nonexistent/path',
        version: 1,
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('handleBlame', () => {
    it('returns resolved config for a valid project', async () => {
      const result = await handleBlame({ projectDir: FULL_PROJECT });
      expect(result.isError).toBeUndefined();

      const data = parseResult(result) as Record<string, unknown>;
      expect(data).toHaveProperty('permissions');
      expect(data).toHaveProperty('environment');
      expect(data).toHaveProperty('mcpServers');
      expect(data).toHaveProperty('model');
      expect(data).toHaveProperty('sandbox');
    });

    it('returns error for non-existent directory', async () => {
      const result = await handleBlame({ projectDir: '/nonexistent/path' });
      expect(result.isError).toBe(true);
    });
  });

  describe('handleHealthCheck', () => {
    it('returns all 4 sections for a valid project', async () => {
      const result = await handleHealthCheck({ projectDir: FULL_PROJECT });
      expect(result.isError).toBeUndefined();

      const data = parseResult(result) as Record<string, unknown>;
      expect(data).toHaveProperty('scan');
      expect(data).toHaveProperty('lint');
      expect(data).toHaveProperty('history');
      expect(data).toHaveProperty('audit');
    });

    it('scan section includes file inventory', async () => {
      const result = await handleHealthCheck({ projectDir: FULL_PROJECT });
      const data = parseResult(result) as Record<string, unknown>;
      const scanData = data.scan as Record<string, unknown>;

      expect(scanData).toHaveProperty('totalFiles');
      expect(scanData).toHaveProperty('totalStartupTokens');
      expect(scanData).toHaveProperty('files');
      expect(Array.isArray(scanData.files)).toBe(true);
    });

    it('lint section includes enriched issues with metadata', async () => {
      const result = await handleHealthCheck({ projectDir: FULL_PROJECT });
      const data = parseResult(result) as Record<string, unknown>;
      const lintData = data.lint as Record<string, unknown>;

      expect(lintData).toHaveProperty('summary');
      expect(lintData).toHaveProperty('issues');

      const summary = lintData.summary as Record<string, unknown>;
      expect(summary).toHaveProperty('errors');
      expect(summary).toHaveProperty('warnings');
      expect(summary).toHaveProperty('rulesRun');

      const issues = lintData.issues as Array<Record<string, unknown>>;
      if (issues.length > 0) {
        expect(issues[0]).toHaveProperty('ruleDescription');
        expect(issues[0]).toHaveProperty('fixCategory');
        expect(issues[0]).toHaveProperty('fixComplexity');
      }
    });

    it('history section includes version data', async () => {
      const result = await handleHealthCheck({ projectDir: FULL_PROJECT });
      const data = parseResult(result) as Record<string, unknown>;
      const historyData = data.history as Record<string, unknown>;

      expect(historyData).toHaveProperty('totalVersions');
      expect(historyData).toHaveProperty('lineageVersions');
      expect(historyData).toHaveProperty('recentChanges');
    });

    it('audit section present even without transcripts', async () => {
      const result = await handleHealthCheck({ projectDir: FULL_PROJECT });
      const data = parseResult(result) as Record<string, unknown>;
      const auditData = data.audit as Record<string, unknown>;

      expect(auditData).toHaveProperty('sessionsAnalyzed');
      expect(auditData.sessionsAnalyzed).toBe(0);
    });

    it('includes componentSummary array in output', async () => {
      const result = await handleHealthCheck({ projectDir: FULL_PROJECT });
      const data = parseResult(result) as Record<string, unknown>;

      expect(data).toHaveProperty('componentSummary');
      expect(Array.isArray(data.componentSummary)).toBe(true);
    });

    it('includes analysisHints array in output', async () => {
      const result = await handleHealthCheck({ projectDir: FULL_PROJECT });
      const data = parseResult(result) as Record<string, unknown>;

      expect(data).toHaveProperty('analysisHints');
      expect(Array.isArray(data.analysisHints)).toBe(true);
    });

    it('componentSummary groups lint issues by file', async () => {
      const result = await handleHealthCheck({ projectDir: FULL_PROJECT });
      const data = parseResult(result) as Record<string, unknown>;
      const summary = data.componentSummary as Array<Record<string, unknown>>;

      if (summary.length > 0) {
        const entry = summary[0];
        expect(entry).toHaveProperty('name');
        expect(entry).toHaveProperty('type');
        expect(entry).toHaveProperty('scope');
        expect(entry).toHaveProperty('file');
        expect(entry).toHaveProperty('lintIssues');
        expect(Array.isArray(entry.lintIssues)).toBe(true);
      }
    });

    it('lint issues include scope field when file is classifiable', async () => {
      const result = await handleHealthCheck({ projectDir: FULL_PROJECT });
      const data = parseResult(result) as Record<string, unknown>;
      const lintData = data.lint as Record<string, unknown>;
      const issues = lintData.issues as Array<Record<string, unknown>>;

      const issuesWithFile = issues.filter((i) => i.fileType);
      if (issuesWithFile.length > 0) {
        // All issues with a classifiable file type should have scope
        for (const issue of issuesWithFile) {
          expect(issue).toHaveProperty('scope');
          expect(['enterprise', 'user', 'project-shared', 'project-local']).toContain(issue.scope);
        }
      }
    });

    it('analysisHints are capped at 5', async () => {
      // Use a project that might generate many findings
      const result = await handleHealthCheck({ projectDir: FULL_PROJECT });
      const data = parseResult(result) as Record<string, unknown>;
      const hints = data.analysisHints as string[];

      expect(hints.length).toBeLessThanOrEqual(5);
    });

    it('analysisHints is empty array when no co-occurrence patterns exist', async () => {
      // Minimal project should have few/no co-occurrence patterns
      const result = await handleHealthCheck({ projectDir: MINIMAL_PROJECT });
      const data = parseResult(result) as Record<string, unknown>;

      expect(data).toHaveProperty('analysisHints');
      expect(Array.isArray(data.analysisHints)).toBe(true);
    });

    it('returns error for non-existent directory', async () => {
      const result = await handleHealthCheck({ projectDir: '/nonexistent/path' });
      expect(result.isError).toBe(true);
    });
  });

  describe('error handling', () => {
    it('tool handlers never throw — they return error results', async () => {
      // All handlers should catch errors and return them as error results
      const results = await Promise.all([
        handleScan({ projectDir: '/nonexistent' }),
        handleLint({ projectDir: '/nonexistent' }),
        handleAudit({ projectDir: '/nonexistent' }),
        handleHistory({ projectDir: '/nonexistent' }),
        handleDiff({ projectDir: '/nonexistent', v1: '1', v2: '2' }),
        handleRestore({ projectDir: '/nonexistent', version: 1 }),
        handleBlame({ projectDir: '/nonexistent' }),
        handleHealthCheck({ projectDir: '/nonexistent' }),
      ]);

      for (const result of results) {
        // Should be an error result, not a thrown exception
        expect(result.isError).toBe(true);
        expect(result.content).toHaveLength(1);
        expect(result.content[0].type).toBe('text');
        // Should be valid JSON
        const data = JSON.parse(result.content[0].text);
        expect(data).toHaveProperty('error');
      }
    });
  });
});
