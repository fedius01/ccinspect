# Overconfigured Enterprise Platform

## Overview
This is a massively overconfigured enterprise platform that serves as a cautionary
example of what happens when CLAUDE.md grows without bounds. The project handles
customer management, billing, analytics, and internal administration tools.
It has been in development for five years across multiple teams and continents.
The codebase spans over 200,000 lines of TypeScript across dozens of packages.

## Tech Stack
- Backend: Node.js 20, Express 5, TypeScript 5.4 (strict mode)
- Frontend: React 19, Next.js 15, Tailwind CSS 4
- Database: PostgreSQL 16 (primary), Redis 7 (cache), MongoDB 7 (analytics)
- Queue: RabbitMQ 3.13, Bull for job processing
- Search: Elasticsearch 8.12
- Monitoring: Datadog, PagerDuty, Sentry
- CI/CD: GitHub Actions, ArgoCD, Terraform
- Infrastructure: AWS (ECS, RDS, ElastiCache, SQS)
- Auth: Auth0, JWT, SAML for enterprise SSO
- API: REST (public), GraphQL (internal), gRPC (microservices)

## Key Commands
- `npm run dev` -- Start all services in development mode
- `npm run build` -- Production build for all packages
- `npm run test` -- Run full test suite
- `npm run test:unit` -- Run unit tests only
- `npm run test:integration` -- Run integration tests
- `npm run test:e2e` -- Run end-to-end tests with Playwright
- `npm run lint` -- Run ESLint across all packages
- `npm run typecheck` -- Run TypeScript type checking
- `npm run db:migrate` -- Run pending database migrations
- `npm run db:seed` -- Seed database with test data
- `npm run docker:up` -- Start Docker Compose stack
- `npm run docker:down` -- Stop Docker Compose stack
- `npm run storybook` -- Launch Storybook for component development
- `npm run analyze` -- Analyze bundle sizes
- `npm run format` -- Run Prettier on all files

## Conventions

### General Guidelines
- Follow best practices for all code
- Write clean code that is easy to understand
- Use meaningful variable names for everything
- Keep functions small and focused at all times
- Follow the DRY principle throughout the codebase
- Follow SOLID principles in all class designs
- Use proper error handling everywhere in the application
- Make sure code is well-documented with JSDoc
- Follow the coding standards defined by the team
- Use appropriate design patterns for each situation
- Keep the codebase maintainable and organized
- Write readable code that others can understand
- Follow the style guide without exceptions
- Ensure code quality is high across all modules
- Handle edge cases appropriately in every function
- Write self-documenting code whenever possible
- Follow industry best practices for security
- Be consistent with naming conventions
- Keep it simple and avoid over-engineering
- Follow standards established by the platform team
- Follow the standards for API design

### TypeScript Specific
- Always use strict mode
- Prefer interfaces over type aliases for object shapes
- Use discriminated unions for state machines
- Avoid using `any` -- use `unknown` and type guards instead
- Use `readonly` for all immutable properties
- Prefer `const` assertions for literal types

### React Specific
- Use functional components exclusively
- Custom hooks should start with `use` prefix
- Memoize expensive computations with useMemo
- Use React.memo for components that re-render frequently
- Prefer server components where possible in Next.js

### API Design
- All endpoints follow REST conventions
- Use proper HTTP status codes
- Paginate list endpoints with cursor-based pagination
- Include request IDs in all responses
- Rate limit all public endpoints

### Database
- All queries go through the ORM (Prisma)
- Never write raw SQL outside of migrations
- Index all foreign key columns
- Use database transactions for multi-table operations
- Implement soft deletes for auditable entities

### Testing
- Every feature must have unit tests
- Integration tests for API endpoints
- E2e tests for critical user journeys
- Maintain >80% code coverage
- Use factories for test data generation

### Security
- Never log sensitive data (passwords, tokens, PII)
- Validate all input on the server side
- Use parameterized queries exclusively
- Implement CSRF protection on all mutations
- Rate limit authentication endpoints
- Use HTTPS for all communications
- Rotate secrets quarterly
- Follow OWASP Top 10 guidelines

### Performance
- Cache all frequently accessed data in Redis
- Use connection pooling for database connections
- Implement lazy loading for heavy components
- Use CDN for static assets
- Monitor response times with alerts at p99 > 500ms

### Deployment
- Feature flags for all new features
- Canary deployments for production releases
- Blue-green deployment strategy
- Zero-downtime database migrations only
- Rollback plan for every deployment

### Code Review
- Minimum two approvals required
- CI must pass before merge
- No force pushes to main
- Squash merge for feature branches
- Use conventional commits format

### Monitoring
- Structured logging with correlation IDs
- Custom Datadog dashboards per service
- PagerDuty alerts for error rate > 1%
- Trace all requests end-to-end
- Monthly SLA review meetings

### Documentation
- ADRs for architectural decisions
- API docs auto-generated from OpenAPI specs
- README in every package
- Runbooks for operational procedures
- Onboarding guide kept up to date

### Error Handling
- Custom error classes for each domain
- Error boundary components in React
- Retry with exponential backoff for transient failures
- Circuit breaker pattern for external services
- Dead letter queue for failed messages

## Module Structure

