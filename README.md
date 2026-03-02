<div align="center">

# ⚙️ ccinspect

**Claude Code Configuration Inspector**

A CLI tool that inspects, validates, and visualizes Claude Code configurations across all layers (enterprise, user, project-shared, project-local).

Scan · Lint · Resolve · Compare

[![npm](https://img.shields.io/npm/v/ccinspect)](https://www.npmjs.com/package/ccinspect)
[![license](https://img.shields.io/npm/l/ccinspect)](./LICENSE)
[![tests](https://img.shields.io/badge/tests-538%20passing-brightgreen)]()

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
🧹 **Lint** — runs 42 rules catching security gaps, dead references, conflicts, and bloat
📋 **Evidence** — see exactly which lines triggered each detection
🔗 **Resolve** — shows the effective config after all layers merge, with origin tracking
⚖️ **Compare** — diffs configurations across projects side-by-side  

> Fully offline. No API keys. Just point it at a project.

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

## Commands

| Command | Description |
|---------|-------------|
| `cci scan` | Discover and inventory all config files with sizes, token counts, and git status |
| `cci lint` | Run 42 rules across 11 categories to find issues |
| `cci resolve` | Show effective config after all layers merge, with origin tracking |
| `cci compare <dir1> <dir2>` | Compare configurations across projects side-by-side |
| `cci info` | Show runtime info — CLI version, active model, auth method |
| `cci session-handover` | Generate status.md from git diff, test results, and typecheck |

## Common flags

```
--project-dir <path>   Target a different project directory
--format json|md       Machine-readable output (default: terminal)
--exclude <glob>       Skip paths from scan/lint
```

## Rule categories

| Category | Rules | What it checks |
|----------|-------|----------------|
| `memory` | 9 | CLAUDE.md quality — size, token budget, imports, sections, stale refs, TODOs |
| `settings` | 9 | Permission security, dangerous allows, field validation, sandbox config |
| `cross-level` | 4 | Conflicts across config layers — permissions, env vars, MCP, plugins |
| `rules-dir` | 6 | Rule file quality — dead globs, overlaps, frontmatter, contradictions, empty/large files |
| `agents` | 5 | Agent frontmatter, skill references, description overlap, orphan detection |
| `skills` | 4 | Skill frontmatter, agent references, orphan detection |
| `commands` | 1 | Command definition frontmatter validity |
| `budget` | 1 | Startup token budget estimation |
| `mcp` | 1 | MCP server environment variable validation |
| `git` | 1 | Local-only files accidentally tracked in git |
| `plugins` | 1 | Plugin references point to installed plugins |

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
- **Memory** — `CLAUDE.md` at global, project, local, and subdirectory levels; `MEMORY.md` auto-memory
- **Rules** — `.claude/rules/*.md` with YAML frontmatter and path globs
- **Agents** — `.claude/agents/*.md` and `~/.claude/agents/*.md`
- **Skills** — `.claude/skills/*/SKILL.md`
- **Commands** — `.claude/commands/*.md` and `~/.claude/commands/*.md`
- **MCP** — `.mcp.json` and managed MCP configs
- **Hooks** — Hook definitions in settings files
- **Plugins** — Plugin enable/disable across scopes

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
  core/       Scanner, resolver, linter engines
  parsers/    Typed parsers for each config format
  rules/      Individual lint rules by category
  types/      Shared TypeScript interfaces
  utils/      Token counting, git helpers, OS paths
tests/        Vitest test suite (538 tests)
documentation/         Configuration
```

## License

[MIT](LICENSE)