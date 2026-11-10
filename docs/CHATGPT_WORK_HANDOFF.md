# ShiftLedger — ChatGPT Work execution handoff

## CURRENT USER PRIORITY — COMPLETE P0, P1, P2 AND P3 TO 100%

The user has explicitly directed that **everything up to and including P3 must be fully finished and verified**, before P4–P6. See the new **ACTIVE DEVELOPMENT MILESTONE** section at the top of `docs/FEATURE_BACKLOG.md`. Treat its four detailed phase exit gates as a binding checklist; do not declare 100% until every requirement has real persistence, correct role/organisation/location permissions, working UI, stable URLs, automated tests and successful deployed smoke verification. Implement as many complete vertical slices as tooling/session permits and document remaining incomplete tasks transparently.

**Updated GitHub workflow:** Work directly on `main`. Do not create GitHub branches or PRs unless the user explicitly changes that requirement. Run typecheck, build, API and browser tests BEFORE pushing each cohesive change, not after; never push known failures. Cloudflare uses production builds from `main`, with preview builds disabled. The user does not want a separate staging Worker or D1 database. For new D1 schema, prepare safe additive migrations, test against a disposable *local* test database and ask before running them against production, with an existing backup/recovery checkpoint. Preserve existing organisation data and live sessions. Read `docs/DEPLOYMENT.md`.

Current repo has initial weekly rota including a recently added duplicate-as-draft UI; that last commit's deployed build was not independently confirmed. Verify the existing implementation and CI state rather than assuming it works. Priorities: finish P0/P1 outstanding acceptance items, then complete all remaining P2 rota/notifications and P3 clocking/timesheets/availability/leave/swaps. Update documentation only alongside genuine code/test progress.


Repository: https://github.com/imdavidj13-droid/Shiftledger
Main roadmap: docs/FEATURE_BACKLOG.md
Other required reading: README.md, docs/PRODUCT_BLUEPRINT.md, docs/DESIGN_SYSTEM.md, docs/ROUTES_AND_MULTI_LOCATION.md, docs/AUTH_UX_FLOW.md, docs/REGISTRATION_TEST_PLAN.md, docs/RESEND_DEV_TEST_SETUP.md.

You are taking over implementation of ShiftLedger, a React + TypeScript + Vite / Hono + Cloudflare Workers + D1 web-first international workforce SaaS. Use the connected GitHub repository and coding/computer capabilities in ChatGPT Work. Do extensive implementation, not merely advice or a plan.

FIRST: audit the repo and all relevant docs, discover what exists and works, report conflicts between docs and code. Preserve the live verified user and their existing David's Shop organisation. Confirm current CI/deploy state. Do not assume a prior assistant's declaration of 'done' proves anything.

Do P0 stabilisation immediately: produce a reproducible clean install/typecheck/build/test workflow, fix any compile/runtime issues, add automated tests for auth, tenant isolation, Hono wildcard routing, browser refresh, sessions and multi-location permissions, a GitHub Actions CI gate and safe staging setup. Prevent broken commits and untested changes from reaching production. Do not change production D1 or Worker secrets without approval.

Then implement as much of P1 and onward in docs/FEATURE_BACKLOG.md as feasible, following its order and acceptance gates. Favour complete working vertical slices of staff invitations, location management, staff assignment, scheduling calendars/shifts/publishing, timesheets, leave, swaps, reporting, API docs and billing scaffolding, not fake functionality. Build comprehensive API security for each domain and real D1 persistence.

Locked design: bold forest green, solid lime and ivory/white; no transparency, opacity effects, shadows, gradients or glass effects anywhere without explicit user request. Stable, direct, refresh-safe URLs for every module and detail page, including branch filters. Multi-location businesses use one organisation, shared employee identities and organisation-wide subscription; managers only see assigned branches; employees may serve several branches; timezone correctness and DST are mandatory.

Engineering rules: work on an isolated branch/PR where available, run npm ci, npm run typecheck, npm run build and relevant tests before pushing, add tests and migrations, keep production account/data intact, never add secrets to git, never replace D1 with fake local storage, and do not deploy failing builds. Check exact config, schema and code instead of guessing. No broad refactoring without tests. Read current tool/package capabilities and add narrowly necessary dependencies only.

If blocked by provider setup, credentials, destructive operations, payment activation or missing account permissions, do not invent success and do not stop unrelated implementation. Document the blocker and continue safe tasks. Explicitly ask for approval before production schema changes, billing charges, security-sensitive operations or deleting data.

Keep docs/FEATURE_BACKLOG.md updated with verified progress and create docs/IMPLEMENTATION_STATUS.md showing completed tasks, test commands/results, commits/PR, deployment state, next blockers and priorities. Continue with as much practical implementation as possible in this Work session; do not stop at a proposed roadmap. At the end distinguish implemented+tested from implemented+untested and planned.

User context: the site is currently accessible at https://shiftledger.imdavidj13.workers.dev; current name is provisional, and there is no final domain yet. Registration email uses Resend's test sender, limited to an authorised test inbox. Product pricing direction is low fixed organisation tiers (possibly £5/£10/£15) but prices and limits are unvalidated. A recent deployment series broke due to JSX, missing D1 role context and organisation collection routing; regression testing is therefore the top priority.
