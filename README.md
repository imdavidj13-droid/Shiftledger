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

**Security:** Authentication and initial organisation membership checks exist, but full permission and cross-tenant test coverage is still required. Do not onboard real customer or employee data before completing security reviews.

See `docs/PRODUCT_BLUEPRINT.md` for scope and release stages.

## Cloudflare Workers Builds (GitHub deployment)

In **Workers & Pages → shiftledger → Settings → Builds**, configure:

- **Build command:** `npm run build`
- **Deploy command:** `npm run deploy` (builds assets again as a safety measure)
- **Root directory:** repository root (`/`)
- **Production branch:** `main`

The build command is required: `wrangler.jsonc` deploys the Vite-generated `dist/` folder, which does not exist until the frontend is built. Cloudflare Workers Builds does **not** honor a custom build command from the Wrangler configuration, so set the Build command in Cloudflare's dashboard (or use **`npm run deploy`** as the deploy command, which builds before deploying).

Apply the schema to the production database separately before enabling data endpoints:

```bash
npm run db:migrate:remote
```

The application now has registration, email verification, onboarding, initial multi-location employee/location records and draft-shift APIs. These features are still in development and are not a commercially ready product. See `docs/ROUTES_AND_MULTI_LOCATION.md`, `docs/AUTH_UX_FLOW.md` and `docs/REGISTRATION_TEST_PLAN.md`.

### Cloudflare build troubleshooting

If saving Workers Builds settings does not start a new run, push a commit to the configured production branch (`main`). The deploy command `npm run deploy` builds the frontend before calling Wrangler, preventing the `assets.directory` missing `dist` error. Confirm new logs include `npm run deploy` and Vite output.

## Stable application URLs

Each authenticated module has a persistent URL: `/app/:organisationId/overview`, `/schedule`, `/team`, `/timesheets`, `/leave`, `/shift-swaps`, `/reports`, and `/settings` (with the same `/app/:organisationId/` prefix). Real anchor links support bookmarking, reload, and browser history. Organisation membership is always checked server-side. New routes should never rely only on React component state.

## Multi-location businesses

One organisation can operate many branches using the same application and shared team directory. The onboarding flow can create several branches at once, and employees can be assigned to multiple sites. Branch managers have scoped access at the API layer. Location manager invitations/assignment screens and full automated cross-tenant tests are still planned.

**Important:** Apply `0003_multilocation.sql` to the production D1 database before creating an organisation with the updated onboarding form:

```bash
npm run db:migrate:remote
```
