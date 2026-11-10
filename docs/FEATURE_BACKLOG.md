# ShiftLedger — Master product roadmap and execution plan
Updated 10 November 2026. This is the primary implementation backlog for ChatGPT Work and future development sessions. Align with docs/PRODUCT_BLUEPRINT.md, DESIGN_SYSTEM.md, ROUTES_AND_MULTI_LOCATION.md, AUTH_UX_FLOW.md and REGISTRATION_TEST_PLAN.md.

## Mission and locked product decisions
Deliver a commercially viable, web-first, international multi-tenant workforce management SaaS for SMBs/SMEs, with native mobile apps later. One business is one organisation; one organisation can have many locations, shared employees, managers and settings, under one proposed flat-fee subscription. Proposed low-cost £5/£10/£15 tiers are hypotheses, not final promises; test unit economics and fair-use boundaries before offering them. Keep the scope focused on scheduling, staff, timesheets, leave, swaps and payroll-hours export. Public API from the foundation, rather than retrofitting it later.

**Non-negotiable visual rules:** Bold forest green, bright lime and solid ivory/white backgrounds; 100%-opaque fills; absolutely no translucency, alpha overlays, shadows, blurred overlays, gradients or glassmorphism unless the owner explicitly asks. Distinct layouts should feel designed, accessible and mobile responsive.

**Non-negotiable routing:** Every screen and entity-detail view needs a real stable deep URL, reload-safe and browser-history-safe. Current pattern: `/app/:organisationId/:module`; filtered location is a query parameter. Never build navigation as state-only switches. Support direct links, back/forward, refresh, signed-out return URLs, 403 and 404 pages.

**Non-negotiable data policy:** Cloudflare D1 is canonical; no localStorage-as-database, simulated business data or invented production statistics. Never delete or overwrite existing customers, organisations, sessions or deployment secrets as part of routine development.

## Current status — observed versus not verified
Observed through screenshots and reports: registration, email verification with Resend development sender, login, new three-step organisation onboarding and an owner dashboard have worked at least once; the owner created a test organisation, and the app was restored after URL/middleware/session defects. Code in the repository implements early location/staff/shift API endpoints, initial role checks, deep-link routing and preview pages. These observations **do not prove** complete business readiness.

Unverified or incomplete: production migration state across environments; automated clean-install build; isolated test database; comprehensive tenant/branch authorisation; manager invitation UI; branch-specific timezone form; robust shift CRUD/publishing; reports; full timesheets, leave, swaps, payroll exports; true billing; API documentation; CI/deploy gates. Some screens remain placeholders. Do not claim any item as completed without a passing test or reproducible verification.

## Verified implementation update

See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for the tested scope and [DEPLOYMENT.md](DEPLOYMENT.md) for deployment gates. Local Workers and D1 tests cover session persistence, tenant and branch isolation, migration smoke, browser history and mobile branch detail. Location lifecycle, branch manager grants, atomic staff assignment, private invitation links, membership suspension, personal profile editing and the weekly rota with draft editing, publishing and cancellation are implemented. Published shifts are visible to their assigned employees. Hosted staging, production D1 history, live owner sign-in, and provider delivery are still separate gates.

## Priority P0 — Stabilise the product and deployments FIRST (blocking all features)
- [ ] Inspect repo, dependencies, scripts, Worker/D1 bindings and current deployments; document exact current state and blockers. Preserve existing production D1, account and `David's Shop` test organisation.
- [x] Establish a repeatable local `npm ci`, `npm run typecheck`, `npm run build` and automated API/test command. Fix TypeScript, lint, formatting, runtime errors and unstable dependencies. No unverified commits.
- [ ] Add GitHub Actions CI: install, typecheck, build, unit/integration tests, migration smoke checks and failure gate. Do not push failing builds to production. Use protected branch / PR workflow where available and preserve a known-good deployment.
- [ ] Introduce staging/preview Worker + **separate** staging D1 and variables/secrets; no test write to production. Validate `keep_vars`, `vars`, `secret list` and Cloudflare deploy behaviour without logging credential values.
- [x] Reproduce and permanently test previous defects: PBKDF2 Cloudflare iteration limit, JSX syntax failure, wildcard Hono organisation role resolution, collection-route 404, session incorrectly cleared on API error, refresh/back/forward issues, build assets missing `dist`.
- [x] Diagnose any current 403/404 and make session and workspace errors actionable. Never log secrets, password values or verification tokens.
- [ ] Verify existing migration history, backups/restore, data integrity, rollback and forward-only migration strategy. No destructive or irreversible production migration without explicit approval.
- [ ] Capture production and Worker runtime exceptions with request IDs; add health checks, structured logs, safe diagnostics, deploy smoke tests and alerting strategy.
- [x] Add a short `docs/IMPLEMENTATION_STATUS.md` with exact command outcomes, finished areas, failing areas, environment limitations, pending manual steps and deployed commit.

