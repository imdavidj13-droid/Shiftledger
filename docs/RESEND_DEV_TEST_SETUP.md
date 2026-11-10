# Temporary registration testing with Resend (no domain needed)

**Only for development, never public customer registration.** The shared Resend sender can deliver to the email address used to register the Resend account. ShiftLedger now rejects registrations for all other email addresses when `MAIL_FROM` uses the shared testing sender.

## Setup
1. Create or sign into a Resend account: https://resend.com
2. From **API Keys**, create a key with sending permission; copy it once.
3. Cloudflare → Workers & Pages → **shiftledger** → Settings → Variables and Secrets. Add these production variables:
   - `RESEND_API_KEY` — **Secret**, the key created in Resend.
   - `MAIL_FROM` — **Text**, `ShiftLedger <onboarding@resend.dev>`.
   - `APP_URL` — **Text**, `https://shiftledger.imdavidj13.workers.dev`.
   - `TEST_REGISTRATION_EMAIL` — **Text**, the email address used to create your Resend account (must also be the email address you register with in ShiftLedger).
4. Save/apply the Worker variables. A deployment may be necessary depending on Cloudflare UI.
5. Open the website; register with **only** the `TEST_REGISTRATION_EMAIL` address and a strong unique password.
6. Confirm the verification email arrives and the link can be used once. Then sign in and create the first organisation.

## Troubleshooting
- **Email delivery not configured**: check exact variable names, key, sender, test address and active deployment.
- **Registration restricted to test account**: entered address does not match `TEST_REGISTRATION_EMAIL`.
- **Email 403 / can only send to your own email**: `TEST_REGISTRATION_EMAIL` must equal the email of your Resend account.
- **Account exists after mail failure**: use the **Resend verification email** button on the Check your email screen; do not try to register the same email twice.
- Never send the API key through chat, screenshots, GitHub or frontend code.

## Switching to full production registration
Use a domain you control and verify it with a sending provider. Update `MAIL_FROM` to a verified sender. Remove `TEST_REGISTRATION_EMAIL` when ready and complete security, rate-limit, email deliverability and legal checks before enabling unrestricted sign-ups. Prefer Cloudflare Email Service when an appropriate sending domain is available.

**Security note:** Shared sender testing does not make the entire application safe for customer data.
