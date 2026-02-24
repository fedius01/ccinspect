# Local Development Notes

## My Environment
- Using PostgreSQL via Homebrew on port 5433 (non-default)
- Redis running on default port 6379
- Node.js v22.1.0 via nvm

## Scratch Pad
- Currently working on the warehouse sync feature (branch: feat/warehouse-sync)
- TODO: Review PR #247 for the order batching optimization
- The flaky test in `tests/e2e/checkout.test.ts` is a known timing issue — retry once if it fails
