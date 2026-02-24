# Acme Web App

## Overview
Full-stack web application for the Acme Corp inventory management system.
Built with React frontend and Express backend, using PostgreSQL for persistence.
The application handles product catalog management, order processing, and
real-time inventory tracking across multiple warehouses.

## Tech Stack
- Frontend: React 19, TypeScript, Tailwind CSS, React Query
- Backend: Express.js, TypeScript, Prisma ORM
- Database: PostgreSQL 16
- Cache: Redis 7
- Testing: Vitest (unit), Playwright (e2e)
- Build: Vite (frontend), tsup (backend)
- CI/CD: GitHub Actions
- Deployment: Docker + AWS ECS

## Architecture
The project follows a modular monorepo structure:

```
src/
├── client/          # React frontend (Vite)
│   ├── components/  # Shared UI components
│   ├── pages/       # Route-level page components
│   ├── hooks/       # Custom React hooks
│   ├── stores/      # Zustand state stores
│   └── api/         # API client (React Query + fetch)
├── server/          # Express backend
│   ├── routes/      # API route handlers
│   ├── services/    # Business logic layer
│   ├── models/      # Prisma model extensions
│   ├── middleware/   # Auth, logging, rate-limiting
│   └── jobs/        # Background job processors
├── shared/          # Shared types and utilities
│   ├── types/       # TypeScript interfaces
│   └── validation/  # Zod schemas (shared client+server)
└── prisma/          # Database schema and migrations
```

The frontend communicates with the backend exclusively through REST API calls.
Authentication uses JWT tokens stored in HTTP-only cookies. The backend validates
all input using shared Zod schemas before processing.

## Key Commands
- `npm run dev` — Start both frontend and backend in development mode
- `npm run dev:client` — Start only the frontend dev server (port 5173)
- `npm run dev:server` — Start only the backend dev server (port 3000)
- `npm run build` — Build both frontend and backend for production
- `npm run test` — Run all Vitest unit tests
- `npm run test:e2e` — Run Playwright end-to-end tests
- `npm run db:migrate` — Run pending Prisma migrations
- `npm run db:seed` — Seed the database with test data
- `npm run lint` — Run ESLint + type check on entire project
- `npm run docker:up` — Start local Docker Compose stack (db + redis)

## Conventions
- All API routes are prefixed with `/api/v1/`
- Use Zod schemas in `src/shared/validation/` for all request/response types
- Components use PascalCase filenames, utilities use camelCase
- Database migrations must be backwards-compatible for zero-downtime deploys
- Every service method must have a corresponding unit test
- Error responses follow the `{ error: string, code: string, details?: unknown }` shape
- Environment variables are validated at startup via `src/server/config.ts`

## Do NOT
- Use `any` type — strict TypeScript mode is enforced
- Commit .env files — use .env.example as a template
- Write raw SQL — use Prisma query builder or raw queries only when absolutely necessary
- Skip input validation — all user input goes through Zod schemas
- Use console.log in production code — use the structured logger from `src/server/lib/logger.ts`

## Database
The schema has these core tables: users, products, warehouses, inventory_items,
orders, order_lines. See `prisma/schema.prisma` for the full schema definition.
Migrations are in `prisma/migrations/` and must never be manually edited after
being applied to staging or production.

## Testing
Unit tests live next to the source files as `*.test.ts`. Integration tests for
API routes are in `tests/integration/`. E2e tests are in `tests/e2e/`.
All tests use the Vitest test runner. Database tests use a dedicated test database
that is reset between test suites via `npm run db:test:reset`.
