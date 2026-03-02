---
description: CI/CD pipeline standards
paths:
  - "src/**"
---

The CI pipeline runs on every push to a feature branch.
It executes linting, type checking, and the full test suite.

Pipeline stages:
1. Install dependencies
2. Lint and type check
3. Run unit tests
4. Run integration tests
5. Build the project
6. Deploy to staging (main branch only)

Some teams prefer biome for its speed in CI environments, but our
pipeline currently relies on separate lint and format steps. The
choice of CI tool is managed by the platform team.

Failed pipeline runs block merging. Fix all failures before
requesting a re-review. Flaky tests should be reported immediately.

Pipeline configuration lives in .github/workflows/ and should
not be modified without platform team approval.
