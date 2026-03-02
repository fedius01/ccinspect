# Dogfood Results — v0.3.0

**Date**: 2026-03-01
**Targets**: 5 projects (all ran successfully, 0 crashes)
**ccinspect version**: 0.3.0 (pre-release)
**CLI invocation**: `npx tsx src/cli/index.ts lint --format json -p <path>`

## Aggregate Results

| Project | Errors | Warnings | Info | Total | Files | Duration |
|---------|--------|----------|------|-------|-------|----------|
| ccinspect (self) | 0 | 1 | 5 | 6 | 8 | 92ms |
| learnabi | 0 | 6 | 9 | 15 | 8 | 380ms |
| trailofbits | 0 | 2 | 5 | 7 | 2 | 29ms |
| shanraisshan | 4 | 19 | 72 | 95 | 10 | 28ms |
| chriswiles | 0 | 5 | 14 | 19 | 19 | 45ms |
| **Totals** | **4** | **33** | **105** | **142** | — | — |

All 42 rules ran against all 5 targets. No crashes, no unhandled exceptions.

---

## Regression Check

### Word Boundary Changes
- [x] No rules that previously fired are now silent on these targets
- [x] `generic-instructions` — no issues fired on any target (no generic phrases detected); cannot verify regression without a target known to have them
- [x] `deny-env-files` — correctly fires on learnabi and trailofbits (both lack env deny rules)
- [x] `missing-env-vars` — no MCP env var issues on these targets; cannot verify regression
- **One FP from word-boundary precision**: `memory/todo-fixme` on shanraisshan CLAUDE.md line 96 matches "todo" in the phrase "Use human-gated todo list workflow for multi-step tasks" — this is instructional text about task management, not a TODO marker. The rule uses case-insensitive matching and doesn't distinguish "TODO:" markers from the English word "todo".

### Contradiction Rule
- [x] TOOL_CATEGORIES pairs produce sensible results — only 1 contradiction detected across all 5 targets
- [x] Segment-based globs correctly filter non-overlapping scopes — learnabi has backend/frontend rules that are NOT flagged as contradictions (correct)
- [x] No must/must-not false positives (pairs removed in v0.3.0)
- **1 contradiction detected (learnabi)**: `architecture.md` vs `frontend.md` — "rendering-model" category. Architecture says "server components by default; 'use client' only when needed", frontend says "clearly separate server components from client components". Both files are actually **aligned** (both advocate server-first). This is a **borderline FP** — the keyword pair `['server components', 'client components']` fires because both terms appear in different files, but the files don't actually contradict. The message says "Potential contradiction" which is fair as an advisory.

### Evidence Quality
- [x] Evidence adds actionable context across all rules that produce it
- [x] Content is properly truncated (no wall-of-text in any output)
- [x] Line numbers are accurate where provided
- [x] File paths are correct

**Evidence quality by rule:**
- `rules-dir/overlapping-rules` (learnabi) — **Good.** Shows both rule file paths, matched file counts, and sample shared files. Truncation with "...and 162 more shared files" is helpful.
- `rules-dir/contradiction-keywords` (learnabi) — **Excellent.** Shows the specific lines from both files that triggered the match, with line numbers. Enables quick human review.
- `settings/unknown-fields` (shanraisshan, chriswiles) — **Good.** Shows the actual field value: `"includeCoAuthoredBy": true`, `"spinnerVerbs": { mode, verbs } (2 keys)`.
- `settings/redundant-permissions` (shanraisshan) — **Good.** Shows which pattern is redundant and which broader pattern already covers it.
- `agents/skill-reference-valid` (shanraisshan) — **Good formatting, but FP issues** (see below).
- `agents/orphan-agent` (chriswiles) — **Good.** Shows search scope: "Searched 2 agents, 6 skills, 1 CLAUDE.md files, 6 commands — no references found".

---

## Per-Project Analysis

