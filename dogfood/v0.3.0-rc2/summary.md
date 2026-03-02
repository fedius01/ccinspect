# Dogfood Comparison — v0.3.0 → v0.3.0-rc2

**Date**: 2026-03-01
**Changes since v0.3.0**: Prompt 11 (allowlist refresh from official schema, agent/command/skill/rules frontmatter updates, recursive skill scanner, todo-fixme case sensitivity)

## Issue Count Comparison

| Project | v0.3.0 Errors | rc2 Errors | v0.3.0 Warnings | rc2 Warnings | v0.3.0 Info | rc2 Info | v0.3.0 Total | rc2 Total | Delta |
|---------|--------------|-----------|-----------------|-------------|------------|---------|-------------|----------|-------|
| ccinspect | 0 | 0 | 1 | 2 | 5 | 5 | 6 | 7 | +1 |
| learnabi | 0 | 0 | 6 | 7 | 9 | 9 | 15 | 16 | +1 |
| trailofbits | 0 | 0 | 2 | 3 | 5 | 5 | 7 | 8 | +1 |
| shanraisshan | 4 | 3 | 19 | 7 | 72 | 73 | 95 | 83 | -12 |
| chriswiles | 0 | 0 | 5 | 3 | 14 | 9 | 19 | 12 | -7 |
| **Total** | **4** | **3** | **33** | **22** | **105** | **101** | **142** | **126** | **-16** |

**Net reduction**: 16 fewer issues (142 → 126). Errors dropped from 4 to 3.

---

## Per-Rule Delta

### ccinspect (self): 6 → 7 (+1)
| Rule | v0.3.0 | rc2 | Delta | Assessment |
|------|--------|-----|-------|------------|
| `settings/unknown-fields` | 0 | 1 | +1 | **New FP**: `feedbackSurveyState` in `~/.claude/settings.json` (see below) |

### learnabi: 15 → 16 (+1)
| Rule | v0.3.0 | rc2 | Delta | Assessment |
|------|--------|-----|-------|------------|
| `settings/unknown-fields` | 0 | 1 | +1 | **New FP**: same `feedbackSurveyState` from user global settings |

### trailofbits: 7 → 8 (+1)
| Rule | v0.3.0 | rc2 | Delta | Assessment |
|------|--------|-----|-------|------------|
| `settings/unknown-fields` | 0 | 1 | +1 | **New FP**: same `feedbackSurveyState` from user global settings |

### shanraisshan: 95 → 83 (-12)
| Rule | v0.3.0 | rc2 | Delta | Assessment |
|------|--------|-----|-------|------------|
| `agents/frontmatter-valid` | 9 | 2 | -7 | **7 FPs eliminated**: `name`, `color`, `skills`, `memory` no longer flagged. 2 remaining are TPs ("tools" not an array). |
| `agents/skill-reference-valid` | 4 | 2 | -2 | **2 scanner FPs eliminated**: `presentation-structure` and `presentation-styling` now discovered by recursive scanner. 2 remain: `framework` and `structure` (BUG-2, partial name extraction). |
| `commands/frontmatter-valid` | 1 | 0 | -1 | **1 FP eliminated**: `model` field now in allowlist. |
| `skills/frontmatter-valid` | 1 | 0 | -1 | **1 FP eliminated**: `allowed-tools` field now in allowlist. |
| `settings/unknown-fields` | 5 | 1 | -4 | **5 FPs eliminated**: `spinnerVerbs`, `spinnerTipsOverride`, `plansDirectory`, `outputStyle`, `disableAllHooks`. 1 remaining: `feedbackSurveyState` (new FP, see below). |
| `memory/todo-fixme` | 1 | 0 | -1 | **1 FP eliminated**: case-sensitive matching no longer matches "todo" in prose. |
| `settings/redundant-permissions` | 64 | 67 | +3 | **3 new TPs**: repo updated today (d4f6baa), added more MCP permission entries. |
| `skills/agent-reference-valid` | 0 | 1 | +1 | **1 new FP**: newly discovered nested skill references "specialized" from body text (BUG-2 pattern). |

