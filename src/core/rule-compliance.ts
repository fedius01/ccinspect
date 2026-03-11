import type {
  ComplianceResult,
  ExtractedInstruction,
  TaskAttempt,
  ToolCall,
} from '../types/transcript.js';

// ---- Pattern definitions ----

/** "use X, not Y" / "use X instead of Y" / "prefer X over Y" / "always use X" / "never use Y" */
const COMMAND_PREFERENCE_PATTERNS: RegExp[] = [
  // "use pnpm, not npm" / "use pnpm instead of npm" / "use pnpm rather than npm"
  /\buse\s+([\w-]+)[\s,]+(?:not|instead\s+of|rather\s+than)\s+([\w-]+)\b/gi,
  // "prefer pnpm over npm"
  /\bprefer\s+([\w-]+)\s+over\s+([\w-]+)\b/gi,
  // "always use pnpm" (no avoided term)
  /\balways\s+use\s+([\w-]+)\b/gi,
  // "never use npm" / "do not use npm" / "don't use npm"
  /\b(?:never|don't|do\s+not)\s+use\s+([\w-]+)\b/gi,
];

/** "run tests after edits" style instructions */
const TEST_WORKFLOW_PATTERNS: RegExp[] = [
  /\b(?:always\s+)?run\s+(?:tests?|vitest|jest|mocha)\s+after\s+(?:every\s+)?(?:edit|change|modification)s?\b/gi,
  /\b(?:always\s+)?(?:test|run\s+tests?)\s+after\s+(?:every\s+)?(?:edit|change|making\s+changes?)s?\b/gi,
  /\brun\s+(?:npm\s+test|npm\s+run\s+test|vitest|jest)\s+after\b/gi,
];

/** Known Claude Code tool names for tool restriction matching */
const TOOL_NAMES_ALT = 'Read|Edit|Write|Bash|Task|Grep|Glob|WebFetch|WebSearch';

/** Set of tool names (lowercase) — used to exclude tool names from command-preference. */
const TOOL_NAME_SET = new Set([
  'read', 'edit', 'write', 'bash', 'task', 'grep', 'glob', 'webfetch', 'websearch',
]);

/** "never use Write" / "prefer Edit over Write" — using capturing groups for tool names */
const TOOL_RESTRICTION_PATTERNS: RegExp[] = [
  new RegExp(`\\b(?:never|don't|do\\s+not)\\s+use\\s+(${TOOL_NAMES_ALT})\\b`, 'gi'),
  new RegExp(`\\bprefer\\s+(${TOOL_NAMES_ALT})\\s+over\\s+(${TOOL_NAMES_ALT})\\b`, 'gi'),
  new RegExp(`\\balways\\s+use\\s+(${TOOL_NAMES_ALT})\\s+(?:instead\\s+of|not)\\s+(${TOOL_NAMES_ALT})\\b`, 'gi'),
];

/** Git workflow instructions */
const BRANCH_CONVENTION_PATTERNS: RegExp[] = [
  /\b(?:always\s+)?(?:work|develop|code)\s+on\s+(?:a\s+)?(?:feature\s+)?branch(?:es)?\b/gi,
  /\bnever\s+(?:commit|push)\s+(?:to\s+|directly\s+to\s+)?(?:main|master)\b/gi,
  /\balways\s+(?:create|use)\s+(?:a\s+)?(?:feature\s+|new\s+)?branch\b/gi,
];

// ---- Negation guard ----

/** Words before a match that negate its meaning. */
const NEGATION_PREFIXES = [
  "don't need to",
  'do not need to',
  'no need to',
  'unnecessary to',
  "don't have to",
  "don't",
  'do not',
  'not',
  "doesn't",
  'does not',
  "shouldn't",
  'should not',
];

/**
 * Check if the text immediately before `matchIndex` contains a negation word.
 * Looks back up to 30 characters to catch multi-word negations like "don't need to".
 */
function hasNegationPrefix(fullText: string, matchIndex: number): boolean {
  const lookbackStart = Math.max(0, matchIndex - 30);
  const prefix = fullText.slice(lookbackStart, matchIndex).toLowerCase();
  return NEGATION_PREFIXES.some((neg) => prefix.endsWith(neg + ' '));
}

// ---- Extraction ----

/**
 * Extract testable instruction patterns from a rule's markdown body.
 * Returns only concrete, checkable instructions — vague guidance is skipped.
 *
 * This is the extraction phase only. Compliance checking against transcript
 * data is a separate future step.
 */
export function extractInstructions(markdownBody: string): ExtractedInstruction[] {
  const results: ExtractedInstruction[] = [];
  const seen = new Set<string>();

  // Command preferences
  for (const pattern of COMMAND_PREFERENCE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of markdownBody.matchAll(pattern)) {
      const matchedText = match[0].trim();
      const isNegation = /^(?:never|don't|do\s+not)\b/i.test(matchedText);
      const preferred = isNegation ? undefined : match[1]?.toLowerCase();
      const avoided = isNegation ? match[1]?.toLowerCase() : match[2]?.toLowerCase();

      // Skip if captured word is a known tool name (handled by tool-restriction)
      if ((preferred && TOOL_NAME_SET.has(preferred)) || (avoided && TOOL_NAME_SET.has(avoided))) {
        continue;
      }

      const key = normalizeKey('command-preference', preferred, avoided);
      if (seen.has(key)) continue;

      // Negation guard: skip "you don't need to always use X"
      if (match.index !== undefined && hasNegationPrefix(markdownBody, match.index)) {
        continue;
      }

      seen.add(key);
      results.push({
        matchedText,
        patternType: 'command-preference',
        ...(preferred ? { preferred } : {}),
        ...(avoided ? { avoided } : {}),
      });
    }
  }

  // Test workflow
  for (const pattern of TEST_WORKFLOW_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of markdownBody.matchAll(pattern)) {
      const matchedText = match[0].trim();
      const key = normalizeKey('test-workflow', matchedText);
      if (seen.has(key)) continue;
      if (match.index !== undefined && hasNegationPrefix(markdownBody, match.index)) continue;
      seen.add(key);
      results.push({ matchedText, patternType: 'test-workflow' });
    }
  }

  // Tool restrictions
  for (const pattern of TOOL_RESTRICTION_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of markdownBody.matchAll(pattern)) {
      const matchedText = match[0].trim();
      const isNegation = /^(?:never|don't|do\s+not)\b/i.test(matchedText);
      const preferred = isNegation ? undefined : match[1];
      const avoided = isNegation ? match[1] : match[2];

      const key = normalizeKey('tool-restriction', preferred, avoided);
      if (seen.has(key)) continue;
      if (match.index !== undefined && hasNegationPrefix(markdownBody, match.index)) continue;
      seen.add(key);
      results.push({
        matchedText,
        patternType: 'tool-restriction',
        ...(preferred ? { preferred } : {}),
        ...(avoided ? { avoided } : {}),
      });
    }
  }

  // Branch conventions
  for (const pattern of BRANCH_CONVENTION_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of markdownBody.matchAll(pattern)) {
      const matchedText = match[0].trim();
      const key = normalizeKey('branch-convention', matchedText);
      if (seen.has(key)) continue;
      if (match.index !== undefined && hasNegationPrefix(markdownBody, match.index)) continue;
      seen.add(key);
      results.push({ matchedText, patternType: 'branch-convention' });
    }
  }

  // Limit to 10 per rule (defensive)
  return results.slice(0, 10);
}

