import { describe, it, expect } from 'vitest';
import { checkCompliance } from '../../src/core/rule-compliance.js';
import type {
  ExtractedInstruction,
  ToolCall,
  TaskAttempt,
} from '../../src/types/transcript.js';

let callCounter = 0;

/** Helper to build a minimal ToolCall. */
function bash(command: string): ToolCall {
  return {
    toolName: 'Bash',
    input: { command },
    callId: `call_${++callCounter}`,
    callerType: 'user',
    requestId: 'req_1',
    isSidechain: false,
  };
}

function toolCall(toolName: string, input: Record<string, unknown> = {}): ToolCall {
  return {
    toolName,
    input,
    callId: `call_${++callCounter}`,
    callerType: 'user',
    requestId: 'req_1',
    isSidechain: false,
  };
}

/** Helper to build a minimal TaskAttempt with given tool calls. */
function task(calls: ToolCall[]): TaskAttempt {
  return {
    prompt: 'test prompt',
    startedAt: new Date(),
    endedAt: new Date(),
    toolCalls: calls,
    toolResults: [],
    outcome: 'success',
  };
}

// ---- Command Preference ----

describe('checkCompliance — command preference', () => {
  const prefInstruction: ExtractedInstruction = {
    matchedText: 'use pnpm, not npm',
    patternType: 'command-preference',
    preferred: 'pnpm',
    avoided: 'npm',
  };

  it('fully consistent — only preferred term used', () => {
    const calls: ToolCall[] = [];
    for (let i = 0; i < 14; i++) {
      calls.push(bash('pnpm install'));
    }

    const results = checkCompliance(
      [prefInstruction],
      calls,
      [],
      new Map(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].consistent).toBe(true);
    expect(results[0].totalDataPoints).toBe(14);
    expect(results[0].consistentDataPoints).toBe(14);
    expect(results[0].evidence).toContain('14/14');
    expect(results[0].confidence).toBe('heuristic');
  });

  it('inconsistent — avoided term used', () => {
    const calls = [
      ...Array.from({ length: 10 }, () => bash('pnpm install')),
      ...Array.from({ length: 4 }, () => bash('npm install')),
    ];

    const results = checkCompliance(
      [prefInstruction],
      calls,
      [],
      new Map(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].consistent).toBe(false);
    expect(results[0].totalDataPoints).toBe(14);
    expect(results[0].consistentDataPoints).toBe(10);
    expect(results[0].evidence).toContain('4 used npm');
  });

  it('fully violated — only avoided term', () => {
    const calls = Array.from({ length: 5 }, () => bash('npm install'));

    const results = checkCompliance(
      [prefInstruction],
      calls,
      [],
      new Map(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].consistent).toBe(false);
    expect(results[0].consistentDataPoints).toBe(0);
  });

  it('no relevant calls — returns consistent with 0 data points', () => {
    const calls = [bash('git status'), bash('echo hello')];

    const results = checkCompliance(
      [prefInstruction],
      calls,
      [],
      new Map(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].consistent).toBe(true);
    expect(results[0].totalDataPoints).toBe(0);
    expect(results[0].evidence).toContain('No relevant commands');
  });

  it('"never use X" — avoided only, no preferred', () => {
    const neverInstruction: ExtractedInstruction = {
      matchedText: 'never use npm',
      patternType: 'command-preference',
      avoided: 'npm',
    };

    const calls = [bash('npm install'), bash('npm test'), bash('npm run build')];

    const results = checkCompliance(
      [neverInstruction],
      calls,
      [],
      new Map(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].consistent).toBe(false);
    expect(results[0].totalDataPoints).toBe(3);
  });
});

// ---- Test Workflow ----

describe('checkCompliance — test workflow', () => {
  const workflowInstruction: ExtractedInstruction = {
    matchedText: 'run tests after every edit',
    patternType: 'test-workflow',
  };

  it('good compliance (>50%)', () => {
    const tasks: TaskAttempt[] = [];
    // 8 edit tasks with test runs
    for (let i = 0; i < 8; i++) {
      tasks.push(task([
        toolCall('Edit', { file_path: 'src/foo.ts' }),
        bash('npm test'),
      ]));
    }
    // 2 edit tasks without test runs
    for (let i = 0; i < 2; i++) {
      tasks.push(task([
        toolCall('Edit', { file_path: 'src/bar.ts' }),
      ]));
    }

    const results = checkCompliance(
      [workflowInstruction],
      [],
      tasks,
      new Map(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].consistent).toBe(true);
    expect(results[0].totalDataPoints).toBe(10);
    expect(results[0].consistentDataPoints).toBe(8);
    expect(results[0].evidence).toContain('80%');
  });

  it('poor compliance (<50%)', () => {
    const tasks: TaskAttempt[] = [];
    // 2 edit tasks with test
    for (let i = 0; i < 2; i++) {
      tasks.push(task([
        toolCall('Edit', { file_path: 'src/foo.ts' }),
        bash('npm test'),
      ]));
    }
    // 8 edit tasks without test
    for (let i = 0; i < 8; i++) {
      tasks.push(task([
        toolCall('Edit', { file_path: 'src/bar.ts' }),
      ]));
    }

    const results = checkCompliance(
      [workflowInstruction],
      [],
      tasks,
      new Map(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].consistent).toBe(false);
    expect(results[0].evidence).toContain('20%');
  });

  it('no edit tasks — returns consistent', () => {
    const tasks: TaskAttempt[] = [
      task([toolCall('Read', { file_path: 'src/foo.ts' })]),
      task([bash('git status')]),
    ];

    const results = checkCompliance(
      [workflowInstruction],
      [],
      tasks,
      new Map(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].consistent).toBe(true);
    expect(results[0].totalDataPoints).toBe(0);
    expect(results[0].evidence).toContain('No edit tasks');
  });
});

