# ShiftLedger deployment and recovery

## Validate locally

Use Node 24 and run from the repository root.

```sh
npm ci
npx playwright install --with-deps chromium
npm run verify
node scripts/deploy.mjs --dry-run --outdir .wrangler/verified-build
```

The full suite tests the production build in a local Worker with disposable D1. It also starts a second disposable database at migration 0005 and checks that the current Worker keeps existing account and scheduling operations available while the new feature migrations are pending. Both databases are removed after the run.

For interactive work, run `npm run db:migrate:local`, build once, then run `npm run dev:api` and `npm run dev` in separate terminals. Vite proxies API calls to the local Worker.

## GitHub and Cloudflare Builds

Commit tested changes directly to `main`. GitHub Actions runs the same verification and a Wrangler dry-run. Keep the Cloudflare production branch on `main` and turn off **Enable Preview Builds** in **Workers & Pages → shiftledger → Settings → Builds → Branch control**. The Wrangler setting `preview_urls: false` controls Worker version URLs. The existing sentinel configuration is for the disposable test runner. This workflow uses no hosted staging Worker or D1.

Configure Cloudflare Workers Builds to use Node 24, build with `npm run build` and deploy with `npm run deploy`. The deploy script uses the Git SHA supplied by Workers Builds to tag the Worker version. On a clean local checkout it can use Git directly. The live health endpoint returns that tag and the Cloudflare Worker version ID. GitHub Actions tests the repository commit independently from the Cloudflare build. The dashboard branch controls and production account settings require account access.

See [Cloudflare Workers Builds environment variables](https://developers.cloudflare.com/changelog/post/2025-06-10-default-env-vars/) and [Worker version metadata](https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/).

## Prepare an approved production migration

1. Read the active Worker release and pending migrations with `npx wrangler deployments list` and `npx wrangler d1 migrations list DB --remote`. Record the current Worker version ID as the rollback target.
2. Record a D1 recovery bookmark with `npx wrangler d1 time-travel info DB`. Keep the bookmark and any approved SQL backup in restricted storage. Confirm the recovery window and record who will authorise a restore. See [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).
3. Review the exact pending migration names with the owner, and obtain explicit approval for that set. Production deployment and the normal CI checks do not run D1 migrations.
4. After approval, run `npm run db:migrate:remote` from the approved clean revision and check the pending list again. Follow the operation with the read-only smoke below, then verify an authorised owner session and the existing organisation. Check access with the appropriate scoped accounts before declaring the workflows live.

## Verify a production release

```sh
npm run smoke -- <full-expected-commit-sha>
```

The command checks the live commit and Worker version ID, D1 readiness, the signed-out auth and organisation API responses, and the HTML fallback for a bookmarked calendar route. Readiness lists which feature schemas are present. If the smoke fails, check the Workers Builds status and use the request ID from the failing API response to correlate structured Worker logs. Sign-in, provider email delivery and authenticated workflows require an authorised account and separate verification.

## Recovery

Roll the Worker back to the recorded compatible version if the deployment fails. A Worker rollback leaves the D1 schema at its current version. Prefer a tested forward fix for additive schema changes. A production Time Travel restore overwrites the database in place and discards writes after the selected bookmark. It requires separate explicit authorisation and a coordinated write freeze. Rehearse recovery and verify retained user, organisation and schedule records on disposable local data before any production restore.
