# Deploy to Staging

Run the full deployment pipeline to the staging environment.

## Steps
1. Run `npm run build` to create production builds
2. Run `npm run test` to verify all tests pass
3. Run `npm run db:migrate` to apply any pending migrations
4. Run `docker compose -f docker-compose.staging.yml up -d --build`
5. Run `npm run test:e2e -- --config=staging` to verify deployment

Report the results of each step. If any step fails, stop and report the error.
