# ShiftLedger deployment and recovery

## Local validation

Use Node 24. From the repo root run:

```sh
npm ci
npx playwright install --with-deps chromium
npm run verify
npx wrangler deploy --dry-run --outdir .wrangler/verified-build
```

`verify` typechecks, builds and runs Playwright against the production bundle served by a real local Worker. The test runner applies every migration to a temporary D1 database, seeds synthetic fixtures, and removes the temporary database on exit. The local staging template contains a sentinel database UUID.

For interactive work, run `npm run db:migrate:local`, build once, then run `npm run dev:api` and `npm run dev` in separate terminals. Vite proxies same-origin API calls to the local Worker.

## Hosted staging

1. Create a dedicated D1 database named `shiftledger-staging-db` using the Cloudflare account. Assign its UUID to the shell environment variable `SHIFTLEDGER_STAGING_DB_ID`. The staging script rejects the production UUID and the template sentinel.
2. Run `npm run staging -- list`, then `npm run staging -- migrate` to apply the checked-in migrations to staging.
3. Run `npm run staging -- deploy`. This runs local verification before deploying `shiftledger-staging`.
4. Configure staging-only `APP_URL`, sender and test-recipient settings through Cloudflare when testing delivery. Keep production secrets out of the staging Worker.
5. Smoke-test staging `/api/v1/health`, `/api/v1/ready`, a signed-out workspace deep link, a verified fixture owner, multiple locations, invitations, and the restricted manager and employee roles.

## No Cloudflare preview builds (current project policy)

Cloudflare preview builds are controlled in the **Cloudflare dashboard**, not by `preview_urls: false` and not by GitHub Actions configuration. For this project, the owner chose **no separate staging Worker or staging D1**. Do not configure `wrangler.previews` using the production D1 binding.

In Cloudflare: **Workers & Pages → shiftledger → Settings → Builds → Branch control → uncheck Enable Preview Builds → Save**. Keep the production branch set to `main`. GitHub Actions PR checks still run independently, using local ephemeral test databases, and should be green before merge.

The earlier PR build errors (missing `previews` block) came from Cloudflare trying to run `wrangler preview` on a non-production branch; turning off preview builds stops that workflow. `preview_urls: false` merely disables version URLs and does not disable PR preview builds.

This dashboard setting cannot be applied by committing a Wrangler file. **Verify the checkbox has been disabled before merging**. Without a staging environment, do all development checks locally and in CI and make a recorded production D1 backup before authorised migrations. Never give a preview access to production secrets or D1. A merge to `main` may automatically deploy the Worker; inspect and rehearse outstanding additive migrations and check the production build command/runtime first.

## Production release gate

Use `main` as the production branch. In GitHub require **Build, migrations and regression tests** before merge. In Cloudflare Workers Builds disable non-production branch deployments for this Worker. Use the separate staging Worker for preview data and auth tests. Dashboard settings require account access.

The production deploy script requires `npm run verify` to succeed before Wrangler uploads anything. For Cloudflare Workers Builds, provision Node 24 and a Playwright Chromium runtime with its system libraries before using `npm run deploy` as the deploy command. Confirm these prerequisites in staging before enabling automatic production deployment. Both deployment configs keep existing runtime variables and separate D1 bindings.

Before any authorised production release:

1. Record the exact GitHub commit and current Cloudflare deployment/version ID with the read-only `npx wrangler deployments list` command. Check production migration status with `npx wrangler d1 migrations list DB --remote` and confirm the D1 recovery checkpoint. Verify the existing owner and organisation using authorised credentials.
2. Rehearse additive migrations on staging, and apply the reviewed production migration in a separate authorised step. The deploy command does not apply remote migrations.
3. After deploying, check health and readiness, browser refresh on an authorised deep link, and signed-out API status. Verify the existing owner can still open the same organisation. Keep the prior version ID as the rollback target.
4. If the application fails, roll back to the recorded compatible Worker version using Cloudflare. A Worker rollback does not undo D1 schema changes. Keep additive migrations in place or ship a forward fix after rehearsing it. Rehearse D1 recovery on a separate environment and record the recovery result.

## Baseline observed on 10 November 2026

The production endpoint served JSON liveness, JSON 401 for signed-out auth and organisation requests, and HTML for a direct workspace route. The public endpoint does not identify the deployed commit or verify D1 schema or the owner session. The last build-success commit observable in GitHub at the start of this work was `dce7232`; record the verified Cloudflare version separately.