function normalizeKey(type: string, a?: string, b?: string): string {
  return `${type}|${(a ?? '').toLowerCase()}|${(b ?? '').toLowerCase()}`;
}

// ---- Compliance Checking ----

/**
 * Check extracted instructions against transcript data.
 * Dispatches each instruction to the appropriate checker based on patternType.
 */
export function checkCompliance(
  instructions: ExtractedInstruction[],
  toolCalls: ToolCall[],
  tasks: TaskAttempt[],
  toolDistribution: Map<string, number>,
): ComplianceResult[] {
  const results: ComplianceResult[] = [];

  for (const instruction of instructions) {
    switch (instruction.patternType) {
      case 'command-preference':
        results.push(checkCommandPreference(instruction, toolCalls));
        break;
      case 'test-workflow':
        results.push(checkTestWorkflow(instruction, tasks));
        break;
      case 'tool-restriction':
        results.push(checkToolRestriction(instruction, toolDistribution));
        break;
      case 'branch-convention':
        results.push(checkBranchConvention(instruction, toolCalls));
        break;
    }
  }

  return results;
}

/**
 * Check if a command term appears as a command-like token in a Bash command string.
 * Splits on shell separators and checks if any token starts with or equals the term.
 */
function containsCommand(command: string, term: string): boolean {
  const tokens = command.split(/[\s|;&]+/);
  const lower = term.toLowerCase();
  return tokens.some((t) => {
    const tl = t.toLowerCase();
    return tl === lower || tl.startsWith(lower + '/');
  });
}

/**
 * Check command preference: "use pnpm, not npm" / "always use yarn" / "never use npm".
 */
function checkCommandPreference(
  instruction: ExtractedInstruction,
  toolCalls: ToolCall[],
): ComplianceResult {
  const preferred = instruction.preferred;
  const avoided = instruction.avoided;

  const bashCalls = toolCalls.filter((tc) => tc.toolName === 'Bash');
  let preferredCount = 0;
  let avoidedCount = 0;

  for (const tc of bashCalls) {
    const cmd = (tc.input.command as string) ?? '';
    if (preferred && containsCommand(cmd, preferred)) preferredCount++;
    if (avoided && containsCommand(cmd, avoided)) avoidedCount++;
  }

  const total = preferredCount + avoidedCount;

  if (total === 0) {
    return {
      instruction,
      consistent: true,
      evidence: 'No relevant commands found in transcripts',
      totalDataPoints: 0,
      consistentDataPoints: 0,
      confidence: 'heuristic',
    };
  }

  const consistent = avoidedCount === 0;
  const evidence = avoided
    ? `${preferredCount}/${total} relevant commands used ${preferred ?? '(any)'} (${avoidedCount} used ${avoided})`
    : `${preferredCount} commands used ${preferred}`;

  return {
    instruction,
    consistent,
    evidence,
    totalDataPoints: total,
    consistentDataPoints: preferredCount,
    confidence: 'heuristic',
  };
}