### chriswiles: 19 → 12 (-7)
| Rule | v0.3.0 | rc2 | Delta | Assessment |
|------|--------|-----|-------|------------|
| `agents/frontmatter-valid` | 2 | 0 | -2 | **2 FPs eliminated**: `name` field no longer flagged. |
| `commands/frontmatter-valid` | 5 | 0 | -5 | **5 FPs eliminated**: `allowed-tools` field no longer flagged. |

Note: chriswiles `settings/unknown-fields` count stayed at 1, but the **specific field changed** — v0.3.0 flagged `includeCoAuthoredBy` (FP, now in allowlist), rc2 flags `feedbackSurveyState` (new FP from user global settings).

---

## FP Verification Checklist

### Allowlist FPs (14 field-project combinations — expected: all eliminated)

- [x] `agents/frontmatter-valid` no longer flags `name` — shanraisshan (2 issues gone)
- [x] `agents/frontmatter-valid` no longer flags `name` — chriswiles (2 issues gone)
- [x] `agents/frontmatter-valid` no longer flags `color` — shanraisshan (2 issues gone)
- [x] `agents/frontmatter-valid` no longer flags `skills` — shanraisshan (2 issues gone)
- [x] `agents/frontmatter-valid` no longer flags `memory` — shanraisshan (1 issue gone)
- [x] `commands/frontmatter-valid` no longer flags `allowed-tools` — chriswiles (5 issues gone)
- [x] `commands/frontmatter-valid` no longer flags `model` — shanraisshan (1 issue gone)
- [x] `skills/frontmatter-valid` no longer flags `allowed-tools` — shanraisshan (1 issue gone)
- [x] `settings/unknown-fields` no longer flags `includeCoAuthoredBy` — chriswiles (1 issue gone)
- [x] `settings/unknown-fields` no longer flags `spinnerVerbs` — shanraisshan
- [x] `settings/unknown-fields` no longer flags `spinnerTipsOverride` — shanraisshan
- [x] `settings/unknown-fields` no longer flags `plansDirectory` — shanraisshan
- [x] `settings/unknown-fields` no longer flags `outputStyle` — shanraisshan
- [x] `settings/unknown-fields` no longer flags `disableAllHooks` — shanraisshan

**Result: 14/14 allowlist FPs eliminated.** All allowlist fixes confirmed working.

### Scanner FPs (4 error-level — expected: scanner bugs eliminated, BUG-2 remains)

- [x] `agents/skill-reference-valid` "presentation-structure" — shanraisshan: **ELIMINATED** (scanner now discovers nested skill)
- [x] `agents/skill-reference-valid` "presentation-styling" — shanraisshan: **ELIMINATED** (scanner now discovers nested skill)
- [ ] `agents/skill-reference-valid` "framework" — shanraisshan: **REMAINS** (BUG-2, partial name extraction, planned v0.3.1)
- [ ] `agents/skill-reference-valid` "structure" — shanraisshan: **REMAINS** (BUG-2, partial name extraction, planned v0.3.1)

**Result: 2/4 eliminated.** The 2 scanner bug FPs are fixed. The 2 BUG-2 FPs remain as expected (not addressed in Prompt 11).

Scanner fix verified: `filesChecked` on shanraisshan increased from 10 → 13 (3 nested skills now discovered).

### Todo-fixme FP (expected: eliminated)

- [x] `memory/todo-fixme` no longer matches lowercase "todo" in "todo list workflow" — shanraisshan: **ELIMINATED**

### Remaining expected FPs (not fixed in this round)

- [ ] `contradiction-keywords` on learnabi — server/client components FP still present. **Expected**, planned for v0.3.1.

---

## New Issues

### New FP: `feedbackSurveyState` (5 targets, 1 root cause)

`settings/unknown-fields` now flags `feedbackSurveyState` in `~/.claude/settings.json` on all 5 targets. This field was added by the Claude Code client to user settings after the v0.3.0 dogfood run (file mtime: Mar 1 23:14). It is not in the official Claude Code settings schema, but it is an internal client-state field written automatically — users should not be expected to remove it.

