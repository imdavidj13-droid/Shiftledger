# ShiftLedger authentication UX — screen-by-screen contract

## Design
All authentication screens follow docs/DESIGN_SYSTEM.md: bold, fully opaque colour fields; solid borders; no transparency, shadows, glass, gradients or automatic redirects from success screens.

## 1. Sign in
**Layout:** two-column marketing panel + form.
**Fields:** email, password.
**Actions:** Sign in, Register your business, Forgot password.
**Success:** fetch active account and organisations; route to organisation setup if none, otherwise workspace.
**Failure:** clear inline error; no loss of form values.

## 2. Register your business
**Layout:** two-column marketing panel + form.
**Fields:** email, password (12–128 characters).
**Success:** show 'Check your email' state; do not sign in automatically.
**Identity rule:** organisation name is NOT requested during sign-up. Email is a temporary account label, separate from organisation identity.

## 3. Check your email
**Layout:** existing authentication form panel, prominent instruction.
**Actions:** resend verification (rate limited) and back to sign in.
**Note:** email delivery acceptance is not the same as confirmed inbox delivery.

## 4. Verification result
**Layout:** dedicated full-width page; no split marketing hero.
**Incoming link:** `/?verify=<token>`.
**Checking:** full-page progress state.
**Success:** large success icon, 'Email verified!', explicit description, button 'Continue to sign in'. **No automatic redirect.**
**Failure:** full-page failure state, explanation and sign-in link. Never claim success before API confirmation.
**Security:** exchange token via POST; remove token from browser URL after the response. Refreshing the resulting URL returns to normal auth, not a forged success message.

## 5. Password recovery
**Layout:** existing auth panel.
**Flow:** request password reset -> email -> enter new password -> explicit confirmation -> sign in.
**Future UX:** standalone reset-success screen matching verification result.

## 6. First organisation setup
**Layout:** full-page business setup, not personal onboarding.
**Fields:** organisation name, ISO country/currency and IANA time zone.
**Success:** dashboard with verified organisation membership.

## Release gate
Compile and deploy; test verification link success and expired/used-token failure, login, no automatic redirect, browser refresh, no secret tokens left in the URL, and responsive mobile layout. A customer-ready auth system additionally requires full security tests and account management functionality.
