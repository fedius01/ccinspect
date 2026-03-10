---
name: bad-agent
description: Agent using invalid allowedTools field
allowedTools:
  - Read
  - Bash
---

# Bad Agent

This agent uses `allowedTools` which is not valid — should use `tools` or `disallowedTools`.
