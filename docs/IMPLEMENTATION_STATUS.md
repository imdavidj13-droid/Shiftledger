# ShiftLedger implementation status

Updated 10 November 2026. The master roadmap remains [FEATURE_BACKLOG.md](FEATURE_BACKLOG.md).

## Verified in local Workers and D1

- Reproducible Node 24 install, TypeScript validation, Vite production build, Wrangler bundle and GitHub Actions regression workflow.
- Existing PBKDF2 credentials and session cookies work in the Worker runtime. Verification and reset links are consumed atomically. Password reset revokes earlier sessions. Sign-in throttling is atomic per account and per IP.
- Organisation collection and nested APIs enforce active membership, including trailing slashes and malformed route inputs. The browser preserves a valid session during a workspace API failure and exposes a retry.
- Signed-out return links, direct branch links, refresh, browser history, mobile sign-out and unavailable organisation/location states have browser coverage.
- Organisation name, default time zone, week start and time format are editable. Onboarding accepts separate branch time zones and still accepts the old names-only API payload.
- Location directory, detail, create, edit, archive and restore use D1. Archiving keeps records and is blocked by upcoming shifts. Owners and admins can grant or revoke manager access to a branch.
- Staff creation with a first branch is atomic. Employees can have multiple branch assignments under one record. Branch assignment removal is blocked by upcoming shifts for the employee. Employee accounts see their assigned branches.
- Team Access creates renewable, revocable private invitation links. Acceptance requires a verified matching email and creates membership plus scoped branch assignments in one transaction. It can link an existing staff record. Owners can invite administrators. Owners and admins can suspend and restore eligible memberships.
- Draft shift creation uses each branch’s IANA zone, handles both instances of a repeated hour, rejects nonexistent times, and atomically prevents overlapping shifts across branches for the same staff member.

## Validation

| Check | Outcome |
| --- | --- |
| `npm ci` | Reproducible install from the committed lockfile |
| `npm run typecheck` and `npm run build` | Passed |
| `npm test` | 18 passed in the local Worker against a fresh D1 database, including Chromium end-to-end tests |
| `npx wrangler deploy --dry-run` | Passed against production configuration without upload |
| Live read-only smoke | `/api/health` 200 JSON, signed-out `/api/v1/auth/me` and organisation collection 401 JSON, workspace deep link 200 HTML |

Browser and API fixtures contain synthetic data. Local tests in the Work environment used headless Chromium and a loopback-only workaround for the environment’s interface enumeration restriction. The GitHub runner uses standard Playwright Chromium.

## GitHub and deployments

- The starting `main` commit was [dce7232](https://github.com/imdavidj13-droid/Shiftledger/commit/dce7232c47abb2cb49f1229e67b598ec4c6b4f37). Its [GitHub Actions run](https://github.com/imdavidj13-droid/Shiftledger/actions/runs/42758986303) passed the previous build-only workflow.
- Development branch [codex/shiftledger-stability-locations](https://github.com/imdavidj13-droid/Shiftledger/tree/codex/shiftledger-stability-locations). Its commit history and draft PR provide the GitHub record for this batch.
- The existing live Worker passed the public smoke above. Its deployed version, production migration list, verified-owner sign-in and rollback target require Cloudflare account access to confirm. Use the [deployment runbook](DEPLOYMENT.md).
- Migration `0004_invitations.sql` adds two tables and indexes. It passed local D1 migration and invitation integration tests. It has not been applied remotely.
- The staging config and guard are in the branch. A hosted staging Worker needs a dedicated D1 UUID, Cloudflare account access and a separate mail configuration for delivery tests.

## Remaining release gates

1. Require the GitHub validation check for `main`, confirm Cloudflare production-branch and preview settings, and record the active Cloudflare deployment/version and backup checkpoint.
2. Provision hosted staging, confirm the migration upgrade with staging records, and run the owner onboarding, sign-in and role journeys there. Add real verification, recovery and invitation delivery tests when a sender is available. Invitations currently use copied links. Benchmark and upgrade password storage with backward-compatible verification.
3. Finish profile and account management, organisation lifecycle, employee employment metadata, primary location, opening hours, departments and positions.
4. Complete scheduling workflow, including week views, publication, editing, recurring shifts, availability and notifications.
5. Implement timekeeping, leave, swaps, reporting, payroll export, developer API documentation and commercial administration.
