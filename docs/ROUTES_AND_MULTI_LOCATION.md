# Routing and multi-location architecture

## Durable URLs (mandatory for every future screen)
All authenticated workspace pages have canonical, refresh-safe paths:

| Module | Path |
| --- | --- |
| Overview | `/app/:organisationId/overview` |
| Schedule | `/app/:organisationId/schedule` |
| Team | `/app/:organisationId/team` |
| Timesheets | `/app/:organisationId/timesheets` |
| Leave | `/app/:organisationId/leave` |
| Shift swaps | `/app/:organisationId/shift-swaps` |
| Reports | `/app/:organisationId/reports` |
| Settings | `/app/:organisationId/settings` |
| Location directory and details | `/app/:organisationId/locations` and `/app/:organisationId/locations/:locationId` |
| Invitations and memberships | `/app/:organisationId/access` |
| Rota week, new shift and details | `/app/:organisationId/schedule?week=YYYY-MM-DD`, `/schedule/new` and `/schedule/:shiftId` under the same organisation prefix |

The personal profile uses `/profile`. Onboarding uses `/onboarding`, `/onboarding?step=2` and `/onboarding?step=3`. Private invitations open `/join?token=…`.

Unauthenticated pages: `/sign-in`, `/register`, `/forgot-password`, `/check-email` (transitional check-email screen), `/?reset=<token>`, and verification links `/?verify=<token>`. The verification result screen is displayed with explicit confirmation from the API, not inferred from a URL. Design-only preview routes are separate.

**Policy:** Every future module, detail page, modal-as-page or admin page must get a stable URL, use real anchor links when navigating, support reload/direct access and browser history, and enforce permissions on the backend. Never implement sidebar navigation only by local state.

The Worker serves `dist/index.html` as SPA fallback for client routes. For users without an active session, the API denies data; client routes alone do not grant access. Organisation route IDs are checked against memberships before data is shown. Never infer authorisation from the URL.

## Hierarchy

Platform > Organisations > Locations > Employees and shifts.

- One business = one organisation with one owner and one prospective subscription. Adding a branch must never create another subscription.
- A business can have zero, one or many locations; each location has its own IANA time zone.
- An owner can filter the workspace to all locations or a particular branch. The selected location is represented as `?location=<locationId>` on the existing permanent module URL.
- One organisation contains shared employee identities. Employee-location assignment is many-to-many, so a person working at two sites is **not** entered twice.
- Owners and org admins see organisation-wide data. Managers may have multiple assigned locations.
- Branch managers do not implicitly gain access to every site in the business.
- A shift belongs to exactly one organisation and one location; employee assignments must match the shift location.
- Org IDs and location IDs are never accepted as proof of permissions.

## D1 schema
`0003_multilocation.sql` introduces:
- Organisation fields: industry, team-size band, week start, 12/24-hour format.
- `location_access`: organisation + location + manager membership.
- `employee_locations`: organisation + employee + location.

This is additive. Existing user accounts and organisation records are not deleted.

Migrations 0004 and 0005 add invitations, invitation branch assignments and optimistic shift revisions. Rehearse migrations on staging and see [DEPLOYMENT.md](DEPLOYMENT.md) before any authorised remote changes.

## Existing endpoints
Paths in the table are relative to `/api/v1`. Organisation-scoped paths start with `/organisations/:orgId`.

| Scope | Operations |
| --- | --- |
| Account | `GET/PATCH /auth/me`. A user can edit their own display name. |
| Organisation | `GET/POST /organisations`, `GET/PATCH /organisations/:orgId`. Updates require owner or admin. |
| Locations | `GET/POST /locations`, `GET/PATCH /locations/:locationId`, and `POST /locations/:locationId/archive` or `/restore`. |
| Assignments | `GET/POST /employee-locations` and `/location-access`. Revoke with `DELETE /employee-locations/:employeeId/:locationId` or `DELETE /location-access/:locationId/:userId`. |
| Team access | `GET/POST /invitations`, `POST /invitations/:id/renew` or `/revoke`, and `GET /members` or `PATCH /members/:userId`. The invited account submits its token to the global `POST /invitations/accept` route after sign-in. |
| Shifts | `GET/POST /shifts`, `GET/PATCH /shifts/:shiftId`, and `POST /shifts/:shiftId/publish`, `/cancel` or `/discard`. Draft edits and lifecycle actions require the current revision. |

The shift list supports paired `from` and `to` UTC bounds, optional `location` and a `cursor` returned as `nextCursor`. The range includes shifts that overlap the requested window. Owners and admins can read across branches. Managers see only active assigned branches. Employees see their own published shifts at assigned branches.

## Verification checklist
1. Build and deploy with no TypeScript errors.
2. Rehearse all migrations on staging and verify existing accounts survive.
3. Create organisation with multiple initial locations via three-step onboarding. Confirm all branches belong to the same organisation and are not separate accounts.
4. From Settings, add another location and confirm all branches appear in the directory.
5. Create an employee once and assign that employee to **both** locations in the Team screen.
6. Create shifts for that employee at each location.
7. Refresh a module deep link (e.g. `/app/<orgId>/schedule?location=<locationId>`) and confirm the same page and branch filter open without returning to Overview.
8. Use back/forward browser history; open links in a new tab; switch organisation if available.
9. Invite a separate verified fixture manager and test their branch scope.
10. Cross-tenant automated tests must confirm inaccessible IDs cannot be read, assigned or scheduled.

## Known limits
Branch operational settings, employment metadata, automated invitation delivery and release acceptance remain on the roadmap. Use staging fixtures until the release gates are satisfied.

## Initial multi-location setup
The three-step onboarding allows a business to create up to 20 named locations in the first transaction; after setup, an owner/admin can add further sites from Settings. Each site can use its own time zone or inherit the organisation default during setup. The location detail and Team screens manage branch access and assignments. The Access screen issues and revokes private invitation links.

## Deep links when signed out
Opening a workspace URL while signed out redirects to the sign-in view with a local `next` destination. After login the app restores the authorised route and optional branch filter; it never trusts this URL for authorisation. Backend organisation membership and location assignments are still mandatory.
