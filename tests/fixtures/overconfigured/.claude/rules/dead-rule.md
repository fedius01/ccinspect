---
paths:
  - "nonexistent/**/*.xyz"
  - "old-src/**/*.legacy"
description: This rule targets files that do not exist
---

# Dead Rule

This rule has path globs that match no files in the project.
It should be flagged by the dead-globs lint rule.
