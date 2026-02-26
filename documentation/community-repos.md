# Community Configuration Repositories

## Default Repositories

These repos are checked by default when running `ccinspect community`:

### trailofbits/claude-code-config
- **URL:** https://github.com/trailofbits/claude-code-config
- **Focus:** Security-oriented opinionated defaults, sandbox configuration, devcontainer setup
- **Key files to diff:**
  - Settings: permissions, sandbox config, deny rules
  - CLAUDE.md structure and conventions
  - Hook configurations
- **Why:** Trail of Bits is a security-focused firm; their config is strong on sandboxing, isolation, and least-privilege permissions

### shanraisshan/claude-code-best-practice
- **URL:** https://github.com/shanraisshan/claude-code-best-practice
- **Focus:** Comprehensive best practices covering memory, rules, hooks, MCP, plugins, sandbox, output styles, permissions
- **Key files to diff:**
  - CLAUDE.md line count and structure recommendations
  - Rule organization patterns
  - Subagent configuration patterns
- **Why:** Frequently updated reference of what's possible across the entire Claude Code config surface

### ChrisWiles/claude-code-showcase
- **URL:** https://github.com/ChrisWiles/claude-code-showcase
- **Focus:** Production project configuration with hooks, skills, agents, commands, and GitHub Actions
- **Key files to diff:**
  - Hook configurations (skill evaluation, auto-formatting, quality gates)
  - Skill organization patterns
  - Agent definitions
- **Why:** Real-world production setup showing advanced hook-based workflows

## Adding Custom Repositories

Users can add additional repos via `.ccinspect.json`:

```json
{
  "community": {
    "repos": [
      "trailofbits/claude-code-config",
      "shanraisshan/claude-code-best-practice",
      "ChrisWiles/claude-code-showcase",
      "your-org/internal-claude-config"
    ],
    "cacheDir": "~/.ccinspect/community/",
    "refreshInterval": "7d"
  }
}
```

Or via CLI:
```bash
ccinspect community --repos trailofbits/claude-code-config,your-org/your-repo
```

## Comparison Strategy

When comparing against community repos:

1. **Settings comparison:**
   - Extract `settings.json` from repo
   - Compare permission rules (are community deny rules missing from user's config?)
   - Compare sandbox configuration
   - Compare hook patterns

2. **Memory comparison:**
   - Compare CLAUDE.md structure (sections present/absent)
   - Compare line counts and estimated tokens
   - Note unique instructions that the community repo has but user doesn't

3. **Rules comparison:**
   - Compare `.claude/rules/` directory structure
   - Identify rule categories present in community but missing locally
   - Note glob patterns and scoping strategies

4. **Scoring:**
   - Each community suggestion gets a relevance score based on:
     - Is the user's tech stack similar? (detect from CLAUDE.md/package.json)
     - Is the suggestion about security? (always high relevance)
     - Is the suggestion about a feature the user hasn't configured at all? (high relevance)
     - Is the suggestion a minor style preference? (low relevance)