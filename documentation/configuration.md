# Configuration Specification

## Overview

ccinspect behavior is configured via `.ccinspect.json` files. This follows the same
hierarchical pattern as Claude Code itself:

1. **Project config:** `.ccinspect.json` in project root (git-tracked, shared with team)
2. **User config:** `~/.ccinspect.json` (personal defaults across all projects)

Project config overrides user config. Within each file, more specific settings
override less specific ones.

## Implementation Priority

- **Phase 2:** Rule enable/disable and severity overrides only (minimal viable config)
- **Phase 3+:** Full config including dashboard, community repos, output defaults

## Schema

```json
{
  "rules": {
    "memory/line-count": { "enabled": true, "severity": "warning", "warn": 150, "error": 300 },
    "memory/token-budget": { "enabled": true, "severity": "warning", "warn": 1800, "error": 4500 },
    "memory/generic-instructions": {
      "enabled": true,
      "severity": "info",
      "extraPatterns": ["follow company guidelines"],
      "ignorePatterns": ["follow SOLID principles"]
    },
    "memory/missing-sections": {
      "enabled": true,
      "severity": "warning",
      "required": ["overview", "commands"]
    },
    "memory/import-depth": { "enabled": true },
    "memory/auto-memory-size": { "enabled": true },
    "settings/sandbox-recommended": { "enabled": true, "severity": "warning" },
    "settings/deny-env-files": {
      "enabled": true,
      "severity": "warning",
      "patterns": [".env", ".env.*", "secrets/**"]
    },
    "settings/hook-scripts-exist": { "enabled": true },
    "settings/permission-patterns": { "enabled": true },
    "rules-dir/dead-globs": { "enabled": true },
    "rules-dir/overlapping-rules": { "enabled": true, "threshold": 0.8 },
    "rules-dir/frontmatter-valid": { "enabled": true },
    "agents/frontmatter-present": { "enabled": true },
    "agents/frontmatter-valid": { "enabled": true },
    "skills/frontmatter-present": { "enabled": true },
    "skills/frontmatter-valid": { "enabled": true },
    "commands/frontmatter-valid": { "enabled": true },
    "cross-level/permission-conflicts": { "enabled": true },
    "cross-level/env-shadows": { "enabled": true },
    "cross-level/mcp-conflicts": { "enabled": true },
    "cross-level/plugin-conflicts": { "enabled": true },
    "budget/startup-load": { "enabled": true, "warn": 5000, "error": 10000 },
    "coherence/broken-imports": { "enabled": true },
    "coherence/broken-doc-refs": { "enabled": true },
    "coherence/mcp-command-exists": { "enabled": true },
    "coherence/plugin-marketplace-exists": { "enabled": true },
    "coherence/agent-tools-valid": { "enabled": true },
    "coherence/stale-rule-patterns": { "enabled": true }
  },

  "output": {
    "defaultFormat": "text",
    "colors": true
  },

  "community": {
    "repos": [
      "trailofbits/claude-code-config",
      "shanraisshan/claude-code-best-practice",
      "ChrisWiles/claude-code-showcase"
    ],
    "cacheDir": "~/.ccinspect/community/",
    "refreshInterval": "7d"
  },

  "dashboard": {
    "port": 3847
  },

  "sessionHandover": {
    "testCommand": "npm run test",
    "typecheckCommand": "npx tsc --noEmit",
    "statusFile": "docs/status.md"
  }
}
```

## Configurable vs. Hardcoded

### Configurable per rule

Every lint rule supports these universal options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable or disable the rule entirely |
| `severity` | `"error" \| "warning" \| "info"` | per rule | Override the default severity |

Additionally, rules with thresholds support rule-specific options as documented below.

### Rule-specific options

| Rule | Option | Type | Default | Description |
|------|--------|------|---------|-------------|
| `memory/line-count` | `warn` | number | 150 | Line count warning threshold |
| `memory/line-count` | `error` | number | 300 | Line count error threshold |
| `memory/token-budget` | `warn` | number | 1800 | Token count warning threshold |
| `memory/token-budget` | `error` | number | 4500 | Token count error threshold |
| `memory/generic-instructions` | `extraPatterns` | string[] | `[]` | Additional phrases to flag |
| `memory/generic-instructions` | `ignorePatterns` | string[] | `[]` | Phrases to exclude from detection |
| `memory/missing-sections` | `required` | string[] | `["overview", "commands", "architecture"]` | Which sections to require |
| `settings/deny-env-files` | `patterns` | string[] | `[".env", ".env.*", "secrets/**"]` | Secret file patterns to check |
| `rules-dir/overlapping-rules` | `threshold` | number (0-1) | 0.8 | Minimum overlap ratio to flag |
| `budget/startup-load` | `warn` | number | 5000 | Total startup token warning threshold |
| `budget/startup-load` | `error` | number | 10000 | Total startup token error threshold |

### NOT configurable (platform constraints)

These values are determined by Claude Code itself and must not be overridden:

| Setting | Value | Reason |
|---------|-------|--------|
| Max import depth | 5 | Claude Code hard limit on @import recursion |
| Auto memory loaded lines | 200 | Claude Code loads only first 200 lines of MEMORY.md |
| Token encoding | cl100k_base | Matches Claude model tokenizer |
| Settings precedence order | managed → CLI → local → project → user | Claude Code's documented behavior |
| Permission pattern format | `Tool(glob)` | Claude Code's spec |
| Valid tool names | Bash, Read, Edit, Write, WebFetch, etc. | Claude Code's tool set |

## Shorthand Syntax

For convenience, rules can be configured with shorthand:

```json
{
  "rules": {
    "memory/line-count": true,
    "settings/sandbox-recommended": false,
    "rules-dir/overlapping-rules": { "threshold": 0.6 }
  }
}
```

- `true` = enabled with all defaults
- `false` = disabled
- Object = enabled with specified overrides (unspecified options keep defaults)
- Omitted = enabled with all defaults (all rules on by default)

## Config Loading

1. Check for `.ccinspect.json` in project root
2. Check for `~/.ccinspect.json` in home directory
3. Deep merge: project overrides user
4. Apply defaults for any omitted rules/options

The linter engine (`src/core/linter.ts`) already has a `LintConfig` type — extend it
to support this full schema. The config loader should be a new utility:
`src/utils/config.ts`.

## CLI Overrides

CLI flags override config file values for the current run:

```bash
# Disable a specific rule for this run
ccinspect lint --disable memory/generic-instructions

# Override severity
ccinspect lint --severity memory/line-count=error

# Set threshold
ccinspect lint --set rules-dir/overlapping-rules.threshold=0.6
```

CLI override implementation is Phase 4 (nice-to-have). Phase 2 only needs
config file loading.