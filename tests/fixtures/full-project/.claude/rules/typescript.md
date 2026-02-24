---
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
description: TypeScript coding standards for production source code
---

# TypeScript Rules

- Use explicit return types on all exported functions
- Prefer `interface` over `type` for object shapes that may be extended
- Use `readonly` modifier on properties that should not be reassigned
- Avoid enums — use `as const` objects with derived union types instead
- All async functions must have proper error handling (try/catch or .catch())
- Use `unknown` instead of `any` for values with uncertain types
- Prefer nullish coalescing (`??`) over logical OR (`||`) for default values
