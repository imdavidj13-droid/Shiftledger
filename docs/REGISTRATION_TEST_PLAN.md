# Registration verification and launch gate

## Required Cloudflare Worker configuration
- D1 binding `DB` -> `shiftledger-db`; apply migrations `0001_initial` and `0002_identity`.
- Secret `RESEND_API_KEY` containing a valid Resend API key.
- Environment variable `MAIL_FROM` using an authorised sender on a verified domain (for example `ShiftLedger <accounts@your-verified-domain.example>`).
- Environment variable `APP_URL` set to the actual production origin, e.g. `https://shiftledger.imdavidj13.workers.dev`. Do not include a trailing slash or path.
- Do **not** commit secret values or production credentials.
- API and website must deploy together; both are served by the same Worker origin.

To list Worker secret names (not values): `npx wrangler secret list`.
To check migration state: `npx wrangler d1 migrations list shiftledger-db --remote`.
To apply pending migrations: `npm run db:migrate:remote`.

## Live manual acceptance tests
1. Open the production site in a private browser window.
2. Register with a new, real test inbox and a 12+ character password.
3. Confirm the new 'Check your email' state appears. Check spam as well as inbox.
4. Follow the verification link; the page must show success or a clear error **without immediately redirecting**.
5. Sign in with the new account; confirm the organisation creation form appears.
6. Create an organisation with correct country, currency and IANA time zone.
7. Refresh the browser and confirm the session and organisation persist.
8. Sign out, refresh, and ensure protected data is no longer accessible.
9. Register another inbox, try logging in **before** verification and confirm it is blocked.
10. Use 'Resend verification email'; confirm the replacement link works and a used or expired link fails.
11. Test forgot-password and password reset; confirm prior sessions are invalidated.
12. Verify that calling a protected API route without a session gives HTTP 401 and that unknown organisation IDs cannot disclose another organisation's data.

## Before accepting real customer data
- Automated integration tests of registration, verification, rate limits, sessions and ownership/role checks.
- Verified cross-tenant isolation tests for every organisation endpoint.
- Confirm email delivery errors, rate limits, logging and retry behaviour.
- CSRF/Origin policy review, password hashing review, privacy/security assessment and production monitoring.
- Password recovery, email change and account deletion workflows reviewed.
- Implement business email verification and sender reputation controls.

## Known limits
The current code does not implement team invitations, 2FA, account deletion, or complete workforce operations. Treat these as outstanding, not live features. Signup is not considered production-ready until the test list is completed.
