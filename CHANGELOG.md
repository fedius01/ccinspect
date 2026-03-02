# Changelog

## [0.3.0] — 2026-03-02

### Added
- **Evidence output** on 17 lint rules — issues now include file path, line number, and content excerpt showing what triggered the rule
- **`cci graph` command** — visualize configuration dependencies as Mermaid diagrams, interactive HTML, text trees, or JSON
- **Precision/recall corpus** for `contradiction-keywords` rule — 30 labeled fixtures with eval runner (`npm run eval:contradiction`)
- **Dogfood infrastructure** — versioned lint results in `dogfood/` for cross-release comparison
- **Redundant permissions grouping** — large groups of redundant permissions collapsed into single grouped issue with sample evidence
- **Frontmatter `skills` validation** in `agents/skill-reference-valid` — explicit skill references in agent frontmatter are now checked

### Changed
- **Settings allowlist** updated to 52 fields from official Claude Code JSON schema (was 26 manually curated)
- **Agent frontmatter** allowlist: 8 fields from official docs (added `permissionMode`, `skills`, `memory`, `color`)
- **Command frontmatter** allowlist: 5 fields from official docs (added `allowed-tools`, `argument-hint`, `model`, `disable-model-invocation`)
- **Skill frontmatter** allowlist: 8 fields from official docs (added `allowed-tools`, `version`, `mode`, `disable-model-invocation`, `user-invokable`)
- **`settings/unknown-fields`** now only lints project-scoped settings files (`.claude/settings.json`, `.claude/settings.local.json`). User global and enterprise managed settings are client-managed and no longer checked for unknown fields.
- **`memory/todo-fixme`** now case-sensitive — only matches uppercase markers (TODO, FIXME, HACK, XXX, TEMP, PLACEHOLDER). Lowercase "todo" in prose no longer triggers.
- **`agents/skill-reference-valid`** body text extraction now only flags hyphenated names (e.g., `code-reviewer`). Single-word names from prose no longer flagged.
- **`contradiction-keywords`** overhauled: segment-based glob comparison, TOOL_CATEGORIES for semantic tool pairs, removed must/must-not pairs
- **Skill scanner** now discovers nested skill directories recursively via `fast-glob` (`**/SKILL.md`)

### Fixed
- 5 rules had `.includes()` substring matching bugs — replaced with word-boundary regex (e.g., "refuse tabs" no longer matches "use tabs")
- Agent frontmatter no longer flags `allowedTools` (not an official field — agents use `tools`)
- Nested skills (e.g., `.claude/skills/category/name/SKILL.md`) now discovered by the scanner

### Metrics
- 538 tests across 56 files (was 390/51)
- 42 lint rules, 17 with evidence output
- Precision: 93.8%, Recall: 100%, F1: 96.8% (contradiction-keywords)
- 5-target dogfood: 0 crashes, 126 issues detected

## [0.2.0] — 2026-02-28

### Added
- **`cci session-handover` command** — auto-generates `docs/status.md` from git diff, test results, and typecheck status
- **7 new lint rules** (35 → 42 total), new `plugins` category:
  - `agents/skill-reference-valid` — agent frontmatter references a skill that exists
  - `agents/description-overlap` — agents with confusingly similar descriptions
  - `agents/orphan-agent` — agent never referenced by any skill, command, or test
  - `skills/agent-reference-valid` — skill references an agent that exists
  - `skills/orphan-skill` — skill with `disable-model-invocation` not referenced by any agent
  - `rules-dir/contradiction-keywords` — rules with contradictory keywords
  - `plugins/reference-valid` — plugin references point to installed plugins
- **Cross-reference test fixtures** for agent↔skill validation

### Changed
- **Terminal output** completely overhauled — dynamic column alignment, ANSI-aware padding, section-based inventory grouping
- **CLI version** now read dynamically from `package.json` (no longer hardcoded)
- **ESLint** migrated to flat config (`eslint.config.js`)
- **Knip** added for dead code detection

### Fixed
- Terminal output columns now align correctly regardless of content width
- CLI version displays correctly in both dev mode (`tsx`) and built mode

### Metrics
- 390 tests across 51 files (was 325/42)
- 42 lint rules across 11 categories (was 35/10)
- 6 CLI commands (added session-handover)

## [0.1.0] - 2026-02-26

### Added
- Initial release
- 5 CLI commands: scan, lint, resolve, compare, info
- 35 lint rules across 10 categories (memory, settings, cross-level, rules-dir, agents, skills, commands, budget, mcp, git)
- 3 output formats: terminal (colored), JSON, Markdown
- Path exclusion system: built-in defaults, .ccinspectignore, --exclude CLI flag
- MCP permission pattern support (mcp__server__tool format)
- Multi-project comparison
- Effective configuration resolution with origin tracking
