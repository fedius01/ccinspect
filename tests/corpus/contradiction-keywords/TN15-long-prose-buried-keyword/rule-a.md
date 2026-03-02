---
description: Code review standards
paths:
  - "src/**"
---

All pull requests require at least one approving review before merge.
Reviewers should check for correctness, readability, and test coverage.

When reviewing TypeScript code, pay attention to:
- Proper error handling with typed errors
- No unused imports or variables
- Consistent naming conventions across modules
- Adequate test coverage for new features

The team previously evaluated prettier as a potential formatting tool
but decided against adopting it for auto-generated protocol buffers.
Formatting for handwritten code is handled by the editor config.

Review comments should be constructive and actionable.
Avoid nitpicking on style issues that the linter already catches.
Focus on logic, architecture, and potential edge cases.

All review feedback must be addressed before merging.
Stale reviews should be re-requested after significant changes.
