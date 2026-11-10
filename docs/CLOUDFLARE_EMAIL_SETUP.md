# Cloudflare Email Service — production activation

ShiftLedger's Worker supports an optional `EMAIL` binding as its primary email sender and Resend as a fallback. The binding is deliberately **not** enabled in `wrangler.jsonc` yet: a real sending domain and authorised sender address must be known before configuring unrestricted customer delivery. Keep the fallback optional.

## One-time setup
1. Cloudflare dashboard → Compute → Email Service → Email Sending → Onboard Domain.
2. Choose a domain using Cloudflare DNS, complete SPF/DKIM/DMARC onboarding, and wait for the sender domain to become available.
3. Choose a sender address on that domain, e.g. `accounts@your-real-domain`.
4. Set production Worker variables `MAIL_FROM` to the authorised sender, and `APP_URL` to the deployed ShiftLedger website's origin.
5. Add this **after domain onboarding** to `wrangler.jsonc`:
```json
"send_email": [{
  "name": "EMAIL",
  "allowed_sender_addresses": ["accounts@your-real-domain"]
}]
```
Replace the example address with the exact configured `MAIL_FROM`. The sender-limited binding is important: Cloudflare's binding without restrictions is only meant for previously verified destinations, not arbitrary new signup addresses.
6. Deploy with `npm run deploy` and test signup delivery using a new inbox.

## Notes
- This integration does not eliminate the need to verify sender domains or observe email quotas.
- Do not publish API keys in code, frontend variables, issues, chat logs or commits.
- `RESEND_API_KEY` remains optional for fallback. With no Cloudflare binding and no Resend key, registration will return an email-not-configured error rather than create an unusable account.
- Inspect Cloudflare Email Service logs for rejects, bounces and rate limits.
- For large-scale notifications, implement a durable queue, idempotency and delivery events before sending messages triggered by every shift change.
- Completing these instructions is required before live registration can be marked successful.