**P0 acceptance:** automated CI green; app builds; existing owner can sign in, navigate, refresh and sign out; organisation-list and nested APIs return correct statuses; no regressions; preserved production data.

## Priority P1 — Identity, onboarding, roles and locations
- [ ] Complete secure email/password registration, verification, resend, login, logout, sessions, reset and recovery states; test actual provider failure, idempotency and reused/expired tokens; support password manager autofill. Re-evaluate the current custom password hashing against current password-storage guidance; migrate safely and transparently with legacy support if needed.
- [ ] Complete account profile and email-change workflows, account deletion and export, security preferences and optional MFA/passkeys later. Distinguish personal user identity from legal organisation identity.
- [ ] Complete three-step organisation onboarding (business name, industry, team size, country; scheduling week start/currency/time zone/format; branches). Use approachable selectors and country-appropriate defaults; validate internationally. For multiple branches, allow per-branch IANA zone and normal location metadata. The limit of 20 should be a *single onboarding batch limit*, never a business-wide cap.
- [ ] Add organisation editing, friendly slug/URL strategy without sacrificing stable IDs; week-start/time format settings, currency update policy, organisation archive and owner transfer.
- [ ] Add first-class location list/detail/create/edit/archive/restore and branch-specific settings, opening hours, working patterns and default scheduling controls. One organisation may have many branches without new accounts or charges per branch.
- [ ] Invitation lifecycle: invite/resend/revoke/accept, pending/expired, existing-user joins, account recovery; org owner/admin/manager/employee roles; owner transfer; scoped invitation permissions.
- [x] Branch manager assignment/revocation in UI and API, with explicit access to one or many locations. Owner/admin organisation-wide access; manager assigned branches only; employee own authorised records only. No role inheritance by URL or frontend.
- [ ] One employee profile with many employee-location assignments; primary home location, optional secondary locations; inactive/archive, joining/leaving, employment fields, positions/departments, emergency/contact details only when lawful and necessary.
- [x] Prevent scheduling staff in branches to which they have not been assigned; prevent conflicting shifts across **all** branches. Location-level filtering must not inadvertently expose records outside permissions.
- [x] End-to-end onboarding and invitation acceptance tests, with API checks for tenant, role and location boundaries in the implemented routes.

**P1 acceptance:** two organisations and three branches with staff/manager permissions have been exercised in an isolated environment; unauthorised cross-org/cross-branch calls are refused; owner and authorised manager views work; browser refresh/deep links remain correct.

## Priority P2 — Scheduling, rotas and notifications
- [x] Weekly rota UI (desktop and mobile), permanent week and shift URLs, location filtering, time zones and DST, using D1 records.
- [ ] Additional day/list/month views and team or role filters.
- [x] Create, edit and discard draft shifts with unpaid breaks and concurrent-edit protection.
- [ ] Duplicate shifts, recurring patterns, shift templates, copy week, bulk edits, skill/position requirements and shift notes.
- [x] Permissioned single-shift publishing and cancellation with revisions, audit events and employee visibility.
- [ ] Review state, updates to published shifts, bulk publishing and idempotent staff notifications.
- [ ] Conflict engine: overlapping shifts across locations, unavailability, approved leave, breaks, min/max hours, overtime warning, optional rest requirements, working-time rules as *configurable warnings* until jurisdiction-reviewed.
- [ ] Open/unassigned shifts, claims, manager approval and notifications; schedule visibility appropriate to role.
- [ ] User notifications centre: in-app and email templates, opt-in preferences, queued/retried/idempotent messages, digest modes, delivery/bounce diagnostics and quota observability.
- [ ] Employee personal schedule, calendar export (ICS), print/share/export and clear shift details. Avoid fake scheduling metrics.

**P2 acceptance:** owner/manager can publish multi-branch rota; assigned staff view their shifts; conflicts and notifications behave predictably; DST and overlap tests pass.

## Priority P3 — Timekeeping, leave and coverage
- [ ] Clock in/out, unpaid/paid breaks, corrections, missed punches, approval chain and edit reasons; audit events for all pay-relevant changes.
- [ ] Timesheet weekly/pay-period approval, lock/reopen, manager access scoped to branches, employee own time, rounding options, payroll cutoffs and export reproducibility.
- [ ] Availability, recurring patterns and exceptions; leave types (holiday, sick, unpaid, other), requests/approval, balances/accrual where verified for each country, holiday calendars.
- [ ] Shift swaps, offers, eligibility, staff requests and approvals; cross-branch eligibility and permission enforcement.
- [ ] Absence alerts and staffing gaps with appropriate privacy boundaries.

**P3 acceptance:** clock -> edit -> approve -> export with audit trail; leave and swaps affect schedule conflict checks; manager cannot approve unauthorised employees.