### Customer Module
Handles customer data, profiles, segmentation, and communication preferences.
Over 50 database tables. Customer records are the central entity.

### Billing Module
Processes subscriptions, invoices, payments via Stripe and PayPal.
Handles tax calculation, revenue recognition, and refunds.

### Analytics Module
Real-time dashboards, report generation, data pipeline processing.
Uses MongoDB aggregation for complex queries.

### Admin Module
Internal tools for user management, feature flags, system configuration.
Separate authentication system from customer-facing auth.

### API Gateway
Request routing, rate limiting, authentication, request logging.
Load balancing across service instances.

### Notification Module
Email, SMS, push notification delivery. Template management.
Delivery tracking and retry logic.

### Search Module
Full-text search powered by Elasticsearch. Indexing pipeline.
Search relevance tuning and analytics.

### File Storage Module
Document upload, processing, and retrieval. S3 integration.
Image resizing, PDF generation, file type validation.

## Environment Variables
See `.env.example` for the full list of required environment variables.
Never commit actual `.env` files. Use AWS Secrets Manager in production.
Local development uses `.env.local` which is gitignored.

## Troubleshooting

### Common Issues
- Queue processor crashes: Check RabbitMQ connection, restart consumer
- Search latency: Check Elasticsearch cluster health, reindex if needed
- Cache misses: Verify Redis connection pool, check eviction policy
- Database deadlocks: Review transaction isolation levels
- Memory leaks: Profile with --inspect flag, check for event listener leaks

### Emergency Procedures
1. Check Datadog dashboard for anomalies
2. Review recent deployments in ArgoCD
3. Check infrastructure status in AWS Console
4. Escalate to on-call engineer via PagerDuty
5. Follow runbook in Confluence

## Team Ownership
- Customer: @team-customer
- Billing: @team-billing
- Analytics: @team-analytics
- Admin: @team-platform
- API Gateway: @team-platform
- Notifications: @team-communications
- Search: @team-search
- File Storage: @team-infrastructure
- DevOps: @team-devops

## Deprecated Features
Do not extend or build upon these deprecated features:
- Legacy SOAP API (replaced by REST)
- XML export format (use JSON)
- Custom cron scheduler (use Bull queues)
- File-based sessions (use Redis)
- jQuery UI components (use React components)

## Migration Notes
The platform is being migrated from a monolith to microservices architecture.
Current state: 60% migrated. Remaining monolith code is in `src/legacy/`.
New services must follow the microservice template in `templates/service/`.

## Import References
See @docs/imported.md for additional configuration documentation.

## Third-Party Integrations
All integrations use the adapter pattern defined in `src/integrations/`.
Each adapter implements retry logic, circuit breaking, and error mapping.
New integrations must be approved by the architecture review board.

## Compliance
- SOC 2 Type II certified
- GDPR compliant with data residency in EU
- PCI DSS Level 1 for payment processing
- HIPAA compliant for healthcare customers
- Regular penetration testing by third-party auditors

## Data Retention
- Customer data: 7 years after account closure
- Audit logs: 5 years
- Analytics data: 2 years (aggregated after 90 days)
- Session data: 30 days
- Temporary files: 24 hours

## Feature Flags
Managed through LaunchDarkly. Naming convention: `module.feature-name`.
Each flag must have an owner, expiration date, and cleanup plan.
Stale flags (>90 days) are flagged in the monthly cleanup sprint.

## Rate Limiting
- Public API: 100 req/min per API key
- Internal API: 1000 req/min per service
- Authentication: 10 attempts per minute per IP
- File upload: 50 MB max per request
- WebSocket: 100 messages per second per connection

## Internationalization
The platform supports 12 languages. Translation files are in `src/i18n/`.
Use the `t()` function from `react-i18next` for all user-facing strings.
Never hardcode user-facing text in components.

## Accessibility
All UI components must meet WCAG 2.1 AA standards.
Use semantic HTML elements. Provide ARIA labels where needed.
Test with screen readers (VoiceOver, NVDA) before release.

## Git Workflow
- Main branch: `main` (protected, requires PR)
- Feature branches: `feature/TICKET-description`
- Hotfix branches: `hotfix/TICKET-description`
- Release branches: `release/vX.Y.Z`
- Commit messages follow Conventional Commits

## Additional Documentation
- Architecture Decision Records: `docs/adr/`
- API Documentation: `docs/api/`
- Runbooks: `docs/runbooks/`
- Onboarding: `docs/onboarding/`
- Development Guide: `docs/dev-guide/`

## Service Level Objectives
- API availability: 99.9% uptime
- p50 response time: < 100ms
- p99 response time: < 500ms
- Error rate: < 0.1%
- Data durability: 99.999%

## Cost Management
Track AWS costs per service using cost allocation tags.
Monthly cost review with engineering leadership.
Set billing alerts at 80% and 100% of budget.
Optimize unused resources quarterly.

## Incident Response
Follow the PagerDuty incident response process.
Post-mortems required for all P1 and P2 incidents.
Blameless culture for incident reviews.
Track MTTR and incident frequency metrics.

## Legal and Privacy
All new features must pass privacy review.
Data processing agreements required for new vendors.
Cookie consent must be obtained before tracking.
Right to deletion must be supported for all user data.
CCPA compliance required for California users.
