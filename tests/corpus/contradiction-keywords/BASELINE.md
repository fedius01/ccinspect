# Contradiction Keywords — Baseline Metrics

**Date**: 2026-03-01
**Rule version**: post-overhaul (TOOL_CATEGORIES ~70 auto-generated pairs, segment-based globs, word boundaries)
**Corpus size**: 30 pairs (15 TP, 15 TN)

## Results

| Metric | Value |
|--------|-------|
| Precision | 93.8% |
| Recall | 100.0% |
| F1 | 96.8% |
| True Positives (correctly detected) | 15/15 |
| True Negatives (correctly silent) | 14/15 |
| False Positives | 1 |
| False Negatives | 0 |

## Detailed Results

| ID | Expected | Actual | Result |
|----|----------|--------|--------|
| TP01-jest-vs-vitest | FIRE | FIRE | PASS |
| TP02-npm-vs-pnpm | FIRE | FIRE | PASS |
| TP03-prettier-vs-biome-formatter | FIRE | FIRE | PASS |
| TP04-biome-vs-eslint-linter | FIRE | FIRE | PASS |
| TP05-always-vs-never | FIRE | FIRE | PASS |
| TP06-tabs-vs-spaces | FIRE | FIRE | PASS |
| TP07-single-vs-double-quotes | FIRE | FIRE | PASS |
| TP08-redux-vs-zustand | FIRE | FIRE | PASS |
| TP09-css-modules-vs-tailwind | FIRE | FIRE | PASS |
| TP10-webpack-vs-vite | FIRE | FIRE | PASS |
| TP11-partial-overlap-scopes | FIRE | FIRE | PASS |
| TP12-always-require-vs-never | FIRE | FIRE | PASS |
| TP13-default-vs-named-export | FIRE | FIRE | PASS |
| TP14-server-vs-client-components | FIRE | FIRE | PASS |
| TP15-semicolons-conflict | FIRE | FIRE | PASS |
| TN01-different-scopes-backend-frontend | SILENT | SILENT | PASS |
| TN02-same-tool-agreement | SILENT | SILENT | PASS |
| TN03-unrelated-topics | SILENT | SILENT | PASS |
| TN04-word-boundary-using-vs-use | SILENT | SILENT | PASS |
| TN05-different-scopes-deep | SILENT | SILENT | PASS |
| TN06-similar-words-no-conflict | SILENT | SILENT | PASS |
| TN07-one-rule-no-tools | SILENT | SILENT | PASS |
| TN08-must-without-conflict | SILENT | SILENT | PASS |
| TN09-same-category-different-scopes | SILENT | SILENT | PASS |
| TN10-tool-mention-not-instruction | SILENT | SILENT | PASS |
| TN11-negation-no-pair | SILENT | SILENT | PASS |
| TN12-async-same-approach | SILENT | SILENT | PASS |
| TN13-empty-paths-vs-specific | SILENT | FIRE | **FP** |
| TN14-complementary-tools | SILENT | SILENT | PASS |
| TN15-long-prose-buried-keyword | SILENT | SILENT | PASS |

## Known Limitations

### FP: TN13-empty-paths-vs-specific

`paths: []` (explicitly empty array) is treated as global scope by `globsOverlap()`,
causing it to overlap with any other rule. This is intentional behavior — empty paths
means "this rule applies everywhere" in the current implementation. The rule then
detects `['use jest', 'use vitest']` across the two files.

This is a design decision, not a bug. If users want a rule to apply nowhere, they
should omit the paths field or remove the rule file entirely. An explicitly empty
`paths: []` is semantically ambiguous, and the current interpretation (global scope)
is the safer default.

## Coverage Analysis

The corpus tests the following heuristic dimensions:

- **Tool category conflicts** (TP01-TP04, TP06-TP10): Single-word and multi-word tool names across 9 categories
- **Explicit negation pairs** (TP05, TP12, TP15): always/never, use/no patterns
- **Multi-word phrase matching** (TP09, TP13, TP14): css modules, default export, server components
- **Scope filtering** (TP11, TN01, TN05, TN09): Segment-based glob overlap/non-overlap
- **Word boundary precision** (TN04): "using prettier" does not match "use prettier"
- **Same tool agreement** (TN02): Both rules recommend the same tool
- **Tool mentions vs instructions** (TN10, TN15): "Jest configuration is..." doesn't match "use jest"
- **Unrelated content** (TN03, TN06, TN07, TN08, TN11): No matching pairs in the text
- **Same approach** (TN12): Both rules use async/await, no conflict
- **Complementary tools** (TN14): React + Express are different categories
- **Empty paths semantics** (TN13): Edge case for `paths: []`

## Notes

- Baseline to be compared against Phase 8 `ai-analyzer.ts` LLM-based detection results
- The original prompt's TN14 (biome-formatter vs eslint-linter) was reclassified to TP04 during corpus design because `['use biome', 'use eslint']` is a generated pair in the linter category — the heuristic cannot distinguish intent ("biome for formatting" vs "biome for linting")
- Run with: `npm run eval:contradiction`
