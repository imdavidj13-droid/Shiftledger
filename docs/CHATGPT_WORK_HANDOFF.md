# ShiftLedger — ChatGPT Work execution handoff

## LATEST SCHEDULING AND PLATFORM-SCOPE INSTRUCTIONS

**Business-side development is the current project.** Do not build the standalone employee/worker-facing UI in this development batch. Design secure staff-facing API permissions in P0–P3, but after the business-side phases are 100% complete, plan and build the separate employee experience on the same backend and shared employee identities. The worker-facing web/mobile journeys will later include personal schedule, open shift claims, availability, time clock, timesheets, leave, swaps, notifications and profile.

**P2 scheduling UI is not complete until the Schedule page has a real clickable monthly calendar as well as the weekly view.** Add a visible Week / Month switch and preserve the view, month/week and location in refresh-safe links and browser history. The month grid must show real scheduled shifts, open vacancies and overflow; a day cell opens its day schedule; a shift opens shift detail. Support previous/next month, today, time zones and responsive layout.

**Open shifts are also mandatory now.** Manager/owner creation, publication, visibility on weekly/monthly/day calendars, and eligibility/approval of staff claims need end-to-end D1 and secure APIs. An unassigned draft is NOT automatically a published open shift. Protect against concurrent claims, access/branch violations and shift conflicts. Business-side claim review UI belongs in this batch; a purpose-built employee self-service UI belongs to the later worker-side milestone.

**Workflow:** Commit only on `main` after local typecheck/build/tests; do not create branches or PRs. Keep this scoped to P0–P3 business-side functionality.

## CURRENT USER PRIORITY — COMPLETE P0, P1, P2 AND P3 TO 100%

The user has explicitly directed that **everything up to and including P3 must be fully finished and verified**, before P4–P6. See the new **ACTIVE DEVELOPMENT MILESTONE** section at the top of `docs/FEATURE_BACKLOG.md`. Treat its four detailed phase exit gates as a binding checklist; do not declare 100% until every requirement has real persistence, correct role/organisation/location permissions, working UI, stable URLs, automated tests and successful deployed smoke verification. Implement as many complete vertical slices as tooling/session permits and document remaining incomplete tasks transparently.

**Updated GitHub workflow:** Work directly on `main`. Do not create GitHub branches or PRs unless the user explicitly changes that requirement. Run typecheck, build, API and browser tests BEFORE pushing each cohesive change, not after; never push known failures. Cloudflare uses production builds from `main`, with preview builds disabled. The user does not want a separate staging Worker or D1 database. For new D1 schema, prepare safe additive migrations, test against a disposable *local* test database and ask before running them against production, with an existing backup/recovery checkpoint. Preserve existing organisation data and live sessions. Read `docs/DEPLOYMENT.md`.

Current repo has initial weekly rota including a recently added duplicate-as-draft UI; that last commit's deployed build was not independently confirmed. Verify the existing implementation and CI state rather than assuming it works. Priorities: finish P0/P1 outstanding acceptance items, then complete all remaining P2 rota/notifications and P3 clocking/timesheets/availability/leave/swaps. Update documentation only alongside genuine code/test progress.


Repository: https://github.com/imdavidj13-droid/Shiftledger
Main roadmap: docs/FEATURE_BACKLOG.md
Other required reading: README.md, docs/PRODUCT_BLUEPRINT.md, docs/DESIGN_SYSTEM.md, docs/ROUTES_AND_MULTI_LOCATION.md, docs/AUTH_UX_FLOW.md, docs/REGISTRATION_TEST_PLAN.md, docs/RESEND_DEV_TEST_SETUP.md.

You are taking over implementation of ShiftLedger, a React + TypeScript + Vite / Hono + Cloudflare Workers + D1 web-first international workforce SaaS. Use the connected GitHub repository and coding/computer capabilities in ChatGPT Work. Do extensive implementation, not merely advice or a plan.

FIRST: audit the repo and all relevant docs, discover what exists and works, report conflicts between docs and code. Preserve the live verified user and their existing David's Shop organisation. Confirm current CI/deploy state. Do not assume a prior assistant's declaration of 'done' proves anything.

Do P0 stabilisation immediately: verify reproducible clean install/typecheck/build/test workflow, resolve any runtime issues, maintain automated auth/tenant/routing tests and GitHub Actions CI. The user declined a separate hosted staging Worker/D1; use disposable local test D1 only. Prevent broken commits and untested changes from reaching production. Do not change production D1 or Worker secrets without approval.

Then implement as much of P1–P3 in docs/FEATURE_BACKLOG.md as feasible, following its order and acceptance gates. Focus on business-side invites, location and staff management, weekly and monthly schedules, open shifts, publishing, timesheets, leave and swaps. Do not advance to P4–P6 or build the separate worker-facing interface yet. Build comprehensive API security for each domain and real D1 persistence.

Locked design: bold forest green, solid lime and ivory/white; no transparency, opacity effects, shadows, gradients or glass effects anywhere without explicit user request. Stable, direct, refresh-safe URLs for every module and detail page, including branch filters. Multi-location businesses use one organisation, shared employee identities and organisation-wide subscription; managers only see assigned branches; employees may serve several branches; timezone correctness and DST are mandatory.

Engineering rules: work directly on main without branches or PRs, run npm ci, npm run typecheck, npm run build and relevant tests before pushing, add tests and migrations, keep production account/data intact, never add secrets to git, never replace D1 with fake local storage, and do not deploy failing builds. Check exact config, schema and code instead of guessing. No broad refactoring without tests. Read current tool/package capabilities and add narrowly necessary dependencies only.

If blocked by provider setup, credentials, destructive operations, payment activation or missing account permissions, do not invent success and do not stop unrelated implementation. Document the blocker and continue safe tasks. Explicitly ask for approval before production schema changes, billing charges, security-sensitive operations or deleting data.

Keep docs/FEATURE_BACKLOG.md updated with verified progress and create docs/IMPLEMENTATION_STATUS.md showing completed tasks, test commands/results, commits/PR, deployment state, next blockers and priorities. Continue with as much practical implementation as possible in this Work session; do not stop at a proposed roadmap. At the end distinguish implemented+tested from implemented+untested and planned.

User context: the site is currently accessible at https://shiftledger.imdavidj13.workers.dev; current name is provisional, and there is no final domain yet. Registration email uses Resend's test sender, limited to an authorised test inbox. Product pricing direction is low fixed organisation tiers (possibly £5/£10/£15) but prices and limits are unvalidated. A recent deployment series broke due to JSX, missing D1 role context and organisation collection routing; regression testing is therefore the top priority.
