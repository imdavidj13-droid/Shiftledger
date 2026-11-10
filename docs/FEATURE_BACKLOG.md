# ShiftLedger — Feature backlog and acceptance roadmap

Based on the user-provided "Workforce Scheduling App: Full Requirements Overview" (10 November 2026). This is a planning baseline, not a claim of implemented functionality.

## Non-negotiable foundations
- Organisation-isolated data and server-enforced role authorisation; automated cross-tenant tests.
- Email registration, verification, password reset, sessions, invitations and optional stronger authentication.
- Audit events for modifications to shifts, hours, permissions and approvals.
- International time zones and DST; explicit pay-period, week-start and currency settings.
- Opaque bold visual theme per docs/DESIGN_SYSTEM.md: never transparency, shadows, gradients or glass without an explicit request.
- API versioning, documented contracts, validation, rate limiting and monitoring.
- GDPR/privacy requirements and region-specific employment-law review before commercial claims.

## Release A — Owner onboarding and staffing
- [ ] Verify production migration and transactional email configuration end-to-end.
- [ ] Registration, verification, login, logout and reset integration tests.
- [ ] Create organisation, configure country/currency/time zone/week start.
- [ ] Account invitations and acceptance; org owner/admin/manager/employee roles.
- [ ] Locations, departments, positions and employee profiles.
- [ ] Real navigation, forms, validation, empty/error/loading states.
- [ ] Tenant isolation tests for all endpoints.

## Release B — Scheduling MVP
- [ ] Weekly and monthly calendars, filters by employee/location/role.
- [ ] Draft shift CRUD, recurring shifts and copy-week/templates.
- [ ] Collision/leave/availability/rest-break warnings.
- [ ] Publish snapshots with employee notifications only on publish.
- [ ] Employee mobile schedule view.
- [ ] Open shifts and claims with approval policy.
- [ ] Breaks, skills and role requirements.
- [ ] Labour hours and optional costs on rota.

## Release C — Leave, availability and coverage
- [ ] Availability rules and exceptions.
- [ ] Holiday/sick/unpaid/custom leave requests and approvals.
- [ ] Country-specific allowances, accruals and holiday calendars with review.
- [ ] Swaps, approval rules, eligibility checks and coverage broadcasts.

## Release D — Time and payroll
- [ ] Clock in/out and breaks; optional shared kiosk/PIN.
- [ ] Missed clock-out flags, corrections, approvals, immutable audit history.
- [ ] Scheduled vs actual; hours, overtime, absence and labour cost reports.
- [ ] CSV export of approved payroll hours, then Excel/PDF as appropriate.
- [ ] Country/payroll-provider-specific export mappings.

## Release E — Commercial and operations
- [ ] Stripe billing for fixed-fee org tiers (proposed £5/£10/£15 subject to unit economics).
- [ ] Trials, invoices, plan changes, cancellations and failed payments.
- [ ] Public marketing, pricing, features, industries and legal pages.
- [ ] Help centre, onboarding, CSV staff import, customer feedback.
- [ ] Platform operator console with carefully scoped support access and audit trails.
- [ ] Email reliability, metrics, uptime, error tracking, backup/recovery drills.

## Later
- PWA install/push support; dedicated native apps when justified.
- Integrations: Xero, Sage, QuickBooks, BrightPay, Gusto.
- Advanced workforce rules, additional languages, optional geofencing/photo clock-in and document expiry alerts.

## Current implementation versus backlog
The repo contains a deployed application shell, an initial authentication/organisation API, schema migrations and basic employee/location/draft-shift endpoints. This does **not** constitute verified production-ready authentication, an invitation system, shift publishing, timesheets, billing or legal compliance. All require testing and completion.

## Product constraints
- Flat fee per organisation is the pricing direction, not a promise of unlimited staff at every tier.
- No real employee data until full security and tenant-isolation tests are verified.
- International compatibility is architectural; local legal compliance needs jurisdiction-by-jurisdiction review.
- No placeholder metrics or fake staff data in real tenant accounts.