/**
 * Check whether test commands follow edit tasks.
 */
function checkTestWorkflow(
  instruction: ExtractedInstruction,
  tasks: TaskAttempt[],
): ComplianceResult {
  let editTasks = 0;
  let editThenTest = 0;

  for (const task of tasks) {
    const hasEdit = task.toolCalls.some(
      (tc) => tc.toolName === 'Edit' || tc.toolName === 'Write',
    );
    if (!hasEdit) continue;

    editTasks++;

    const hasTest = task.toolCalls.some(
      (tc) =>
        tc.toolName === 'Bash' &&
        isTestCommand((tc.input.command as string) ?? ''),
    );
    if (hasTest) editThenTest++;
  }

  if (editTasks === 0) {
    return {
      instruction,
      consistent: true,
      evidence: 'No edit tasks found in transcripts',
      totalDataPoints: 0,
      consistentDataPoints: 0,
      confidence: 'heuristic',
    };
  }

  const percent = Math.round((editThenTest / editTasks) * 100);
  const consistent = percent >= 50;
  const evidence = `${editThenTest}/${editTasks} edit tasks followed by test run (${percent}%)`;

  return {
    instruction,
    consistent,
    evidence,
    totalDataPoints: editTasks,
    consistentDataPoints: editThenTest,
    confidence: 'heuristic',
  };
}

function isTestCommand(command: string): boolean {
  return /(?:test|vitest|jest|mocha|pytest|npm\s+test|npm\s+run\s+test|pnpm\s+test|yarn\s+test)/i.test(
    command,
  );
}

/**
 * Check tool restriction: "never use Write" / "prefer Edit over Write".
 */
function checkToolRestriction(
  instruction: ExtractedInstruction,
  toolDistribution: Map<string, number>,
): ComplianceResult {
  const restricted = instruction.avoided;
  const preferred = instruction.preferred;

  const restrictedCount = restricted
    ? (toolDistribution.get(restricted) ?? 0)
    : 0;
  const preferredCount = preferred
    ? (toolDistribution.get(preferred) ?? 0)
    : 0;

  if (restrictedCount === 0 && preferredCount === 0) {
    return {
      instruction,
      consistent: true,
      evidence: 'Neither tool was used in transcripts',
      totalDataPoints: 0,
      consistentDataPoints: 0,
      confidence: 'heuristic',
    };
  }

  const total = restrictedCount + preferredCount;
  const consistent = restrictedCount === 0;

  let evidence: string;
  if (restricted && preferred) {
    evidence = `${preferred} used ${preferredCount} times, ${restricted} used ${restrictedCount} times`;
  } else if (restricted) {
    evidence = `${restricted} used ${restrictedCount} times`;
  } else {
    evidence = `${preferred} used ${preferredCount} times`;
  }

  return {
    instruction,
    consistent,
    evidence,
    totalDataPoints: total,
    consistentDataPoints: preferredCount,
    confidence: 'heuristic',
  };
}

/**
 * Check branch convention: "always work on feature branches" / "never commit to main".
 */
function checkBranchConvention(
  instruction: ExtractedInstruction,
  toolCalls: ToolCall[],
): ComplianceResult {
  const bashCalls = toolCalls.filter((tc) => tc.toolName === 'Bash');
  const gitCalls = bashCalls.filter((tc) =>
    ((tc.input.command as string) ?? '').startsWith('git '),
  );

  if (gitCalls.length === 0) {
    return {
      instruction,
      consistent: true,
      evidence: 'No git commands found in transcripts',
      totalDataPoints: 0,
      consistentDataPoints: 0,
      confidence: 'heuristic',
    };
  }

  const mainBranchOps = gitCalls.filter((tc) => {
    const cmd = (tc.input.command as string) ?? '';
    return (
      /git\s+(?:push|commit).*(?:main|master)/i.test(cmd) ||
      /git\s+checkout\s+(?:main|master)/i.test(cmd)
    );
  });

  const consistent = mainBranchOps.length === 0;
  const evidence = consistent
    ? `${gitCalls.length} git commands, none targeting main/master`
    : `${mainBranchOps.length}/${gitCalls.length} git commands targeted main/master`;

  return {
    instruction,
    consistent,
    evidence,
    totalDataPoints: gitCalls.length,
    consistentDataPoints: gitCalls.length - mainBranchOps.length,
    confidence: 'heuristic',
  };
}
