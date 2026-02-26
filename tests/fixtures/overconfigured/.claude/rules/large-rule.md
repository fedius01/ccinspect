---
paths:
  - "src/**/*.ts"
description: Comprehensive coding standards and guidelines
---

# Comprehensive Coding Standards

## General Programming Principles

All code must follow these fundamental programming principles to ensure maintainability,
readability, and correctness across the entire codebase. Every developer must understand
and apply these principles consistently in their daily work.

### Single Responsibility Principle
Each module, class, and function should have one and only one reason to change. This means
that a function should do one thing and do it well. If a function is doing multiple things,
it should be split into smaller functions. Each class should encapsulate a single concept
or responsibility. When a class starts to grow beyond its original purpose, consider
extracting new classes or modules.

### Open/Closed Principle
Software entities should be open for extension but closed for modification. This means
you should be able to add new functionality without changing existing code. Use interfaces
and abstract classes to define contracts. Implement new behavior by creating new
implementations rather than modifying existing ones. This reduces the risk of breaking
existing functionality when adding new features.

### Liskov Substitution Principle
Objects of a superclass should be replaceable with objects of its subclasses without
affecting the correctness of the program. This means that subclasses should not
strengthen preconditions, weaken postconditions, or violate invariants of the base class.
When designing class hierarchies, ensure that all subclasses can be used interchangeably
with their base class.

### Interface Segregation Principle
Clients should not be forced to depend on interfaces they do not use. Split large
interfaces into smaller, more specific ones so that clients only need to know about the
methods that are relevant to them. This leads to more decoupled and easier to maintain code.
Prefer many specific interfaces over a single general-purpose interface.

### Dependency Inversion Principle
High-level modules should not depend on low-level modules. Both should depend on
abstractions. Abstractions should not depend on details. Details should depend on
abstractions. Use dependency injection to provide implementations of interfaces to
classes that need them. This makes code more testable and flexible.

## Error Handling Standards

### Exception Handling
Always catch specific exceptions rather than generic ones. Never catch and silently
swallow exceptions. Log exceptions with full stack traces and context information.
Use custom exception types for domain-specific errors. Include relevant data in exception
messages to aid debugging. Prefer returning error objects over throwing exceptions for
expected failure cases.

### Validation
Validate all external input at system boundaries. Use validation libraries for complex
validation rules. Return clear, actionable error messages for validation failures.
Distinguish between client errors and server errors. Implement input sanitization to
prevent injection attacks. Validate configuration values at startup.

### Retry Logic
Implement retry with exponential backoff for transient failures. Set maximum retry
counts to prevent infinite loops. Use circuit breaker patterns for external service
calls. Log retry attempts for debugging purposes. Configure retry behavior per operation
type. Implement jitter to prevent thundering herd problems.

## Testing Requirements

### Unit Tests
Write unit tests for all business logic. Use descriptive test names that explain the
expected behavior. Follow the Arrange-Act-Assert pattern. Mock external dependencies.
Test edge cases and error conditions. Maintain test isolation to prevent test
interdependencies. Keep tests fast and deterministic.

### Integration Tests
Test interactions between components. Use real database connections with test data.
Clean up test data after each test run. Test API endpoints with realistic requests.
Verify error responses and status codes. Test authentication and authorization flows.
Include performance assertions for critical paths.

### End-to-End Tests
Test critical user journeys from start to finish. Use page object patterns for UI
tests. Handle asynchronous operations properly. Set up test fixtures for consistent
initial state. Run tests in headless browser mode in CI. Include visual regression
tests for key UI components. Test across multiple browsers and screen sizes.

## Code Style Guidelines

### Naming Conventions
Use camelCase for variables and functions. Use PascalCase for classes and interfaces.
Use UPPER_SNAKE_CASE for constants. Use descriptive names that reveal intent. Avoid
abbreviations unless universally understood. Prefix boolean variables with is, has,
should, or can. Use verb phrases for function names and noun phrases for variable names.

### Function Design
Keep functions short and focused. Limit parameters to three or fewer. Use object
parameters for complex configurations. Return early to avoid deep nesting. Avoid
side effects in pure functions. Document complex algorithms with comments.

### File Organization
Group related functionality in the same directory. Keep files under 300 lines.
One export per file for major components. Use index files for public API surfaces.
Separate concerns into distinct modules. Use consistent file naming patterns.

## Database Conventions

### Query Patterns
Use parameterized queries exclusively to prevent SQL injection attacks. Implement
pagination for all list queries using cursor-based pagination. Index all foreign key
columns and frequently queried columns. Use database transactions for operations that
modify multiple tables. Implement optimistic locking for concurrent modifications.
Use read replicas for reporting queries.

