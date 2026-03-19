<div align="center">

# ⚙️ ccinspect

**Claude Code Configuration Inspector**

A CLI tool that inspects, validates, and visualizes Claude Code configurations across all layers (enterprise, user, project-shared, project-local) — and cross-references them against actual runtime behavior.

Scan · Lint · Blame · Audit · History · Diff · Restore · Recover

[![npm](https://img.shields.io/npm/v/ccinspect)](https://www.npmjs.com/package/ccinspect)
[![license](https://img.shields.io/npm/l/ccinspect)](./LICENSE)
[![tests](https://img.shields.io/badge/tests-1500%2B%20passing-brightgreen)]()

<br>
<img src="documentation/assets/demo.gif" alt="ccinspect demo" width="720">

</div>

---

# Goal of the project
Provide Claude Code users with full visibility and confidence that their configuration is correct, conflict-free, efficient, and behaving as intended — like a linter + debugger for your Claude Code setup.

## The problem it solves
Claude Code has a complex, layered configuration system — settings files, CLAUDE.md memory files, rules, agents, skills, commands, MCP servers, hooks, and plugins — spread across multiple locations with precedence-based merging. As projects grow, it becomes hard to:

- Know what's actually in effect after all layers merge
- Spot contradictions between levels (e.g., allow at user level, deny at project level)
- Detect dead config (rules with globs matching nothing, orphan agents)
- Understand token budget impact (how much context is consumed at startup)
- Verify that configuration behaves as intended at runtime

Claude Code uses **30+ config files** across **7+ locations** — and when they conflict, debugging is painful.

**ccinspect** fixes that with next capabilities:

🔍 **Discover** — finds every config file across all scopes and shows sizes, tokens, git status
🧹 **Lint** — runs 51 rules catching security gaps, dead references, conflicts, and bloat
📋 **Evidence** — see exactly which lines triggered each detection
🔗 **Blame** — shows the effective config after all layers merge, with origin tracking and precedence badges
⚖️ **Compare** — diffs configurations across projects side-by-side
🗺️ **Graph** — visualizes config dependency graph with orphan and broken reference detection
🔬 **Audit** — cross-references your config against actual Claude Code runtime behavior
🩺 **Diagnose** — detects write-blindness, ghost agents, orphan confirmations, unused config
💰 **Economics** — token usage, cache efficiency, API-equivalent cost per session
📜 **History** — reconstructs config change timeline from git, transcripts, and disk — zero installation
🔀 **Diff & Restore** — compare any two config versions and roll back with lineage-aware ancestry
🔄 **Recover** — generates a paste-ready recovery prompt from interrupted sessions

> Fully offline. No API keys. No hooks to install. Just point it at a project.

## Quick start

```bash
# Run without installing
npx ccinspect scan
npx ccinspect lint

# Or install globally
npm install -g ccinspect
cci scan
cci lint
```

> **Tip:** `cci` and `ccinspect` are interchangeable — use whichever you prefer.

## What it catches

```
$ cci lint

Settings (3 issues)
  ⚠ [settings/sandbox-recommended]     Sandbox is not enabled
  ⚠ [settings/deny-env-files]          Missing deny rules for .env files

Rules (3 issues)
  ⚠ [rules-dir/contradiction-keywords] Potential contradiction between rules
    │ architecture.md:100  "server components by default"
    │ frontend.md:46       "separate server components from client components"

Agents (2 issues)
  ✖ [agents/frontmatter-valid]         Missing required name field
  ℹ [agents/orphan-agent]              3 agents never referenced

Git (1 issue)
  ⚠ [git/local-settings-tracked]       settings.local.json tracked in git
```

```
$ cci audit

Agents     3 configured · 1 delegated · 2 never delegated
  ✓ test-runner     1 delegation across 1 session
  ○ nlp-reviewer    0 delegations (44 sessions searched)

MCP Servers   1 configured · 3 used
  ✓ taskmaster-ai   1 tool call
  ? deepwiki        2 tool calls (not in current config)

Discrepancies
  ℹ Agent "test-runner" bypassed in 9 of 10 matching sessions
    Matched commands: pytest
    → Add "MUST BE USED" to agent description
```

> Static lint catches config mistakes. Runtime audit catches config that doesn't work in practice.

## Runtime analysis

```bash
# What config was actually used? Any issues?
cci audit

# Session statistics and token costs
cci logs stats
cci logs stats --cost

# Recover from an interrupted session
cci session-recover
```

> Fully offline. Reads Claude Code's existing session data. No hooks to install.

## Config versioning

```bash
# See full config change history (from git, transcripts, and disk)
cci history CLAUDE.md

# Compare any two versions
cci diff v3 v8 CLAUDE.md

# Compare a version to current disk state
cci diff v5 current .claude/settings.json

# Roll back to a previous version
cci restore v3 CLAUDE.md
```

> Zero installation. Reconstructs history retroactively from git commits and Claude Code session transcripts on first run.

## Which command do I need?

**`cci scan`** — *"What do I have?"* — Discovers every config file across all scopes, shows sizes, token counts, and git status. Flags when a user-level file is shadowed by a project-level equivalent. Doesn't look inside files — just the inventory.

**`cci lint`** — *"What's wrong?"* — Runs 51 rules checking for dead globs, contradictions, dangerous permissions, oversized files, stale imports, and more. The quality gate.

**`cci blame`** — *"What's actually in effect?"* — After all layers merge, shows which permissions apply, which env vars win, which MCP servers are active — and which file is responsible. The answer to "I set X but it's not working."

**`cci graph`** — *"How do things connect?"* — Which agents reference which skills, which rules apply to which paths, what imports what. The dependency map.

**`cci compare`** — *"How do two projects differ?"* — Side-by-side diff of configurations across directories.

**`cci audit`** — *"Is my config actually working at runtime?"* — Cross-references your static configuration against what actually happened in Claude Code sessions. Shows which agents were delegated to, which rules loaded, which MCP servers were called — and which were never used. Detects write-blindness, ghost delegations, and orphan confirmations. The runtime reality check.

**`cci logs stats`** — *"What does my Claude Code usage look like?"* — Session statistics: tool distribution, file activity, delegations, token usage. Add `--cost` for API-equivalent pricing breakdown with cache efficiency analysis.

**`cci session-recover`** — *"My session crashed. What was I doing?"* — Parses the last session to extract the task in progress, files modified, last successful checkpoint, and any errors. Generates a paste-ready recovery prompt to continue in a new session.

**`cci history`** — *"What changed and when?"* — Reconstructs config change history from git commits, Claude Code transcript edits, and disk state. Shows a git-log-style timeline with source badges, lineage tracking, and token counts. Zero installation — full history on first run.

**`cci diff`** — *"What's different between two versions?"* — Colored unified diff between any two config versions, including `current` disk state.

**`cci restore`** — *"Take me back."* — Roll back a config file to any previous version with lineage-aware ancestry. Creates a safety snapshot before writing — nothing is ever lost.

**`cci session-handover`** — *"Bring a new session up to speed."* — Generates a status summary from git diff, test results, and typecheck. Add `--transcript` for task narrative, tool usage, and git correlation from the previous session.

## Commands

| Command | Description |
|---------|-------------|
| `cci scan` | Discover and inventory all config files with sizes, token counts, and git status. Use `--all` to include config locations that don't exist yet |
| `cci lint [target]` | Run 51 rules — pass a directory or a single config file |
| `cci blame` | Show effective config after all layers merge, with origin tracking |
| `cci blame settings` | Show raw settings key-value pairs with source badges |
| `cci compare <dir1> <dir2>` | Compare configurations across projects side-by-side |
| `cci info` | Show runtime info — CLI version, active model, auth method |
| `cci session-handover` | Generate status.md from git diff, test results, and typecheck |
| `cci graph` | Visualize config dependency graph — text, mermaid, HTML, or JSON output |
| `cci audit` | Config utilization audit — which config was actually used at runtime |
| `cci logs stats [--cost]` | Session statistics and token economics from transcript data |
| `cci history [path]` | Show config version timeline — git-log style with source badges and lineage |
| `cci diff <v1> <v2> [path]` | Compare two config versions with colored unified diff |
| `cci restore <version> [path]` | Roll back config to a previous version with safety snapshot |
| `cci session-recover` | Generate a recovery prompt from the last interrupted session |

> **Scan output:** When a user-global agent, skill, or command is shadowed by a project-level equivalent of the same name, `cci scan` dims the entry and marks it `(inactive)` — so you can see why a global config isn't taking effect.

### Single-file mode

Lint individual config files without scanning an entire project:

```bash
cci lint CLAUDE.md
cci lint .claude/settings.json
cci lint .claude/agents/researcher.md
```

The file is auto-classified by name and path. Only rules relevant to that file type run — cross-file and project-level rules are skipped. Output shows the detected type:

```
⚡ Single-file mode: researcher.md (agent)
  Cross-file and project-level rules skipped
```

Detected types: `memory` (CLAUDE.md), `settings` (settings.json), `MCP` (.mcp.json), `rule` (rules/*.md), `agent` (agents/*.md), `skill` (SKILL.md), `command` (commands/*.md)

## What does `cci audit` find?

`cci audit` reads Claude Code's session data to answer questions your static config can't. No API keys, no hooks — fully offline.

**Are my agents being used?**
> Agent `researcher` had 8 delegations across 5 sessions. Agent `smith` had 0 delegations in 135 sessions — safe to remove.

**Are my rules actually loading?**
> Rule `testing.md` was loaded in 92/148 sessions. But in 3 sessions, matching files were Edited without being Read first — the rule never loaded.

This is **write-blindness**: path-scoped rules only load when Claude Reads a matching file. If Claude Edits the file directly, your rule instructions aren't in context. ccinspect is the only tool that detects this.

**Which MCP servers are in use?**
> MCP server `github` had 34 tool calls. Server `filesystem` is configured but was never called. Server `taskmaster-ai` was used at runtime but is not in your current config.

**What about Agent Teams?**
> 14 ephemeral agents created via Agent Teams across 3 sessions — shown as an informational summary, not false warnings.

**Which files get the most attention?**
> High-churn files, read-only references, files edited without reading, and test correlation — what percentage of edited source files had corresponding test activity.

**How much does it cost?**
> `cci logs stats --cost` shows API-equivalent token costs with cache breakdown, startup context analysis, and per-model pricing. Subscription plan users see a note that they're not billed per-token.

## Common flags

```
--project-dir <path>   Target a different project directory
--format json|md       Machine-readable output (default: terminal)
--exclude <glob>       Skip paths from scan/lint
--all                  Show all possible config locations, including files that don't exist yet
-v, --verbose          Expanded output with all issues and full evidence
```

## Rule categories

| Category | Rules | What it checks |
|----------|-------|----------------|
| `memory` | 9 | CLAUDE.md quality — size, token budget, imports, sections, stale refs, TODOs |
| `settings` | 9 | Permission security, dangerous allows, field validation, sandbox config |
| `cross-level` | 4 | Conflicts across config layers — permissions, env vars, MCP, plugins |
| `rules-dir` | 7 | Rule file quality — dead globs, overlaps, frontmatter, contradictions, empty/large files, overly-broad globs |
| `agents` | 5 | Agent frontmatter, skill references, description overlap, orphan detection |
| `skills` | 9 | Skill frontmatter, agent references, orphan detection, symlinks, typos, size, naming, descriptions |
| `commands` | 2 | Command frontmatter validity, migration advisory to skills |
| `budget` | 1 | Startup token budget estimation |
| `mcp` | 2 | MCP server environment variable validation, deprecated SSE transport |
| `git` | 1 | Local-only files accidentally tracked in git |
| `plugins` | 1 | Plugin references point to installed plugins |
| `naming` | 1 | Config file casing — detects files Claude Code won't recognize |

## Configuration

### Excluding paths

Create a `.ccinspectignore` file in your project root (same syntax as `.gitignore`):

```
node_modules/
dist/
vendor/
```

Or use the `--exclude` CLI flag:

```bash
cci lint --exclude "vendor/**"
```

### Advanced config

ccinspect supports `.ccinspect.json` for rule enable/disable, severity overrides, and threshold tuning. See [documentation/configuration.md](documentation/configuration.md) for the full schema.

## What it scans

ccinspect discovers and analyzes these Claude Code configuration surfaces:

- **Settings** — `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`, managed policies
- **Memory** — `CLAUDE.md` at enterprise, global, project, local, and subdirectory levels; `MEMORY.md` auto-memory
- **Rules** — `.claude/rules/*.md` (project) and `~/.claude/rules/*.md` (user-global)
- **Agents** — `.claude/agents/*.md` and `~/.claude/agents/*.md`
- **Skills** — `.claude/skills/**/SKILL.md` (project) and `~/.claude/skills/**/SKILL.md` (user-global)
- **Commands** — `.claude/commands/*.md` and `~/.claude/commands/*.md`
- **MCP** — `.mcp.json` and managed MCP configs
- **Hooks** — Hook definitions in settings files
- **Plugins** — Plugin enable/disable across scopes
- **Transcripts** — `~/.claude/projects/<project>/` JSONL session files (for `cci audit`, `cci logs stats`, `cci session-recover`)

## Development

```bash
git clone https://github.com/fedius01/ccinspect.git
cd ccinspect
npm install
npm run test
npm run dev -- scan
```

### Project structure

```
src/
  cli/        CLI entry point and commands
  core/       Scanner, resolver, linter, transcript analyzer engines
  parsers/    Typed parsers for each config format, including JSONL transcripts
  rules/      Individual lint rules by category
  types/      Shared TypeScript interfaces
  utils/      Token counting, git helpers, OS paths, transcript discovery
tests/        Vitest test suite (1500+ tests)
documentation/         Configuration
```

## License

[MIT](LICENSE)
