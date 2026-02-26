<div align="center">

# ⚙️ ccinspect

**Claude Code Configuration Inspector**

Scan · Lint · Resolve · Compare

[![npm](https://img.shields.io/npm/v/ccinspect)](https://www.npmjs.com/package/ccinspect)
[![license](https://img.shields.io/npm/l/ccinspect)](./LICENSE)
[![tests](https://img.shields.io/badge/tests-325%20passing-brightgreen)]()

</div>

---

Claude Code uses **30+ config files** across **7+ locations** — and when they conflict, debugging is painful.

**ccinspect** fixes that in one command:

🔍 **Discover** — finds every config file across all scopes and shows sizes, tokens, git status  
🧹 **Lint** — runs 35 rules catching security gaps, dead references, conflicts, and bloat  
🔗 **Resolve** — shows the effective config after all layers merge, with origin tracking  
⚖️ **Compare** — diffs configurations across projects side-by-side  

> Fully offline. No API keys. Just point it at a project.

## Quick start

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
| `cci lint` | Run 35 rules across 10 categories to find issues |
| `cci resolve` | Show effective config after all layers merge, with origin tracking |
| `cci compare <dir1> <dir2>` | Compare configurations across projects side-by-side |
| `cci info` | Show runtime info — CLI version, active model, auth method |

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
| `rules-dir` | 5 | Rule file quality — dead globs, overlaps, frontmatter, empty/large files |
| `agents` | 2 | Agent definition frontmatter presence and validity |
| `skills` | 2 | Skill definition frontmatter presence and validity |
| `commands` | 1 | Command definition frontmatter validity |
| `budget` | 1 | Startup token budget estimation |
| `mcp` | 1 | MCP server environment variable validation |
| `git` | 1 | Local-only files accidentally tracked in git |

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
- **Skills** — `.claude/commands/*.md` and `~/.claude/commands/*.md`
- **MCP** — `.mcp.json` and managed MCP configs
- **Hooks** — Hook definitions in settings files
- **Plugins** — Plugin enable/disable across scopes

## Development

```bash
git clone https://github.com/YOURUSER/ccinspect.git
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
tests/        Vitest test suite (325 tests)
documentation/    Configuration    
```

## License

[MIT](LICENSE)