### Migration Standards
Write reversible migrations whenever possible. Never modify existing migration files
after they have been applied. Test migrations against production-like data volumes.
Include data migration scripts when schema changes affect existing data. Document
breaking changes in migration files. Coordinate migrations with deployment schedules.

### Data Integrity
Implement foreign key constraints at the database level. Use check constraints for
business rules that can be expressed in SQL. Implement soft deletes for auditable
entities. Maintain audit trails for sensitive data modifications. Validate data
integrity with periodic consistency checks. Back up data before running destructive
migrations.

## API Design Standards

### REST Conventions
Use plural nouns for resource endpoints. Use HTTP methods correctly: GET for reads,
POST for creates, PUT for full updates, PATCH for partial updates, DELETE for removals.
Return appropriate HTTP status codes. Include pagination metadata in list responses.
Support filtering, sorting, and field selection. Version APIs in the URL path.

### Response Format
Use consistent JSON response envelopes. Include request IDs in all responses for
tracing. Return detailed error objects with error codes, messages, and field-level
errors. Support content negotiation for multiple response formats. Include hypermedia
links for resource discovery. Document all response fields in API specifications.

### Authentication and Authorization
Use JWT tokens for API authentication. Implement token refresh mechanisms. Use role-based
access control for authorization. Audit all authentication attempts. Implement rate
limiting per API key and per IP address. Use HTTPS exclusively for all API endpoints.

## Security Requirements

### Input Validation
Sanitize all user input to prevent XSS attacks. Validate request bodies against schemas.
Reject requests with unexpected fields. Implement content type validation. Limit request
body sizes to prevent denial of service. Validate file uploads for type and size.

### Data Protection
Encrypt sensitive data at rest using AES-256. Use TLS 1.3 for data in transit.
Hash passwords using bcrypt with appropriate work factors. Never log sensitive data
including passwords, tokens, and personally identifiable information. Implement data
masking for sensitive fields in non-production environments. Rotate encryption keys
according to security policy.

### Access Control
Implement principle of least privilege for all system components. Use role-based access
control with clearly defined roles and permissions. Audit all access to sensitive resources.
Implement multi-factor authentication for administrative access. Review access permissions
quarterly. Automate permission revocation for departing team members.

## Logging and Observability Standards

### Structured Logging
All log entries must use structured JSON format with mandatory fields including timestamp,
correlation ID, service name, log level, and message. Use the centralized logging library
from the shared infrastructure package for consistency across all services. Log entries at
appropriate levels: DEBUG for detailed diagnostic information during development, INFO for
routine operational events like request handling and job processing, WARN for recoverable
issues that may indicate degraded service, ERROR for failures that prevent operation
completion, and FATAL for unrecoverable errors requiring immediate attention. Include
relevant business context in log entries such as user ID, tenant ID, operation name, and
resource identifiers to facilitate troubleshooting and audit trail generation.

### Metrics Collection
Instrument all critical code paths with custom metrics using the Prometheus client library.
Track request latency distributions using histograms with appropriate bucket configurations
for each endpoint type. Monitor error rates with counters labeled by error type, endpoint,
and HTTP status code. Record business metrics including order processing rates, payment
success rates, inventory update frequencies, and user activity patterns. Set up Grafana
dashboards for each service with standard panels showing request rate, error rate, latency
percentiles, and resource utilization. Configure alerting rules in Prometheus AlertManager
with escalation policies that match the severity and impact of each monitored condition.

### Distributed Tracing
Implement OpenTelemetry instrumentation for all inter-service communication paths. Propagate
trace context headers through HTTP requests, message queue messages, and background job
enqueue operations. Add custom span attributes for business-relevant information such as
operation type, affected entities, and processing stages. Configure sampling strategies
that capture all error traces and a representative sample of successful traces. Use the
Jaeger UI for trace visualization and analysis during incident investigation and performance
optimization. Document expected trace patterns for each critical business workflow to
facilitate comparison during debugging sessions.

## Deployment and Infrastructure

### Container Configuration
All services must be containerized using multi-stage Docker builds that separate build
dependencies from runtime dependencies. Base images must use the approved Node.js LTS
images from the organization's private container registry. Health check endpoints must be
implemented at /health/live for liveness probes and /health/ready for readiness probes.
Configure resource limits and requests in Kubernetes manifests based on load testing results.
Use ConfigMaps for environment-specific configuration and Secrets for sensitive values.

### CI/CD Pipeline
Every pull request triggers the full continuous integration pipeline including linting,
type checking, unit tests, integration tests, security scanning, and container image
building. Successful merges to the main branch automatically deploy to the staging
environment through ArgoCD GitOps workflows. Production deployments require manual
approval from at least one team lead and must be scheduled during the maintenance window.
Canary deployments release to five percent of traffic initially with automatic rollback
if error rates exceed baseline thresholds within the observation period.
