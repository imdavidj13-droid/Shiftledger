# ShiftLedger implementation status

Updated 10 November 2026. The master roadmap remains [FEATURE_BACKLOG.md](FEATURE_BACKLOG.md).

## Main branch updates on 10 November 2026

- Baseline `91f1eea` passed [GitHub Actions](https://github.com/imdavidj13-droid/Shiftledger/actions/runs/42783293041). The live Worker returned HTTP 200 on `/api/v1/health`. The baseline deployed commit is unconfirmed.
- Schedule has a Week / Month selector, a seven-column month calendar, date links into the daily rota, and shift detail links. URLs retain branch and period, and the day/month views read all pages of overlapping D1 shifts. Covered on mobile, with leap-day and daylight-saving cases.
- Managers can mark a draft as a vacancy, publish it and approve or decline a staff API claim from shift detail. The database reserves one pending claim at a time. Approval rechecks active membership, branch assignment and cross-branch shift overlaps before assigning the employee. Existing unassigned shifts retain their status and are not advertised as vacancies.
- `npm ci`, `npm run verify` (29 tests), and Wrangler production dry-run passed locally. The Work environment used a loopback interface workaround and a compatible headless Chromium binary.
- Migration `0006_open_shifts.sql` passed on disposable D1 and an upgrade fixture. Production application is awaiting explicit approval. The application keeps the existing scheduling path on a pre-0006 database and enables the open-shift controls once 0006 is present.
- Leave/availability/position eligibility, notification delivery, recurring rotas, templates and the remaining P0–P3 release gates are still open. Hosted staging is outside the current deployment policy.

## Verified in local Workers and D1

- Reproducible Node 24 install, TypeScript validation, Vite production build, Wrangler bundle and GitHub Actions regression workflow.
- Existing PBKDF2 credentials and session cookies work in the Worker runtime. Verification and reset links are consumed atomically. Password reset revokes earlier sessions. Sign-in throttling is atomic per account and per IP.
- Organisation collection and nested APIs enforce active membership, including trailing slashes and malformed route inputs. The browser preserves a valid session during a workspace API failure and exposes a retry.
- Signed-out return links, direct branch links, refresh, browser history, mobile sign-out and unavailable organisation/location states have browser coverage.
- A signed-in user can edit their own display name on the permanent personal profile route. The onboarding steps have refreshable URLs and preserve in-progress form values within browser history. Organisation name, default time zone, week start and time format are editable. Onboarding accepts separate branch time zones and still accepts the old names-only API payload.
- Location directory, detail, create, edit, archive and restore use D1. Archiving keeps records and is blocked by upcoming shifts. Owners and admins can grant or revoke manager access to a branch.
- Staff creation with a first branch is atomic. Employees can have multiple branch assignments under one record. Branch assignment removal is blocked by upcoming shifts for the employee. Employee accounts see their assigned branches.
- Team Access creates renewable, revocable private invitation links. Acceptance requires a verified matching email and creates membership plus scoped branch assignments in one transaction. It can link an existing staff record. Owners can invite administrators. Owners and admins can suspend and restore eligible memberships.
- The weekly rota uses permanent week, draft creation and shift detail URLs, with branch filters and pagination. Authorised schedulers can create, edit, discard, publish and cancel shifts. Employees see their own published assignments. Revisions protect against concurrent edits, and mutations write audit history. Shift entry uses each branch’s IANA zone, handles both instances of a repeated hour, rejects nonexistent times, and atomically prevents overlaps across branches.

## Validation

| Check | Outcome |
| --- | --- |
| `npm ci` | Reproducible install from the committed lockfile |
| `npm run typecheck` and `npm run build` | Passed |
| `npm test` | 25 passed, including Chromium end-to-end tests, local Worker and D1 integration, DST unit checks and an additive upgrade test |
| `npx wrangler deploy --dry-run` | Passed against production configuration without upload |
| Live read-only smoke | `/api/health` 200 JSON, signed-out `/api/v1/auth/me` and organisation collection 401 JSON, workspace deep link 200 HTML |

Browser and API fixtures contain synthetic data. Local tests in the Work environment used headless Chromium and a loopback-only workaround for the environment’s interface enumeration restriction. The GitHub runner uses standard Playwright Chromium.

## GitHub and deployments

- The starting `main` commit was [dce7232](https://github.com/imdavidj13-droid/Shiftledger/commit/dce7232c47abb2cb49f1229e67b598ec4c6b4f37). Its [GitHub Actions run](https://github.com/imdavidj13-droid/Shiftledger/actions/runs/42758986303) passed the previous build-only workflow.
- [Draft PR #1](https://github.com/imdavidj13-droid/Shiftledger/pull/1) contains the review branch and commits. The first checkpoint [1ee7383](https://github.com/imdavidj13-droid/Shiftledger/commit/1ee7383a7a7cf0592842aced37fd636fca177326) passed [GitHub Actions run 71](https://github.com/imdavidj13-droid/Shiftledger/actions/runs/42761033864). The PR links to validation for subsequent commits.
- The existing live Worker passed the public smoke above. Its deployed version, production migration list, verified-owner sign-in and rollback target require Cloudflare account access to confirm. Use the [deployment runbook](DEPLOYMENT.md).
- Migration `0004_invitations.sql` adds invitation tables and indexes. Migration `0005_shift_revisions.sql` adds a revision column with a default for existing shifts and a branch/time index. Both passed local migration checks, including an upgrade fixture with existing users, sessions, memberships, locations and shifts. Remote migration is pending staging and authorisation.
- The staging config and guard are in the branch. A hosted staging Worker needs a dedicated D1 UUID, Cloudflare account access and a separate mail configuration for delivery tests.

## Remaining release gates

1. Require the GitHub validation check for `main`, confirm Cloudflare production-branch and preview settings, and record the active Cloudflare deployment/version and backup checkpoint.
2. Provision hosted staging, confirm the migration upgrade with staging records, and run the owner onboarding, sign-in and role journeys there. Add real verification, recovery and invitation delivery tests when a sender is available. Invitations currently use copied links. Benchmark and upgrade password storage with backward-compatible verification.
3. Finish email changes and account export/deletion, organisation lifecycle, employee employment metadata, primary location, opening hours, departments and positions.
4. Extend the core rota with recurring shifts, copy-week, templates, availability, bulk publication and notifications.
5. Implement timekeeping, leave, swaps, reporting, payroll export, developer API documentation and commercial administration.
