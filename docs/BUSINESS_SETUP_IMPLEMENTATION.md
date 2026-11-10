# Business setup integration status — 10 November 2026

**Current status:** Connected to the authenticated organisation dashboard on `main` with a permanent `/app/:organisationId/setup` route and `?step=2` through `?step=5` query navigation. Dashboard owner/admin sees an **Open five-step setup** link in Getting started. Existing organisation and canonical D1 records are reused. The employee-facing application is not implemented.

**Commits:** `737687f` (durable step links), `612c4f7` (setup page route), `19b4a70` (dashboard integration). These were connector commits during parallel Work activity; the complete production build, test suite, deployment and owner acceptance remain unverified at the time of this note. Do not claim full five-step completion.

## Verified implementation boundaries

- Stage 1: PATCH existing organisation settings, no new business registration.
- Stage 2: use existing location directory / creation API and branch time zones.
- Stage 3: explicit guarded placeholder for departments/positions; a proper catalogue API, data model and editor are still required.
- Stage 4: create employee record at selected location without automatic invitation.
- Stage 5: genuine rota creation URL, no automatic publication.
- Current step in stable URL; back/forward and refresh retain the stage, but no separate D1 progress/completed-steps tracking yet.
- No database migration introduced by this integration.

## Remaining priority work

1. Run a clean `npm ci`, `npm run typecheck`, `npm run build`, `npm test`, verify GitHub CI and the deployed Worker release; fix any issue before claiming the feature is live.
2. Implement saved per-organisation stage progression/resume using additive D1 migration, with explicit user approval before production application.
3. Finish real job position + department catalogues and employee assignments with cross-tenant and role checks.
4. Full API/integration/browser tests for existing organisations, branch roles, refresh, interrupted setup, replays/duplicate submission and first rota handoff.
5. Review active Work's changing API contracts before integrating any new schema; preserve live organisation and shifts.

---

## Original component notes

# Five-stage business setup — integration notes

Created 10 November 2026 while another ChatGPT Work session was editing the main application.

## Implemented in isolation
- `src/BusinessSetup.tsx` exports a self-contained, full-page five-stage `BusinessSetup` component.
- `src/BusinessSetup.css` contains original opaque forest-green/lime/ivory layouts, responsive side navigation and cards.
- Stage 1 reads existing organisation settings and PATCHes the existing organisation; does not create an organisation.
- Stage 2 lists existing workplaces and adds locations with individual IANA zones through existing API.
- Stage 3 explains job positions versus security permission roles but is deliberately **not a saved role editor** while the positions API/schema is unavailable.
- Stage 4 lists actual employees and adds records to an existing workplace through the API without inviting anyone automatically.
- Stage 5 displays data-backed setup counts and links to real draft-shift creation, leaving shift publication deliberate.
- All steps support in-component back/forward navigation without deleting saved entities; however **onboarding-progress persistence, per-step deep links and server-side resume are not yet implemented**.

## Not yet integrated or claimed complete
This module is currently **not imported into the active App/route tree**. It is intentionally isolated to avoid conflicting with simultaneous work on `main`. It therefore does **not** create a live five-step flow yet. Do not mark the five-step roadmap item complete.

Before integration:
1. Re-read the current `main` files `src/App.tsx`, `src/routes.ts`, `src/Locations.tsx`, `src/api.ts` and migration history. Concurrent Work may have changed their contracts.
2. Run `npm ci`, `npm run typecheck`, `npm run build`, `npm test` after importing the component and before committing an integration. Confirm existing onboarding and sign-in still work.
3. Add an authenticated, permissioned durable page path such as `/app/:organisationId/setup` and link to it from owner/admin dashboard. Never overwrite or relaunch organisation registration. A manager/employee must not gain owner privileges.
4. Implement a D1-backed, resumable per-organisation setup progress state with safe idempotency. Use a tested additive migration; request production migration approval before applying. Keep entity data canonical in its existing tables.
5. Add job position/department CRUD if Work has not already implemented it. Positions are job assignments, not organisation access roles. Replace the gated Stage 3 with real persisted forms and assignments.
6. Wire completed stages into real scheduling creation/review without auto-publishing. Validate that open shift workflows obey the manager approval policy.
7. Test interruptions, refresh/deep links, duplicate requests, branch scoping, employee record creation, and existing businesses with prior shifts. Do not fabricate completion data.
8. Verify successful GitHub CI and Cloudflare production deployment. The current two new source files alone do not prove deployment functionality.

## Interaction contract
```ts
type BusinessSetupProps = {
  org: Org;
  locations: Location[];
  employees: {id:string;display_name:string;employment_status:string}[];
  onRefresh: () => Promise<void>;
  onOrganisationChange: (next: Org) => void;
  onExit: () => void;
  initialStep?: number;
};
```

## Boundaries
- **No new branches or pull requests.** The owner wants code committed to `main`.
- Avoid concurrent edits to the same source file as other ChatGPT Work sessions.
- No production DB changes, new services or credentials without user approval.
- Dedicated employee-facing design comes after business-side P0–P3; this module is business-side only.
- The competitor screenshots are research references, not a visual specification to copy.
