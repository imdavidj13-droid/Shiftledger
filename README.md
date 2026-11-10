# ShiftLedger

Web-first workforce scheduling and timesheets SaaS for international small and medium organisations.

## Product goals

- Multi-organisation scheduling with strict organisation isolation.
- Shift planning, publishing, timesheets, leave, swaps and payroll CSV exports.
- Clear fixed-fee organisation pricing rather than per-employee billing, subject to sustainable plan limits.
- International support: IANA time zones, UTC timestamps, locale-aware dates and currencies.
- Public API and mobile apps in later phases.

## Initial stack

React, TypeScript, Vite; Cloudflare Workers + Hono; Cloudflare D1.

## Local development and deployment

Use Node 24. Run `npm ci`, then follow [the deployment runbook](docs/DEPLOYMENT.md) for local development, tests, staging and the production release gate. See [implementation status](docs/IMPLEMENTATION_STATUS.md) for verified features and remaining launch requirements.

## Stable application URLs

Each authenticated module has a persistent URL: `/app/:organisationId/overview`, `/schedule`, `/team`, `/timesheets`, `/leave`, `/shift-swaps`, `/reports`, and `/settings` (with the same `/app/:organisationId/` prefix). Real anchor links support bookmarking, reload, and browser history. Organisation membership is always checked server-side. New routes should never rely only on React component state.

## Multi-location businesses

One organisation can operate many branches using the same application and shared team directory. The onboarding flow can create several branches at once, and employees can be assigned to multiple sites. Branch managers have scoped access at the API layer. The Access screen manages private invitation links and memberships. The Locations screen manages branch assignments and lifecycle. Tenant and branch access have automated regression coverage.

Production D1 migrations are applied separately after staging verification and approval. See [the deployment runbook](docs/DEPLOYMENT.md).