// ---- Tool Restriction ----

describe('checkCompliance — tool restriction', () => {
  it('restricted tool not used — consistent', () => {
    const instruction: ExtractedInstruction = {
      matchedText: 'never use Write',
      patternType: 'tool-restriction',
      avoided: 'Write',
    };

    const dist = new Map<string, number>([['Edit', 50], ['Read', 30]]);

    const results = checkCompliance(
      [instruction],
      [],
      [],
      dist,
    );

    expect(results).toHaveLength(1);
    expect(results[0].consistent).toBe(true);
  });

  it('restricted tool used — inconsistent', () => {
    const instruction: ExtractedInstruction = {
      matchedText: 'never use Write',
      patternType: 'tool-restriction',
      avoided: 'Write',
    };

    const dist = new Map<string, number>([['Write', 15], ['Edit', 50]]);

    const results = checkCompliance(
      [instruction],
      [],
      [],
      dist,
    );

    expect(results).toHaveLength(1);
    expect(results[0].consistent).toBe(false);
    expect(results[0].evidence).toContain('Write used 15 times');
  });

  it('prefer X over Y — Y still used is inconsistent', () => {
    const instruction: ExtractedInstruction = {
      matchedText: 'prefer Edit over Write',
      patternType: 'tool-restriction',
      preferred: 'Edit',
      avoided: 'Write',
    };

    const dist = new Map<string, number>([['Edit', 50], ['Write', 5]]);

    const results = checkCompliance(
      [instruction],
      [],
      [],
      dist,
    );

    expect(results).toHaveLength(1);
    expect(results[0].consistent).toBe(false);
    expect(results[0].evidence).toContain('Edit used 50 times');
    expect(results[0].evidence).toContain('Write used 5 times');
  });
});

// ---- Branch Convention ----

describe('checkCompliance — branch convention', () => {
  it('no main branch operations — consistent', () => {
    const instruction: ExtractedInstruction = {
      matchedText: 'never commit to main',
      patternType: 'branch-convention',
    };

    const calls = [
      bash('git checkout feature-branch'),
      bash('git commit -m "fix"'),
      bash('git push origin feature-branch'),
    ];

    const results = checkCompliance(
      [instruction],
      calls,
      [],
      new Map(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].consistent).toBe(true);
    expect(results[0].evidence).toContain('3 git commands, none targeting main/master');
  });

  it('push to main detected — inconsistent', () => {
    const instruction: ExtractedInstruction = {
      matchedText: 'never push to main',
      patternType: 'branch-convention',
    };

    const calls = [
      bash('git push origin main'),
      bash('git commit -m "fix"'),
    ];

    const results = checkCompliance(
      [instruction],
      calls,
      [],
      new Map(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].consistent).toBe(false);
    expect(results[0].evidence).toContain('1/2');
  });

  it('no git commands at all — consistent', () => {
    const instruction: ExtractedInstruction = {
      matchedText: 'always work on feature branches',
      patternType: 'branch-convention',
    };

    const calls = [bash('echo hello'), bash('npm test')];

    const results = checkCompliance(
      [instruction],
      calls,
      [],
      new Map(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].consistent).toBe(true);
    expect(results[0].totalDataPoints).toBe(0);
    expect(results[0].evidence).toContain('No git commands');
  });
});

// ---- Full pipeline ----

describe('checkCompliance — full pipeline', () => {
  it('multiple instructions on one rule produce independent results', () => {
    const instructions: ExtractedInstruction[] = [
      {
        matchedText: 'use pnpm, not npm',
        patternType: 'command-preference',
        preferred: 'pnpm',
        avoided: 'npm',
      },
      {
        matchedText: 'run tests after every edit',
        patternType: 'test-workflow',
      },
    ];

    const calls = [bash('pnpm install'), bash('pnpm test')];
    const tasks = [
      task([toolCall('Edit', { file_path: 'foo.ts' }), bash('pnpm test')]),
      task([toolCall('Edit', { file_path: 'bar.ts' })]),
    ];

    const results = checkCompliance(
      instructions,
      calls,
      tasks,
      new Map(),
    );

    expect(results).toHaveLength(2);
    // First: command preference
    expect(results[0].instruction.patternType).toBe('command-preference');
    expect(results[0].consistent).toBe(true);
    // Second: test workflow (50% — 1/2)
    expect(results[1].instruction.patternType).toBe('test-workflow');
    expect(results[1].consistent).toBe(true); // 50% >= 50%
    expect(results[1].totalDataPoints).toBe(2);
    expect(results[1].consistentDataPoints).toBe(1);
  });

  it('empty instructions produce empty results', () => {
    const results = checkCompliance(
      [],
      [bash('npm install')],
      [],
      new Map(),
    );

    expect(results).toHaveLength(0);
  });
});
