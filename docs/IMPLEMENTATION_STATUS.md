# ShiftLedger implementation status

Updated 10 November 2026. The master roadmap remains [FEATURE_BACKLOG.md](FEATURE_BACKLOG.md).

## Main branch updates on 10 November 2026

- Baseline `91f1eea` passed [GitHub Actions](https://github.com/imdavidj13-droid/Shiftledger/actions/runs/42783293041). The live Worker returned HTTP 200 on `/api/v1/health`. The baseline deployed commit is unconfirmed.
- [Calendar and open shifts (9148e82)](https://github.com/imdavidj13-droid/Shiftledger/commit/9148e82352d636a5da23542b2e6193403f60b3f6) passed [GitHub Actions](https://github.com/imdavidj13-droid/Shiftledger/actions/runs/42784815258). The live site served the JavaScript and CSS assets matching that tested build.
- Schedule has a Week / Month selector, a seven-column month calendar, date links into the daily rota, and shift detail links. URLs retain branch and period, and the day/month views read all pages of overlapping D1 shifts. Covered on mobile, with leap-day and daylight-saving cases.
- Managers can mark a draft as a vacancy, publish it and approve or decline a staff API claim from shift detail. The database reserves one pending claim at a time. Approval rechecks active membership, branch assignment and cross-branch shift overlaps before assigning the employee. Existing unassigned shifts retain their status and are not advertised as vacancies.
- `npm ci`, `npm run verify` (29 tests), and Wrangler production dry-run passed locally. The Work environment used a loopback interface workaround and a compatible headless Chromium binary.
- Migration `0006_open_shifts.sql` passed on disposable D1 and an upgrade fixture. Production application is awaiting explicit approval. The application keeps the existing scheduling path on a pre-0006 database and enables the open-shift controls once 0006 is present.
- Holiday, sickness and other absence requests can be recorded, filtered, approved, declined or cancelled in the management UI. Staff can request and view their own leave through the API. Date boundaries use the branch time zone. Approvals warn about existing shifts, and approved leave blocks new scheduling, publication and vacancy assignment across branches. Audit events are recorded.
- [Leave and rota conflicts (41fcdb8)](https://github.com/imdavidj13-droid/Shiftledger/commit/41fcdb8c0a2e4dfd5b501ebff8823308ce579f0b) passed [GitHub Actions](https://github.com/imdavidj13-droid/Shiftledger/actions/runs/42785477715). The live site served matching assets and returned HTTP 200 on readiness.
- Leave validation passed `npm run verify` (31 tests) and the Wrangler production dry-run. Migration `0007_leave_requests.sql` is additive and awaits production approval. Until it is applied, the Leave module displays a database-update status and existing scheduling remains available.
- Schedulers can create up to 12 weekly draft occurrences, copy selected shifts up to 12 weeks ahead and publish up to 50 drafts together. D1 verifies the whole batch before saving and writes a batch audit event. Copying and repetition preserve branch-local time and reject nonexistent DST times. The bulk screen has a permanent schedule URL.
- [Weekly repeats, copy-week and bulk publication (493164f)](https://github.com/imdavidj13-droid/Shiftledger/commit/493164f09b5e33d064c0bf5e8d2373a439e687d8) passed [GitHub Actions](https://github.com/imdavidj13-droid/Shiftledger/actions/runs/42786147604). The live site served matching assets.
- Bulk rota validation passed `npm run verify` (34 tests) and the Wrangler production dry-run. No new migration is required for bulk rota changes.
- Staff timekeeping API records clock-in, clock-out and paid/unpaid breaks. Managers can correct missed punches and break ends with reasons, compare paid hours with linked rota assignments, and approve and lock individual timesheets. The UI includes branch, date and status filters and audit history.
- [Timesheets (d008897)](https://github.com/imdavidj13-droid/Shiftledger/commit/d008897122bce237cec22b2633eef7e6e23f49f7) passed [GitHub Actions](https://github.com/imdavidj13-droid/Shiftledger/actions/runs/42787037581).
- Timekeeping passed `npm run verify` (37 tests) and the Wrangler production dry-run. Migration `0008_timekeeping.sql` is additive and awaits production approval. Pay periods, approved-record reopening and rounding rules remain open.
- Shift swaps have management list, detail and review screens. Staff API offers require the second employee to consent. Managers can record consent already given by both employees. Approval rechecks access to both branches, shift revisions, employee assignments, overlaps and approved leave before updating both shifts in one D1 transaction.
- [Shift swaps (590c5c8)](https://github.com/imdavidj13-droid/Shiftledger/commit/590c5c8d125722d084fe2c397f2c0d1f4c95c48a) reached the live site with matching assets. [GitHub Actions run](https://github.com/imdavidj13-droid/Shiftledger/actions/runs/42788065066).
- Swap validation passed `npm run verify` (39 tests) and Wrangler production dry-run. Migration `0009_shift_swaps.sql` awaits production approval.
- The Team directory links to permanent staff profiles. Owners and administrators can edit employee names, employment status, department and position labels, and a primary branch. Managers see only profiles and branch assignments they manage. Upcoming shifts and open time entries block inactivation.
- [Staff profiles (9f9585d)](https://github.com/imdavidj13-droid/Shiftledger/commit/9f9585dd0eda2e311d916107eb42ed4c340bec9f).
- Staff profiles passed `npm run verify` (41 tests) and Wrangler production dry-run. Migration `0010_staff_profiles.sql` awaits production approval. Core name and employment status edits work before that migration. Reusable department and position catalogues and the five-step business setup remain open.
- [Release verification (7693dab)](https://github.com/imdavidj13-droid/Shiftledger/commit/7693daba699e2367ed2b68985b86fa5de30d3177) passed the five live read-only smoke checks. Cloudflare returned Worker version `19e1bc86-ede0-4bb7-b51c-8ebd023454bc` and confirmed the new D1 feature schemas were pending. [GitHub Actions run](https://github.com/imdavidj13-droid/Shiftledger/actions/runs/42788883107).
- Release checks now include a production-configuration dry-run, full additive upgrade coverage, 41 full-schema tests and a separate legacy-schema test. The tagged Worker health response and read-only smoke command are documented in [DEPLOYMENT.md](DEPLOYMENT.md).
- [Shift templates (6c108fc)](https://github.com/imdavidj13-droid/Shiftledger/commit/6c108fc9767dfb26fbcfbbb3d0a7631c52ec340e) passed [GitHub Actions](https://github.com/imdavidj13-droid/Shiftledger/actions/runs/42789202234) and the five live smoke checks. Cloudflare Worker version was `a8fe82d8-9570-409c-a574-0a2478ca78e0`. The readiness response confirmed migrations 0006–0011 were still pending.
- Schedulers can create, edit and archive branch-local shift templates and apply them to real draft shifts. Templates preserve wall-clock time, unpaid breaks and overnight end dates. The manager workflow and branch boundaries passed 43 full-schema tests, one legacy-schema test and a production dry-run. Migration `0011_shift_templates.sql` awaits production approval.
- The Schedule coverage filter shows published vacancies and upcoming shifts overlapping approved leave. Managers can revise an assigned published shift before it starts or has a linked time entry. Revisions check both branch permissions and staff eligibility and record previous and new values in audit history. Staff APIs do not expose the leave warning.
- Coverage and revised shifts passed `npm run verify` (45 full-schema tests and one legacy-schema test) and the Wrangler production dry-run. This change adds no migration.
- Leave balances, availability/position eligibility, notification delivery, editable recurring series, multi-shift templates and remaining P0–P3 release gates are still open. Hosted staging is outside the current deployment policy.

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

## Remaining release gates

1. Record the live Worker version and production migration list, validate a recovery bookmark and obtain explicit approval for the pending migrations. Confirm the owner can sign in and reopen the existing organisation. Hosted staging is outside the current policy.
2. Verify delivery of registration, recovery and invitations with a customer-capable sender. Current invitation links can be copied manually. Review legacy password-storage upgrades, account lifecycle, production alerting and release gate settings.
3. Finish the five-step business setup, reusable department and position catalogues, role changes, ownership transfer and account email change/export/deletion. The standalone setup component on main still needs integration, progress persistence and end-to-end testing.
4. Finish editable recurring series, multi-shift templates, bulk edits, availability and position rules, published vacancy revisions and schedule notifications.
5. Finish saved pay periods, timesheet reopening and rounding, leave balances, staffing targets and coverage offers. The dedicated worker interface is a later milestone.