**Impact**: +1 warning per target (5 total). Single root cause.
**Fix**: Add `feedbackSurveyState` to the settings allowlist. Trivial — same pattern as other Prompt 11 allowlist additions.

### New FP: `skills/agent-reference-valid` "specialized" (shanraisshan)

The recursive skill scanner now discovers `presentation/vibe-to-agentic-framework/SKILL.md`. This skill's body text mentions "specialized" in natural language ("a fully configured engineering system"), which the reference extractor picks up as an agent name. This is the same BUG-2 pattern (partial name extraction from body text).

**Impact**: +1 error on shanraisshan. Same root cause as the 2 remaining `agents/skill-reference-valid` FPs.
**Fix**: Planned for v0.3.1 (require explicit formatting for agent/skill references).

### New TPs: `settings/redundant-permissions` +3 (shanraisshan)

The shanraisshan repo was updated today (commit d4f6baa). 3 additional MCP permission entries are now flagged as redundant (covered by the blanket `mcp__*` allow). These are true positives.

---

## Regression Check

**No regressions detected.** All true positives from v0.3.0 are preserved in rc2:

| Check | Result |
|-------|--------|
| shanraisshan `agents/frontmatter-valid` "tools" not array (2 TPs) | Present ✅ |
| shanraisshan `settings/dangerous-allow` (2 TPs) | Present ✅ |
| shanraisshan `settings/redundant-permissions` (64 TPs) | Present + 3 new ✅ |
| chriswiles `agents/orphan-agent` (2 TPs) | Present ✅ |
| learnabi `rules-dir/contradiction-keywords` (1 borderline) | Present ✅ |
| learnabi `rules-dir/overlapping-rules` (1 TP) | Present ✅ |
| learnabi `rules-dir/frontmatter-valid` missing frontmatter (2 TPs) | Present ✅ |
| learnabi `rules-dir/large-rule-file` (3 TPs) | Present ✅ |
| All projects: `settings/sandbox-recommended` | Present ✅ |
| All projects: `settings/deny-sensitive-paths` | Present ✅ |

No true positive disappeared between v0.3.0 and rc2.

---

## Release Decision

**FPs from v0.3.0 eliminated**: 17 of 20
**FPs from v0.3.0 remaining**: 3 (2 × BUG-2 partial name extraction, 1 × heuristic contradiction — all expected/planned)
**New FPs introduced**: 6 issues (5 × `feedbackSurveyState` from 1 root cause, 1 × `skills/agent-reference-valid` from BUG-2 pattern)
**Regressions**: 0 true positives lost
**New error-level FPs**: 1 (skills/agent-reference-valid "specialized" — BUG-2 pattern)
**Crashes**: 0

**Decision**: **CONDITIONAL GO**

The Prompt 11 fixes are fully verified — all 14 allowlist FPs eliminated, both scanner bug FPs eliminated, todo-fixme FP eliminated, zero regressions. The remaining issues are:

1. **`feedbackSurveyState` (trivial fix)**: Add to settings allowlist before release. Same pattern as existing allowlist additions. Eliminates 5 warning-level FPs across all targets.
2. **BUG-2 partial name extraction (3 error FPs)**: Known, documented, planned for v0.3.1. Not blocking — the extracted "names" are clearly wrong (single common words like "framework", "structure", "specialized"), and users will understand the issue.
3. **Contradiction heuristic (1 warning FP)**: Known baseline, documented as heuristic limitation.

### Pre-release action required
- Add `feedbackSurveyState` to `settings/unknown-fields` allowlist (1-line fix)
- Re-run ccinspect self-check to verify 0 FPs on own config

### Remaining known issues for v0.3.1
- BUG-2: Partial name extraction from agent/skill body text (3 error-level FPs on shanraisshan)
- Contradiction heuristic: server/client components flagged as contradictory in complementary rules (1 warning on learnabi)
- Redundant-permissions noise: Projects with blanket `mcp__*` allow produce high volume of info-level findings (67 on shanraisshan). Consider grouping/dedup option.
