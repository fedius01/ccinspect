# Legacy Monolith App

## Overview
This is a large enterprise application that has been in development for several years.
It handles customer relationship management, billing, reporting, and internal tooling.
The codebase has grown organically and includes multiple subsystems that interact
in complex ways. The system serves thousands of daily active users.

## Tech Stack
- Backend: Node.js, Express, TypeScript
- Frontend: React, Redux, Styled Components
- Database: MySQL 8, MongoDB (for analytics)
- Queue: RabbitMQ
- Cache: Redis
- Search: Elasticsearch
- Monitoring: Datadog, PagerDuty
- CI/CD: Jenkins, ArgoCD

## Architecture
The application is structured as a modular monolith with the following subsystems:

### CRM Module
Handles customer data, contact management, communication history, and customer
segmentation. This module has the most complex data model with over 40 database
tables. Customer records are the central entity that most other modules reference.

### Billing Module
Processes invoices, payments, subscriptions, and revenue recognition. Integrates
with Stripe and PayPal for payment processing. Billing events trigger webhooks
to external accounting systems. Tax calculation uses a third-party API.

### Reporting Module
Generates daily, weekly, and monthly reports for management. Uses MongoDB
aggregation pipelines for analytics queries. Reports can be exported as CSV,
PDF, or Excel. Some reports take several minutes to generate and are processed
as background jobs.

### Internal Tools Module
Admin panel for managing users, permissions, feature flags, and system
configuration. This module has its own authentication system separate from
the customer-facing auth.

### API Gateway
All external API requests flow through the gateway which handles rate limiting,
authentication, request logging, and routing to the appropriate module.

## Key Commands
- `npm run dev` — Start all services in development mode
- `npm run build` — Build for production
- `npm run test` — Run unit tests
- `npm run test:integration` — Run integration tests
- `npm run test:e2e` — Run e2e tests with Cypress
- `npm run lint` — Run ESLint
- `npm run typecheck` — Run TypeScript type checker
- `npm run db:migrate` — Run MySQL migrations
- `npm run db:seed` — Seed database
- `npm run queue:process` — Start background job processor
- `npm run cache:clear` — Clear Redis cache
- `npm run search:reindex` — Rebuild Elasticsearch indices
- `npm run reports:generate` — Manually trigger report generation

## Conventions
- Follow best practices for all code
- Write clean code that is easy to understand
- Always write tests for new features
- Use meaningful variable names
- Keep functions small and focused
- Follow the DRY principle
- Follow SOLID principles
- Use proper error handling everywhere
- Make sure code is well-documented
- Follow the coding standards
- Use appropriate design patterns
- Keep the codebase maintainable
- Write readable code
- Follow the style guide
- Ensure code quality is high
- Use proper logging
- Handle edge cases appropriately
- Write self-documenting code
- Follow industry best practices
- Keep dependencies up to date

## Database Guidelines
All database access should go through the ORM layer. Direct SQL queries are
discouraged but sometimes necessary for complex reporting queries. Migrations
must be reviewed by a senior developer before merging.

When writing new migrations:
- Always provide a rollback script
- Test migrations against a copy of production data
- Coordinate with the DBA for schema changes to large tables
- Never drop columns in a single migration — deprecate first, remove later

## API Design
REST APIs should follow standard HTTP conventions. Use proper status codes,
pagination for list endpoints, and consistent error response formats.
GraphQL is used for the frontend data layer and should follow Relay conventions.

## Error Handling
All errors should be properly caught and logged. User-facing errors should
have friendly messages. Internal errors should include stack traces in logs
but never expose them to users. Use structured error classes from the
shared error library.

## Security
- Never log sensitive data (passwords, tokens, PII)
- Always validate input on the server side
- Use parameterized queries to prevent SQL injection
- Implement CSRF protection on all state-changing endpoints
- Rate limit authentication endpoints
- Use HTTPS everywhere
- Rotate secrets regularly
- Follow OWASP guidelines

## Performance
Monitor response times and set up alerts for degradation. Database queries
should be optimized with proper indexing. Use caching aggressively for
read-heavy endpoints. Background jobs should be used for any operation
that takes more than 500ms.

## Deployment
Deployments go through the following environments: dev → staging → production.
Each environment has its own database and configuration. Feature flags are
used for gradual rollouts. Canary deployments are required for high-risk
changes.

## Monitoring
All services emit metrics to Datadog. Critical alerts go to PagerDuty.
Error rates, response times, and queue depths are monitored. Custom
dashboards exist for each module.

## Code Review
All changes require at least two approvals before merging. The CI pipeline
must pass before a PR can be merged. Large PRs should be broken into
smaller, reviewable chunks.

## Module Owners
- CRM: @team-crm
- Billing: @team-billing
- Reporting: @team-analytics
- Internal Tools: @team-platform
- API Gateway: @team-platform
- Infrastructure: @team-devops

## Deprecated Features
The following features are deprecated and should not be extended:
- Legacy XML export (use JSON export instead)
- SOAP API endpoints (use REST or GraphQL)
- Custom cron scheduler (use RabbitMQ delayed messages)
- File-based session storage (use Redis sessions)

## Environment Variables
Required environment variables are documented in `.env.example`.
Never commit actual environment files. Use the vault for production secrets.

## Troubleshooting
Common issues and their resolutions:
- If the queue processor crashes, check RabbitMQ connection and restart
- If search is slow, check Elasticsearch cluster health
- If reports timeout, check MongoDB query performance
- If cache misses spike, verify Redis connection pool settings

## On-Call Procedures
When on call, follow the runbook in Confluence. Escalation path:
1. Try the documented fix in the runbook
2. Check Datadog dashboards for anomalies
3. Escalate to the module owner
4. Escalate to the engineering manager

## Additional Notes
This codebase has been migrated from JavaScript to TypeScript incrementally.
Some older modules still have partial type coverage. New code must be fully
typed. The migration is tracked in the TypeScript Migration project board.

Legacy code in `src/legacy/` follows different conventions and should not
be used as reference for new development. When modifying legacy code,
prefer refactoring to the new conventions when scope allows.

The frontend uses a mix of class components (legacy) and function components
(new code). All new frontend code must use function components with hooks.
Class components should be migrated opportunistically during related work.

Third-party integrations are managed through adapter patterns in
`src/integrations/`. Each integration has its own configuration, error
handling, and retry logic. New integrations must implement the
`IntegrationAdapter` interface.

Background jobs use a priority queue system. Critical jobs (billing webhooks,
security alerts) get highest priority. Report generation and analytics
processing get lower priority. Job retries use exponential backoff.

The test suite takes approximately 20 minutes to run fully. CI runs tests
in parallel across 4 workers. Flaky tests are tracked in the "Test Health"
dashboard and must be fixed within one sprint of being flagged.

Feature flags are managed through LaunchDarkly. Each feature flag must have
an owner, an expiration date, and a cleanup plan. Stale flags older than
90 days are automatically flagged for removal during the monthly cleanup
sprint. The flag naming convention is `module.feature-name`.

Documentation lives in Confluence and should be updated alongside code changes.
