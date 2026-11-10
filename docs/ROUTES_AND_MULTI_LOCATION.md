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

Unauthenticated pages: `/sign-in`, `/register`, `/forgot-password`, `/check-email` (transitional check-email screen), `/?reset=<token>`, and verification links `/?verify=<token>`. The verification result screen is displayed with explicit confirmation from the API, not inferred from a URL. Design-only preview routes are separate.

**Policy:** Every future module, detail page, modal-as-page or admin page must get a stable URL, use real anchor links when navigating, support reload/direct access and browser history, and enforce permissions on the backend. Never implement sidebar navigation only by local state.

The Worker serves `dist/index.html` as SPA fallback for client routes. For users without an active session, the API denies data; client routes alone do not grant access. Organisation route IDs are checked against memberships before data is shown. Never infer authorisation from the URL.

## Hierarchy

Platform > Organisations > Locations > Employees and shifts.

- One business = one organisation with one owner and one prospective subscription.
- A business can have zero, one or many locations; each location has its own IANA time zone.
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

### Important production step
After pulling the commit and **before** submitting the updated onboarding form, apply the migration:

```powershell
cd C:\Projects\Shiftledger
git pull origin main
npm run db:migrate:remote
```

If this is not done, organisation creation will fail when it references the new fields.

## Existing endpoints
- `GET/POST /api/v1/organisations`
- `GET /api/v1/organisations/:orgId/locations`
- `POST /api/v1/organisations/:orgId/locations` (owner/admin)
- `GET/POST /api/v1/organisations/:orgId/employee-locations` (writes owner/admin)
- `GET/POST /api/v1/organisations/:orgId/location-access` (owner/admin)
- `GET /api/v1/organisations/:orgId/employees` (manager sees assigned-location staff)
- `GET /api/v1/organisations/:orgId/shifts` (manager sees assigned-location shifts)
- `POST /api/v1/organisations/:orgId/shifts` (manager must manage location; employee must belong to that location)

Not implemented yet: inviting users as organisation members, granting manager role, assigning managers from the UI, revoking assignments, payroll export, shift publishing and automated tenancy test suite. These remain separate release gates.

## Verification checklist
1. Build and deploy with no TypeScript errors.
2. Run migration 0003, confirm D1 schema updated, and verify existing accounts survive.
3. Create organisation with first location via three-step onboarding.
4. From Settings, add a second location and confirm both appear in the directory.
5. Create an employee once and assign that employee to **both** locations in the Team screen.
6. Create shifts for that employee at each location.
7. Refresh a module deep link and confirm the same page opens without returning to Overview.
8. Use back/forward browser history; open links in a new tab; switch organisation if available.
9. Test manager scope with a real separately invited manager once invitations are implemented.
10. Cross-tenant automated tests must confirm inaccessible IDs cannot be read, assigned or scheduled.

## Known limits
This is infrastructure plus the first usable forms. Full multi-location management, role invitations, fine-grained UI filters and compliance constraints are not yet feature-complete. Do not treat it as ready for live employee data.
