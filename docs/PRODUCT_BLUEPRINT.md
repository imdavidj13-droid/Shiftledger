# ShiftLedger — product blueprint (v0.1)

## Positioning
Simple, dependable workforce management for small and medium organisations that do not want a per-employee bill. Initial suggested subscription entry points: £5 and £10 per organisation per month. These are **hypotheses**, not final prices; usage limits and unit economics need validation before commercial launch.

## First customer
A retail, hospitality, services or small operations team managing 5–50 people across one or more locations, with a rota currently maintained in spreadsheets or messaging apps. Larger teams are a later segment.

## MVP acceptance
1. An owner can register, verify email, create an organisation and invite staff.
2. Every protected API request authenticates the user, checks their active membership and authorises a specific action and organisation.
3. An owner or manager can create, amend, publish and cancel shifts; employees see only authorised schedules.
4. Staff can clock in and out; managers can review and approve timesheets with change history.
5. Managers can export approved hours to CSV with clearly defined timezone and rounding rules.
6. Leave requests and shift swaps have an auditable approval workflow.
7. Tests prove that users from organisation A cannot read or change organisation B's data even when given valid IDs.
8. Responsive UI, accessibility, monitoring, backups and privacy controls are release gates.

## Architecture
- Frontend: React + TypeScript, Vite.
- API: Cloudflare Workers + Hono; explicit routes with validation and central error handling.
- Database: Cloudflare D1 + migrations. All organisation-owned rows contain organisation_id.
- Authentication: session-based, email verification, secure cookies, CSRF defence and session revocation; choose a maintained solution before implementing.
- Roles: owner, admin, manager, employee; evaluate permissions server-side.
- Data representation: store instants in UTC; store location and organisation IANA time zones separately; render local dates per location. Handle DST ambiguities explicitly.
- Background work: queued notifications and retries with idempotency keys; later phase.
- API: versioned endpoints and scoped API tokens later, never expose D1 directly.

## Security rules
- No unscoped staff or shift SQL query.
- Cross-tenant foreign keys use (organisation_id, id) pairs.
- Never trust organisation IDs supplied by clients without a membership check.
- Never store passwords or long-lived API secrets in browser local storage.
- Separate dev/staging/production databases and secrets.
- Audit changes to schedules, timesheets, permissions and pay-related metadata.
- Define retention, exports, deletion and compliance requirements by country before shipping.
- The initial Worker has a public health endpoint only.

## Roadmap
### Phase 0 — Foundation
Repository, UI shell, schema, CI, basic tests and deployment configuration; verify a clean build.

### Phase 1 — Identity and tenant security
Authentication, email verification, organisation creation, membership roles and invitations. Cross-tenant security tests before enabling employee records.

### Phase 2 — Scheduling
Locations, staff directory, shift CRUD, calendar views, publish/unpublish, conflict warnings.

### Phase 3 — Time and approvals
Clock events, breaks, manager approvals, timesheet history and CSV export.

### Phase 4 — Requests and commercial readiness
Leave, availability, swaps, notifications, subscriptions, reporting, legal/privacy review, pilot customers.

### Phase 5 — Integrations and expansion
Public API, webhooks, more payroll formats, mobile apps, optional advanced analytics.

## Explicit exclusions from MVP
Payroll calculation or tax filing, legal compliance guarantees for every country, automatic labour-law optimisation, GPS monitoring, sophisticated forecasting and enterprise HRIS replacement.

## Design direction
Bright, restrained business UI with off-white backgrounds, forest green accents, spacious cards, clear typography and practical workflows. No fabricated metrics or pretend user accounts in production.
