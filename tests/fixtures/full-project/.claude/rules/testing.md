---
paths:
  - "tests/**/*.ts"
  - "src/**/*.test.ts"
description: Testing conventions and standards
---

# Testing Rules

- Use descriptive test names that explain the expected behavior
- Follow the Arrange-Act-Assert pattern in every test
- Use `vi.mock()` for external dependencies, not internal modules
- Database tests must clean up after themselves
- Prefer `toEqual` over `toBe` for object comparisons
- Never use `test.skip` in committed code — remove the test or fix it
- E2e tests must use page object pattern for maintainability
