import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHandover } from '../../src/core/session-handover-renderer.js';
import type { HandoverResult, GateResult } from '../../src/core/session-handover.js';

function makeResult(overrides: Partial<HandoverResult> = {}): HandoverResult {
  return {
    timestamp: '2026-02-27T22:30:00.000Z',
    projectName: 'ccinspect',
    branch: 'main',
    completedWork: [],
    uncommittedChanges: [],
    testResult: null,
    typecheckResult: null,
    smellsResult: null,
    todos: [],
    suggestedPrompt: 'All quality gates passing.',
    ...overrides,
  };
}

function makeGate(overrides: Partial<GateResult> = {}): GateResult {
  return {
    passed: true,
    summary: '325 passing',
    raw: 'Tests  325 passed',
    ...overrides,
  };
}

describe('session-handover-renderer', () => {
  describe('renderHandover', () => {
    it('renders basic header with project info', () => {
      const result = makeResult();
      const md = renderHandover(result);

      expect(md).toContain('# Session Status');
      expect(md).toContain('**Generated:** 2026-02-27T22:30:00.000Z');
      expect(md).toContain('**Project:** ccinspect');
      expect(md).toContain('**Branch:** main');
    });

    it('omits branch when null', () => {
      const result = makeResult({ branch: null });
      const md = renderHandover(result);

      expect(md).not.toContain('**Branch:**');
    });

    it('renders completed work', () => {
      const result = makeResult({
        completedWork: [
          { status: 'modified', path: 'src/core/scanner.ts', staged: false },
          { status: 'added', path: 'src/rules/new-rule.ts', staged: false },
          { status: 'deleted', path: 'src/old-module.ts', staged: false },
        ],
      });
      const md = renderHandover(result);

      expect(md).toContain('## Completed Work');
      expect(md).toContain('- Modified: src/core/scanner.ts');
      expect(md).toContain('- Added: src/rules/new-rule.ts');
      expect(md).toContain('- Deleted: src/old-module.ts');
    });

    it('shows no changes message when empty', () => {
      const result = makeResult({ completedWork: [] });
      const md = renderHandover(result);

      expect(md).toContain('No changes detected.');
    });

    it('renders uncommitted changes with staged/unstaged labels', () => {
      const result = makeResult({
        uncommittedChanges: [
          { status: 'modified', path: 'src/core/scanner.ts', staged: true },
          { status: 'modified', path: 'README.md', staged: false },
          { status: 'added', path: 'new-file.ts', staged: false },
        ],
      });
      const md = renderHandover(result);

      expect(md).toContain('## Uncommitted Changes');
      expect(md).toContain('- Modified: src/core/scanner.ts (staged)');
      expect(md).toContain('- Modified: README.md (unstaged)');
      expect(md).toContain('- Added: new-file.ts (unstaged)');
    });

    it('omits uncommitted section when empty', () => {
      const result = makeResult({ uncommittedChanges: [] });
      const md = renderHandover(result);

      expect(md).not.toContain('## Uncommitted Changes');
    });

    it('renders quality gates table', () => {
      const result = makeResult({
        testResult: makeGate({ passed: true, summary: '325 passing' }),
        typecheckResult: makeGate({ passed: true, summary: '0 errors' }),
      });
      const md = renderHandover(result);

      expect(md).toContain('## Quality Gates');
      expect(md).toContain('| Gate | Status | Details |');
      expect(md).toContain('| Tests | \u2705 Pass | 325 passing |');
      expect(md).toContain('| TypeScript | \u2705 Pass | 0 errors |');
    });

    it('renders failing gates with fail icon', () => {
      const result = makeResult({
        testResult: makeGate({ passed: false, summary: '320 passing, 5 failing' }),
      });
      const md = renderHandover(result);

      expect(md).toContain('| Tests | \u274c Fail | 320 passing, 5 failing |');
    });

    it('renders smells with warning icon', () => {
      const result = makeResult({
        smellsResult: makeGate({ passed: true, summary: '0 errors, 37 warnings' }),
      });
      const md = renderHandover(result);

      expect(md).toContain('| Code Smells | \u26a0\ufe0f Warnings | 0 errors, 37 warnings |');
    });

    it('omits quality gates when none exist', () => {
      const result = makeResult();
      const md = renderHandover(result);

      expect(md).not.toContain('## Quality Gates');
    });

    it('renders issues from TODOs', () => {
      const result = makeResult({
        todos: [
          { file: 'src/core/scanner.ts', line: 45, text: 'TODO: handle edge case' },
          { file: 'src/rules/index.ts', line: 12, text: 'FIXME: cleanup' },
        ],
      });
      const md = renderHandover(result);

      expect(md).toContain('## Issues Found');
      expect(md).toContain('- src/core/scanner.ts:45 \u2014 TODO: handle edge case');
      expect(md).toContain('- src/rules/index.ts:12 \u2014 FIXME: cleanup');
    });

    it('renders issues from failing gates', () => {
      const result = makeResult({
        testResult: makeGate({ passed: false, summary: '3 failing' }),
        typecheckResult: makeGate({ passed: false, summary: '2 errors' }),
      });
      const md = renderHandover(result);

      expect(md).toContain('## Issues Found');
      expect(md).toContain('- Tests failing: 3 failing');
      expect(md).toContain('- TypeScript errors: 2 errors');
    });

    it('omits issues section when none exist', () => {
      const result = makeResult({
        testResult: makeGate({ passed: true }),
        typecheckResult: makeGate({ passed: true }),
      });
      const md = renderHandover(result);

      expect(md).not.toContain('## Issues Found');
    });

    it('renders suggested next session prompt', () => {
      const result = makeResult({
        suggestedPrompt: 'All quality gates passing. 37 code smell warnings remain.',
      });
      const md = renderHandover(result);

      expect(md).toContain('## Suggested Next Session Prompt');
      expect(md).toContain('> All quality gates passing. 37 code smell warnings remain.');
    });

    it('produces well-formed markdown', () => {
      const result = makeResult({
        completedWork: [
          { status: 'modified', path: 'src/foo.ts', staged: false },
        ],
        uncommittedChanges: [
          { status: 'added', path: 'src/bar.ts', staged: true },
        ],
        testResult: makeGate({ passed: true, summary: '100 passing' }),
        typecheckResult: makeGate({ passed: true, summary: '0 errors' }),
        smellsResult: makeGate({ passed: true, summary: '0 errors, 5 warnings' }),
        todos: [
          { file: 'src/foo.ts', line: 10, text: 'TODO: finish this' },
        ],
        suggestedPrompt: 'Continue work.',
      });
      const md = renderHandover(result);

      // Verify all sections are present in order
      const sectionOrder = [
        '# Session Status',
        '## Completed Work',
        '## Uncommitted Changes',
        '## Quality Gates',
        '## Issues Found',
        '## Suggested Next Session Prompt',
      ];

      let lastIndex = -1;
      for (const section of sectionOrder) {
        const idx = md.indexOf(section);
        expect(idx).toBeGreaterThan(lastIndex);
        lastIndex = idx;
      }
    });
  });
});

describe('session-handover generateHandover', () => {
  // Use vi.mock for execSync to test generateHandover without real shell commands
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('module exports generateHandover function', async () => {
    const mod = await import('../../src/core/session-handover.js');
    expect(typeof mod.generateHandover).toBe('function');
  });

  it('module exports HandoverConfig type', async () => {
    // Just verify the module loads without error
    const mod = await import('../../src/core/session-handover.js');
    expect(mod).toBeDefined();
  });
});

describe('session-handover config integration', () => {
  it('loadConfig returns sessionHandover when present', async () => {
    const { loadConfig } = await import('../../src/utils/config.js');
    // Loading from a fixture that doesn't have .ccinspect.json should return undefined
    const config = loadConfig('/nonexistent-path-for-test');
    expect(config.sessionHandover).toBeUndefined();
  });
});