## Priority P4 — Reporting and payroll export
- [ ] Real operational dashboards: staffing, scheduled vs worked hours, attendance, absences, pending approvals, per-location and org-wide aggregates with precise access controls.
- [ ] Payroll-hours CSV mapping, configurable payroll periods, timezone/DST, breaks and rounding; exports only from approved timesheets. Add Excel/PDF later.
- [ ] Reports for labour hours/costs, budget comparison, exceptions and shift coverage; currency handling without conflating local pay rates and organisation reporting currency.
- [ ] Data imports/exports, validated CSV onboarding, duplicates detection, import dry-run and rollback capability.
- [ ] Accessible tables, filters, pagination, large datasets and indexed queries.

## Priority P5 — API, extensibility and developer operations (foundation must begin in P0/P1)
- [ ] Document versioned REST `/api/v1` with generated OpenAPI spec, schemas, examples, paginated/filterable endpoints, consistent error codes and request IDs.
- [ ] Server-side validation and authorisation centralised; rate limits, idempotency for writes, API token scope/rotation/revocation for future integrations, secure webhook signatures and retry policy.
- [ ] Comprehensive API tests (success, invalid data, 401/403/404, cross-tenant, location scope, concurrency and duplicate submissions), contract tests and safe API lifecycle/deprecation policy.
- [ ] Performance and scale: indexed D1 queries, pagination, queue processing, per-organisation limits, observability, abuse protections, load tests for hundreds/thousands of tenant organisations.
- [ ] Public API docs and developer access management only after core security tests pass.

## Priority P6 — Business, pricing and launch readiness
- [ ] Competitive research and practical unit economics for flat-fee per-organisation plans; employee/site usage thresholds, free trial, cancellation, VAT/tax treatment and customer expectations. No unvalidated unlimited claim.
- [ ] Subscription system (Stripe or selected provider) with verified webhooks, idempotency, billing portal, invoices, failed-payment handling and graceful feature entitlements.
- [ ] Platform owner/admin console separate from customer roles: tenant health, subscriptions, delivery logs, impersonation restrictions, support audit and incident operations. No unrestricted access to customer data.
- [ ] Marketing home page, features, pricing, industries, FAQs, onboarding, documentation, contact, support, terms, privacy, cookies and legal information. Final brand name and domain later; branding must be configurable.
- [ ] GDPR/UK GDPR baseline: lawful basis, processor arrangements, privacy/security controls, retention/deletion/export, breach response, data subject requests, access logs and cross-border transfer review. Employment law must be evaluated per jurisdiction; do not advertise universal compliance.
- [ ] Backup/restore drills, disaster recovery objectives, incident response, email domain verification, deliverability, uptime/status, security review and penetration testing before onboarding real customers.
- [ ] PWA/offline strategy with explicit sync/conflict safeguards; native apps later.
- [ ] Integration roadmap: Xero, Sage, QuickBooks, BrightPay, Gusto and optional payroll providers based on validated demand.

## Architecture and engineering standards
- React + TypeScript + Vite frontend; Hono on Cloudflare Workers backend; Cloudflare D1 with additive versioned migrations. Use maintained, well-documented libraries appropriately; avoid unnecessary platform migrations.
- Single canonical tenant identity and reliable organisation membership; composite organisation foreign keys; all sensitive endpoints enforce backend role and branch scope.
- API central to all workflows, including admin. No prototype/local-only business data. Preserve production customer data and build environments.
- Stable linkable routes and proper loading, error, empty, success and offline states. Strong accessibility (keyboard, screen-reader labels, contrast, logical focus) and responsive performance.
- Passwords/secrets/tokens stay server-side; auth cookies secure and HttpOnly. Use CSRF/Origin protections, audit trails, reasonable rate limiting and safe session revocation.
- UTC stored instants, IANA time zones per organisation/location, DST edge-case unit tests and clear local display. Configure week start and calendar date behaviour.
- **Test before push**: install, typecheck, production build, unit/API tests and migrate new schema on isolated D1. Every change should be cohesive, reviewable and pass gates. A commit is not evidence that deployment succeeded.
- Changes to production DB, billing, live sending limits, credential rotation or destructive actions require separate explicit approval. Never put credentials in git, chat or logs.

## Work execution protocol for ChatGPT Work
1. Read source code and docs; reconcile roadmap with reality. Start with P0 and verify no failed builds remain.
2. Use a working branch or isolated Work environment; maintain green CI. Commit in tested, coherent batches, not one commit per small unchecked change.
3. Implement as much of P1 -> P2 -> P3 -> P4 as reasonably possible, prioritising usable vertical slices rather than mocked screens. Advance only after prior gates pass.
4. When blocked by missing secrets, approvals, or unavailable provider accounts, implement safe abstraction/tests and mark the step blocked. Do not fabricate successful integrations.
5. Update this roadmap and `docs/IMPLEMENTATION_STATUS.md` as results become test-verified; report commands, tests, commits/PRs, migration status and known risks.
6. Never stop at planning-only output if coding is possible; use available computer, repo and connected capabilities for meaningful implementation.
