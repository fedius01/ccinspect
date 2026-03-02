# Dogfood Results

Versioned `cci lint` results against real-world projects. Used to track how ccinspect output evolves across releases.

## Structure

Each subdirectory is named after a ccinspect version (e.g., `v0.3.0/`). Contains:
- `metadata.json` — Run date, version, target projects, aggregate issue counts
- `<project>.json` — Full `cci lint --format json` output per target
- `summary.md` — Human analysis: regressions, evidence quality, false positives, go/no-go

## Target Projects

| Project | Type | Why |
|---------|------|-----|
| ccinspect (self) | Own project | Validates against our own config |
| learnabi | User project | Real personal project config |
| trailofbits/claude-code-config | Community | Security-focused config |
| shanraisshan/claude-code-best-practice | Community | Comprehensive best practices |
| ChrisWiles/claude-code-showcase | Community | Production hooks/skills/agents |

## Comparing Across Versions

```bash
# Count issues per version
jq '.stats' dogfood/v0.3.0/ccinspect.json
jq '.stats' dogfood/v0.4.0/ccinspect.json

# Diff specific rule output
diff <(jq '[.issues[] | select(.ruleId == "rules-dir/contradiction-keywords")]' dogfood/v0.3.0/learnabi.json) \
     <(jq '[.issues[] | select(.ruleId == "rules-dir/contradiction-keywords")]' dogfood/v0.4.0/learnabi.json)
```
