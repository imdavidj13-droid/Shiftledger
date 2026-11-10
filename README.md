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

## Cloudflare Workers Builds (GitHub deployment)

In **Workers & Pages → shiftledger → Settings → Builds**, configure:

- **Build command:** `npm run build`
- **Deploy command:** `npx wrangler deploy`
- **Root directory:** repository root (`/`)
- **Production branch:** `main`

The build command is required: `wrangler.jsonc` deploys the Vite-generated `dist/` folder, which does not exist until the frontend is built. Cloudflare Workers Builds does **not** honor a custom build command from the Wrangler configuration, so set the Build command in Cloudflare's dashboard (or use **`npm run deploy`** as the deploy command, which builds before deploying).

Apply the schema to the production database separately before enabling data endpoints:

```bash
npm run db:migrate:remote
```

The initial dashboard remains a preview. Authentication, workforce CRUD, and permissions are not operational yet.

### Cloudflare build troubleshooting

If saving Workers Builds settings does not start a new run, push a commit to the configured production branch (`main`). The deploy command `npm run deploy` builds the frontend before calling Wrangler, preventing the `assets.directory` missing `dist` error. Confirm new logs include `npm run deploy` and Vite output.