### ccinspect (self)
- **Issues**: 0 errors, 1 warning, 5 infos
- **Expected**: sandbox-recommended warning (we don't use sandbox)
- **Expected**: deny-sensitive-paths infos (SSH, AWS, GCloud, gitignore, npmrc)
- **No unexpected issues.**
- **Evidence**: No evidence-bearing issues fired.
- **Assessment**: Clean. All issues are known baseline.

### learnabi
- **Issues**: 0 errors, 6 warnings, 9 infos
- **By category**: settings (7), rules (6), git (1), memory (1)
- **Notable findings**:
  - `rules-dir/overlapping-rules`: architecture.md (167 files) and tools-and-plugins.md (19,858 files) have 100% overlap — correct, tools-and-plugins is a superset
  - `rules-dir/frontmatter-valid`: backend.md and frontend.md lack YAML frontmatter — correct
  - `git/local-settings-tracked`: settings.local.json tracked in git — correct
  - `rules-dir/large-rule-file`: 3 rule files flagged (3,390–4,572 tokens) — correct
  - `rules-dir/contradiction-keywords`: architecture vs frontend on rendering-model — **borderline FP** (see Contradiction Rule section)
- **False positives**: 1 borderline (contradiction-keywords rendering-model)
- **Evidence**: Overlapping rules evidence is excellent — shows file counts and sample paths. Contradiction evidence shows exact lines from both files.

### trailofbits/claude-code-config
- **Issues**: 0 errors, 2 warnings, 5 infos
- **By category**: settings (7)
- **Notable**: This is a security-focused config. Has settings.json with permissions but lacks env file deny rules and sandbox. No rules/, agents/, skills/, or commands/ directories.
- **False positives**: None detected. All findings are legitimate best-practice suggestions.
- **Assessment**: Clean output. Only settings-level advisories.

### shanraisshan/claude-code-best-practice
- **Issues**: 4 errors, 19 warnings, 72 infos (highest issue count)
- **By category**: settings (72), agents (13), memory (2), skills (1), commands (1)
- **Notable findings**:
  - **64 redundant-permissions (info)**: All `mcp__<server>__*` patterns are covered by a blanket `mcp__*` allow. This is a **true finding** — the user added individual MCP permissions and then a blanket one. Real but noisy.
  - **4 errors from `agents/skill-reference-valid`**: ALL are from a nested skill discovery bug (see Bugs section below)
  - **9 `agents/frontmatter-valid` warnings**: Includes FPs from unknown fields `name`, `color`, `skills` which are valid Claude Code agent frontmatter fields
  - **5 `settings/unknown-fields` warnings**: Flags `spinnerVerbs`, `spinnerTipsOverride`, `plansDirectory`, `outputStyle`, `disableAllHooks` — at least some are valid newer Claude Code settings
  - **1 `memory/todo-fixme` info**: FP — matches "todo" in "todo list workflow" instruction (see Word Boundary section)
- **False positives**:
  - 4 errors from nested skill bug (not the rule's fault — scanner bug)
  - 6+ warnings from incomplete field allowlists (agents: `name`, `color`, `skills`; settings: `spinnerVerbs`, etc.)
  - 1 info from todo-fixme word matching

### ChrisWiles/claude-code-showcase
- **Issues**: 0 errors, 5 warnings, 14 infos
- **By category**: settings (8), commands (5), agents (4), memory (2)
- **Notable findings**:
  - `settings/unknown-fields`: Flags `includeCoAuthoredBy` — this IS a valid Claude Code setting. **FP from incomplete allowlist.**
  - `agents/frontmatter-valid`: Flags `name` field as unknown on 2 agents — **FP from incomplete allowlist.**
  - `commands/frontmatter-valid`: Flags `allowed-tools` on 5 commands — **FP from incomplete allowlist.** `allowed-tools` is a valid command frontmatter field.
  - `agents/orphan-agent`: 2 agents not referenced elsewhere — correct (info-level, not a problem)
- **False positives**:
  - 1 warning from settings unknown-fields (`includeCoAuthoredBy`)
  - 2 warnings from agents unknown-fields (`name`)
  - 5 infos from commands unknown-fields (`allowed-tools`)

---

## Bugs Found

### BUG-1: Scanner doesn't discover nested skill directories (severity: high)

**Location**: `src/core/scanner.ts` — `discoverSkillFiles()` (line 97–107)

The function uses `readdirSync(skillsDir).filter(entry => entry.isDirectory()).map(dir => join(skillsDir, dir.name, 'SKILL.md'))`, which only discovers direct children of `.claude/skills/`. Nested structures like `.claude/skills/presentation/presentation-structure/SKILL.md` are invisible.

**Impact**: shanraisshan has 3 skills under `.claude/skills/presentation/` that exist but are not in `inventory.projectSkills`. This causes `agents/skill-reference-valid` to emit 4 error-level false positives (2 from real skills, 2 from partial name matching in body text).

**Fix**: Make `discoverSkillFiles()` recursive, or use a glob like `**/SKILL.md`.

### BUG-2: Body text skill extraction picks up partial names (severity: medium)

**Location**: `src/utils/references.ts` — `findSkillReferences()` / `src/rules/agents/skill-reference-valid.ts`

When agent body text says "the framework skill identity canonical" or "Update the Structure Skill", the pattern `\bthe\s+([\w-]+)\s+skill\b` extracts "framework" and "structure" as skill references. These are natural language shorthand for the actual skills `vibe-to-agentic-framework` and `presentation-structure`.

**Impact**: 2 of the 4 shanraisshan errors are from partial name extraction. Even if nested skills were discovered, "framework" would not match "vibe-to-agentic-framework".

**Fix**: Consider requiring skill references to be explicitly formatted (e.g., backtick-enclosed, or matching known skill name patterns).

---

## False Positive Inventory

### Incomplete Allowlists (fix before release)

| Rule | False field | Actually valid? | Projects affected |
|------|-----------|-----------------|-------------------|
| `agents/frontmatter-valid` | `name` | Yes — standard agent field | shanraisshan, chriswiles |
| `agents/frontmatter-valid` | `color` | Yes — newer agent field | shanraisshan |
| `agents/frontmatter-valid` | `skills` | Yes — agent skill references | shanraisshan |
| `commands/frontmatter-valid` | `allowed-tools` | Yes — command tool restrictions | chriswiles |
| `settings/unknown-fields` | `includeCoAuthoredBy` | Yes — co-author setting | chriswiles |
| `settings/unknown-fields` | `spinnerVerbs` | Yes — UI customization | shanraisshan |
| `settings/unknown-fields` | `spinnerTipsOverride` | Yes — UI customization | shanraisshan |
| `settings/unknown-fields` | `plansDirectory` | Likely valid | shanraisshan |
| `settings/unknown-fields` | `outputStyle` | Likely valid | shanraisshan |
| `settings/unknown-fields` | `disableAllHooks` | Likely valid | shanraisshan |

### Word-Matching FPs

| Rule | Issue | Projects affected |
|------|-------|-------------------|
| `memory/todo-fixme` | Matches "todo" in "todo list workflow" | shanraisshan |

### Heuristic FPs

| Rule | Issue | Projects affected |
|------|-------|-------------------|
| `contradiction-keywords` | Server/client components flagged as contradictory in complementary rules | learnabi |

---

## Crashes / Errors
- [x] No crashes on any target
- [x] No unhandled exceptions
- [x] Graceful handling of missing config files (trailofbits has only CLAUDE.md + settings.json)
- [x] All 42 rules ran on all targets
- [x] JSON output is well-formed for all 5 targets

---

## Go/No-Go Recommendation

**Recommendation**: **GO WITH CAVEATS**

**Rationale**: The core analysis pipeline is stable — 0 crashes, all 42 rules run, JSON output is well-formed, and evidence output is genuinely useful across all projects. However, 2 bugs and several incomplete allowlists produce false positives that would erode user trust on real-world projects.

### Issues to fix before release

**Must fix (blocking):**
1. **BUG-1: Nested skill directory discovery** — Scanner only looks one level deep. Produces error-level false positives on real projects with skill subdirectories. Fix `discoverSkillFiles()` to be recursive.
2. **Incomplete agent frontmatter allowlist** — Add `name`, `color`, `skills` to known agent fields. These are standard Claude Code fields.
3. **Incomplete command frontmatter allowlist** — Add `allowed-tools` to known command fields.
4. **Incomplete settings known-fields allowlist** — Add `includeCoAuthoredBy`, `spinnerVerbs`, `spinnerTipsOverride`, `plansDirectory`, `outputStyle`, `disableAllHooks` (verify each against Claude Code docs first).

**Should fix (not blocking but important):**
5. **BUG-2: Partial skill name extraction** — Consider adding validation that extracted skill names exist as full known names before flagging.
6. **todo-fixme word matching** — Consider requiring uppercase "TODO"/"FIXME" or "TODO:" pattern to avoid matching "todo list" in instructions.

### Known limitations to document
1. `contradiction-keywords` is heuristic — may flag complementary rules that discuss the same topic from different angles. The "Potential contradiction" phrasing is appropriate.
2. `redundant-permissions` can produce high volume on projects with many MCP permissions and a blanket allow. Consider adding a dedup/grouping option for MCP permissions.
