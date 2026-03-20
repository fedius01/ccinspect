import type { FixCategory, FixComplexity } from '../types/lint.js';

export interface RuleMetadata {
  fixCategory: FixCategory;
  fixComplexity: FixComplexity;
  ruleDescription: string;
  docUrl: string;
}

const RULE_METADATA = new Map<string, RuleMetadata>([
  // ── memory (9) ──────────────────────────────────────────────────────
  [
    'memory/line-count',
    {
      fixCategory: 'restructure',
      fixComplexity: 'moderate',
      ruleDescription:
        'Flags CLAUDE.md files exceeding line count thresholds. Long files degrade instruction-following quality.',
      docUrl: 'https://code.claude.com/docs/en/memory',
    },
  ],
  [
    'memory/token-budget',
    {
      fixCategory: 'restructure',
      fixComplexity: 'moderate',
      ruleDescription:
        'Flags CLAUDE.md files exceeding token count thresholds. High token counts consume context window budget.',
      docUrl: 'https://code.claude.com/docs/en/memory',
    },
  ],
  [
    'memory/generic-instructions',
    {
      fixCategory: 'edit',
      fixComplexity: 'simple',
      ruleDescription:
        'Detects vague instructions like "follow best practices" that waste tokens without guiding behavior.',
      docUrl: 'https://code.claude.com/docs/en/memory',
    },
  ],
  [
    'memory/missing-sections',
    {
      fixCategory: 'add',
      fixComplexity: 'moderate',
      ruleDescription:
        'Checks for recommended sections (overview, commands, architecture) in project CLAUDE.md.',
      docUrl: 'https://code.claude.com/docs/en/memory',
    },
  ],
  [
    'memory/import-depth',
    {
      fixCategory: 'restructure',
      fixComplexity: 'moderate',
      ruleDescription:
        'Flags @import chains exceeding the maximum depth (5 levels). Deep chains are hard to follow and may hit limits.',
      docUrl: 'https://code.claude.com/docs/en/memory',
    },
  ],
  [
    'memory/auto-memory-size',
    {
      fixCategory: 'restructure',
      fixComplexity: 'simple',
      ruleDescription:
        'Checks MEMORY.md line count since only the first 200 lines are loaded at startup.',
      docUrl: 'https://code.claude.com/docs/en/memory',
    },
  ],
  [
    'memory/section-too-large',
    {
      fixCategory: 'restructure',
      fixComplexity: 'moderate',
      ruleDescription:
        'Flags individual CLAUDE.md sections consuming a disproportionate share of tokens.',
      docUrl: 'https://code.claude.com/docs/en/memory',
    },
  ],
  [
    'memory/stale-imports',
    {
      fixCategory: 'remove',
      fixComplexity: 'trivial',
      ruleDescription:
        'Flags @import directives pointing to non-existent files. Stale imports silently produce no content.',
      docUrl: 'https://code.claude.com/docs/en/memory',
    },
  ],
  [
    'memory/todo-fixme',
    {
      fixCategory: 'review',
      fixComplexity: 'trivial',
      ruleDescription:
        'Flags TODO, FIXME, HACK, XXX markers left in CLAUDE.md. These are task reminders, not instructions.',
      docUrl: 'https://code.claude.com/docs/en/memory',
    },
  ],

  // ── settings (9) ───────────────────────────────────────────────────
  [
    'settings/sandbox-recommended',
    {
      fixCategory: 'add',
      fixComplexity: 'trivial',
      ruleDescription:
        'Warns when sandbox is not enabled. Without sandbox, deny rules only block built-in tools — Bash can bypass them.',
      docUrl: 'https://code.claude.com/docs/en/settings',
    },
  ],
  [
    'settings/deny-env-files',
    {
      fixCategory: 'add',
      fixComplexity: 'trivial',
      ruleDescription:
        'Warns if .env files are not in deny rules. Prevents Claude from reading secrets.',
      docUrl: 'https://code.claude.com/docs/en/settings',
    },
  ],
  [
    'settings/hook-scripts-exist',
    {
      fixCategory: 'edit',
      fixComplexity: 'simple',
      ruleDescription:
        'Verifies that hook command scripts referenced in settings.json actually exist on disk.',
      docUrl: 'https://code.claude.com/docs/en/hooks',
    },
  ],
  [
    'settings/permission-patterns',
    {
      fixCategory: 'edit',
      fixComplexity: 'simple',
      ruleDescription:
        'Validates permission pattern format (Tool(glob) syntax) and tool names against known tools.',
      docUrl: 'https://code.claude.com/docs/en/settings',
    },
  ],
  [
    'settings/dangerous-allow',
    {
      fixCategory: 'edit',
      fixComplexity: 'simple',
      ruleDescription:
        'Flags overly broad allow patterns like Bash(*) that bypass security boundaries.',
      docUrl: 'https://code.claude.com/docs/en/settings',
    },
  ],
  [
    'settings/unknown-fields',
    {
      fixCategory: 'edit',
      fixComplexity: 'trivial',
      ruleDescription:
        'Flags unknown top-level keys in settings.json that are likely typos or unsupported fields.',
      docUrl: 'https://code.claude.com/docs/en/settings',
    },
  ],
  [
    'settings/deny-sensitive-paths',
    {
      fixCategory: 'add',
      fixComplexity: 'trivial',
      ruleDescription:
        'Recommends deny rules for sensitive credential file patterns (.env, secrets/, credentials).',
      docUrl: 'https://code.claude.com/docs/en/settings',
    },
  ],
  [
    'settings/redundant-permissions',
    {
      fixCategory: 'remove',
      fixComplexity: 'trivial',
      ruleDescription:
        'Flags permission patterns already covered by a broader pattern. Reduces config noise.',
      docUrl: 'https://code.claude.com/docs/en/settings',
    },
  ],
  [
    'settings/allow-deny-conflict',
    {
      fixCategory: 'edit',
      fixComplexity: 'simple',
      ruleDescription:
        'Flags the same or overlapping patterns in both allow and deny within a single settings file.',
      docUrl: 'https://code.claude.com/docs/en/settings',
    },
  ],

  // ── cross-level (4) ────────────────────────────────────────────────
  [
    'cross-level/permission-conflicts',
    {
      fixCategory: 'review',
      fixComplexity: 'moderate',
      ruleDescription:
        'Detects contradictory permission rules across settings levels (allow at one, deny at another).',
      docUrl: 'https://code.claude.com/docs/en/settings',
    },
  ],
  [
    'cross-level/env-shadows',
    {
      fixCategory: 'review',
      fixComplexity: 'simple',
      ruleDescription:
        'Detects environment variables set at multiple levels where a higher-precedence level shadows a lower one.',
      docUrl: 'https://code.claude.com/docs/en/settings',
    },
  ],
  [
    'cross-level/mcp-conflicts',
    {
      fixCategory: 'review',
      fixComplexity: 'moderate',
      ruleDescription:
        'Detects MCP server conflicts across settings levels (enabled at one, disabled at another).',
      docUrl: 'https://code.claude.com/docs/en/mcp',
    },
  ],
  [
    'cross-level/plugin-conflicts',
    {
      fixCategory: 'review',
      fixComplexity: 'simple',
      ruleDescription:
        'Detects plugin enable/disable conflicts across settings scopes.',
      docUrl: 'https://code.claude.com/docs/en/settings',
    },
  ],

  // ── rules-dir (7) ──────────────────────────────────────────────────
  [
    'rules-dir/dead-globs',
    {
      fixCategory: 'remove',
      fixComplexity: 'trivial',
      ruleDescription:
        'Detects rule files with path globs that match no files in the project. Dead rules waste context tokens.',
      docUrl: 'https://code.claude.com/docs/en/rules',
    },
  ],
  [
    'rules-dir/overlapping-rules',
    {
      fixCategory: 'review',
      fixComplexity: 'moderate',
      ruleDescription:
        'Detects rules with significantly overlapping file scopes that may produce conflicting instructions.',
      docUrl: 'https://code.claude.com/docs/en/rules',
    },
  ],
  [
    'rules-dir/frontmatter-valid',
    {
      fixCategory: 'edit',
      fixComplexity: 'trivial',
      ruleDescription:
        'Validates YAML frontmatter syntax and required fields (paths array) in rule files.',
      docUrl: 'https://code.claude.com/docs/en/rules',
    },
  ],
  [
    'rules-dir/empty-rule-file',
    {
      fixCategory: 'remove',
      fixComplexity: 'trivial',
      ruleDescription:
        'Flags rule files with no meaningful content (empty or frontmatter-only). These waste a file slot without providing instructions.',
      docUrl: 'https://code.claude.com/docs/en/rules',
    },
  ],
  [
    'rules-dir/large-rule-file',
    {
      fixCategory: 'restructure',
      fixComplexity: 'moderate',
      ruleDescription:
        'Flags rule files exceeding token thresholds. Oversized rules consume excessive context window budget.',
      docUrl: 'https://code.claude.com/docs/en/rules',
    },
  ],
  [
    'rules-dir/contradiction-keywords',
    {
      fixCategory: 'review',
      fixComplexity: 'moderate',
      ruleDescription:
        'Detects rule files with contradictory instructions via keyword heuristic (e.g., "always use X" vs "never use X").',
      docUrl: 'https://code.claude.com/docs/en/rules',
    },
  ],
  [
    'rules-dir/overly-broad-glob',
    {
      fixCategory: 'edit',
      fixComplexity: 'trivial',
      ruleDescription:
        'Flags rules with paths: ["**"] which matches all files. Use an unconditional rule (no paths) instead.',
      docUrl: 'https://code.claude.com/docs/en/rules',
    },
  ],

  // ── agents (5) ────────────────────────────────────────────────────
  [
    'agents/frontmatter-present',
    {
      fixCategory: 'add',
      fixComplexity: 'simple',
      ruleDescription:
        'Checks that agent definition files have YAML frontmatter. Without it, Claude Code cannot parse agent metadata.',
      docUrl: 'https://code.claude.com/docs/en/agents',
    },
  ],
  [
    'agents/frontmatter-valid',
    {
      fixCategory: 'edit',
      fixComplexity: 'simple',
      ruleDescription:
        'Validates agent frontmatter fields against the 14 known fields. Flags unknown fields and the common allowedTools mistake.',
      docUrl: 'https://code.claude.com/docs/en/agents',
    },
  ],
  [
    'agents/skill-reference-valid',
    {
      fixCategory: 'edit',
      fixComplexity: 'simple',
      ruleDescription:
        'Checks that agent frontmatter skills references point to skills that actually exist in .claude/skills/.',
      docUrl: 'https://code.claude.com/docs/en/agents',
    },
  ],
  [
    'agents/description-overlap',
    {
      fixCategory: 'edit',
      fixComplexity: 'moderate',
      ruleDescription:
        'Detects agents with confusingly similar descriptions that may cause ambiguous delegation routing.',
      docUrl: 'https://code.claude.com/docs/en/agents',
    },
  ],
  [
    'agents/orphan-agent',
    {
      fixCategory: 'review',
      fixComplexity: 'simple',
      ruleDescription:
        'Flags agent files never referenced by any skill, command, or other config component.',
      docUrl: 'https://code.claude.com/docs/en/agents',
    },
  ],

  // ── skills (9) ────────────────────────────────────────────────────
  [
    'skills/frontmatter-present',
    {
      fixCategory: 'add',
      fixComplexity: 'simple',
      ruleDescription:
        'Checks that SKILL.md files have YAML frontmatter. Without it, the skill lacks metadata for discovery and invocation.',
      docUrl: 'https://code.claude.com/docs/en/skills',
    },
  ],
  [
    'skills/frontmatter-valid',
    {
      fixCategory: 'edit',
      fixComplexity: 'simple',
      ruleDescription:
        'Validates SKILL.md frontmatter fields against known fields. Flags unknown fields (softened for symlinked third-party skills).',
      docUrl: 'https://code.claude.com/docs/en/skills',
    },
  ],
  [
    'skills/agent-reference-valid',
    {
      fixCategory: 'edit',
      fixComplexity: 'simple',
      ruleDescription:
        'Checks that skill body text references to agents point to agents that actually exist in .claude/agents/.',
      docUrl: 'https://code.claude.com/docs/en/skills',
    },
  ],
  [
    'skills/orphan-skill',
    {
      fixCategory: 'review',
      fixComplexity: 'simple',
      ruleDescription:
        'Flags skills with user-invocable: false that are not referenced by any agent. These are invisible and unreachable.',
      docUrl: 'https://code.claude.com/docs/en/skills',
    },
  ],
  [
    'skills/symlink-detected',
    {
      fixCategory: 'review',
      fixComplexity: 'trivial',
      ruleDescription:
        'Detects skills installed via symlink (e.g., skills.sh). Edits affect all projects sharing the symlink.',
      docUrl: 'https://code.claude.com/docs/en/skills',
    },
  ],
  [
    'skills/user-invokable-typo',
    {
      fixCategory: 'rename',
      fixComplexity: 'trivial',
      ruleDescription:
        'Detects "user-invokable" (with k) typo from VS Code schema. Silently ignored by CLI — use "user-invocable" instead.',
      docUrl: 'https://code.claude.com/docs/en/skills',
    },
  ],
  [
    'skills/too-large',
    {
      fixCategory: 'restructure',
      fixComplexity: 'moderate',
      ruleDescription:
        'Flags SKILL.md files exceeding recommended line limits (500 warn, 1000 error). Use supporting files for progressive disclosure.',
      docUrl: 'https://code.claude.com/docs/en/skills',
    },
  ],
  [
    'skills/name-mismatch',
    {
      fixCategory: 'rename',
      fixComplexity: 'simple',
      ruleDescription:
        'Flags when the frontmatter name field differs from the skill directory name. The slash command derives from name, not the directory.',
      docUrl: 'https://code.claude.com/docs/en/skills',
    },
  ],
  [
    'skills/description-vague',
    {
      fixCategory: 'edit',
      fixComplexity: 'simple',
      ruleDescription:
        'Flags skills with missing, very short, or generic descriptions. Description is the primary auto-invocation trigger.',
      docUrl: 'https://code.claude.com/docs/en/skills',
    },
  ],

  // ── commands (2) ──────────────────────────────────────────────────
  [
    'commands/frontmatter-valid',
    {
      fixCategory: 'edit',
      fixComplexity: 'trivial',
      ruleDescription:
        'Validates optional YAML frontmatter fields in command files against the 5 known command fields.',
      docUrl: 'https://code.claude.com/docs/en/commands',
    },
  ],
  [
    'commands/migrate-to-skills',
    {
      fixCategory: 'restructure',
      fixComplexity: 'moderate',
      ruleDescription:
        'Advises migrating legacy .claude/commands/ files to skills. Commands are merged into skills with more reliable discovery.',
      docUrl: 'https://code.claude.com/docs/en/skills',
    },
  ],

  // ── budget (1) ────────────────────────────────────────────────────
  [
    'budget/startup-load',
    {
      fixCategory: 'restructure',
      fixComplexity: 'moderate',
      ruleDescription:
        'Estimates total token consumption of all files loaded at startup. High budgets reduce available context for conversation.',
      docUrl: 'https://code.claude.com/docs/en/memory',
    },
  ],

  // ── mcp (2) ───────────────────────────────────────────────────────
  [
    'mcp/missing-env-vars',
    {
      fixCategory: 'edit',
      fixComplexity: 'simple',
      ruleDescription:
        'Checks MCP server configs for empty or placeholder environment variable values that will cause server startup failures.',
      docUrl: 'https://code.claude.com/docs/en/mcp',
    },
  ],
  [
    'mcp/deprecated-sse-transport',
    {
      fixCategory: 'edit',
      fixComplexity: 'simple',
      ruleDescription:
        'Detects MCP servers using deprecated SSE transport type. Migrate to "http" per the MCP specification.',
      docUrl: 'https://code.claude.com/docs/en/mcp',
    },
  ],

  // ── git (1) ───────────────────────────────────────────────────────
  [
    'git/local-settings-tracked',
    {
      fixCategory: 'edit',
      fixComplexity: 'simple',
      ruleDescription:
        'Warns when local-only files (settings.local.json, CLAUDE.local.md) are tracked in git. These contain personal preferences.',
      docUrl: 'https://code.claude.com/docs/en/settings',
    },
  ],

  // ── plugins (1) ───────────────────────────────────────────────────
  [
    'plugins/reference-valid',
    {
      fixCategory: 'remove',
      fixComplexity: 'trivial',
      ruleDescription:
        'Validates that plugin references in enabledPlugins point to actually installed plugins.',
      docUrl: 'https://code.claude.com/docs/en/settings',
    },
  ],

  // ── naming (1) ────────────────────────────────────────────────────
  [
    'naming/filename-casing',
    {
      fixCategory: 'rename',
      fixComplexity: 'trivial',
      ruleDescription:
        'Flags config files with incorrect casing (e.g., Claude.md instead of CLAUDE.md). Claude Code may not recognize miscased files.',
      docUrl: 'https://code.claude.com/docs/en/memory',
    },
  ],

  // ── settings (additional) ────────────────────────────────────────
  [
    'settings/low-transcript-retention',
    {
      fixCategory: 'edit',
      fixComplexity: 'trivial',
      ruleDescription:
        'Warns when cleanupPeriodDays is unset or too low. Short retention limits cci audit and history data.',
      docUrl: 'https://code.claude.com/docs/en/settings',
    },
  ],
]);

export const RULE_METADATA_KEYS: ReadonlyArray<string> = [...RULE_METADATA.keys()];

export function getRuleMetadata(ruleId: string): RuleMetadata | undefined {
  return RULE_METADATA.get(ruleId);
}
