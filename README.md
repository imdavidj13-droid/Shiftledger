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

## Local start

```bash
npm install
npm run dev
```

To run the API separately: `npm run dev:api`.

**Security:** Until authentication and organisation membership checks are implemented, API routes must be limited to public health/status endpoints. Do not store real workforce data yet.

See `docs/PRODUCT_BLUEPRINT.md` for scope and release stages.
