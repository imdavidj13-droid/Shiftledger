import type { Hono } from 'hono';
import { body, days, fail, isEmail, isoNow, orgAdmin, orgRoute, rnd, safeStr, sha, type ApiContext, type Env } from './http';

const pending = 'accepted_at IS NULL AND revoked_at IS NULL';
const path = orgRoute + '/invitations';
const idPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const canGrant = (c: ApiContext, role: string) => orgAdmin(c) && (role !== 'admin' || c.get('role') === 'owner');

export function registerInvitations(
  app: Hono<Env>,
  currentUser: (c: ApiContext) => Promise<{ id: string; email_normalized: string } | null>
) {
  app.get(path, async c => {
    if (!orgAdmin(c)) return fail(c, 'Not permitted', 403);
    const rows = await c.env.DB.prepare(`SELECT id,email_normalized,role,employee_id,expires_at,created_at,
      CASE WHEN accepted_at IS NOT NULL THEN 'accepted' WHEN revoked_at IS NOT NULL THEN 'revoked'
        WHEN expires_at<=? THEN 'expired' ELSE 'pending' END AS status
      FROM invitations WHERE organisation_id=? ORDER BY created_at DESC,id LIMIT 100`)
      .bind(isoNow(), c.get('organisationId')).all();
    return c.json({ invitations: rows.results });
  });

  app.post(path, async c => {
    if (!orgAdmin(c)) return fail(c, 'Not permitted', 403);
    const input = await body(c);
    const email = safeStr(input?.email, 255).toLowerCase(), role = safeStr(input?.role);
    const employeeId = safeStr(input?.employeeId, 65) || null;
    const locations: unknown[] = Array.isArray(input?.locationIds) ? input.locationIds : [];
    if (!isEmail(email) || !['employee', 'manager', 'admin'].includes(role) ||
        (employeeId && (role !== 'employee' || !idPattern.test(employeeId))) ||
        (input?.locationIds !== undefined && !Array.isArray(input.locationIds)) ||
        locations.length > 20 || new Set(locations).size !== locations.length ||
        locations.some(id => typeof id !== 'string' || !idPattern.test(id)) ||
        (role === 'manager' && !locations.length) || (role === 'admin' && locations.length)) {
      return fail(c, 'Enter a valid email, role and branch scope. Managers need at least one branch.', 422);
    }
    if (!canGrant(c, role)) return fail(c, 'Only the owner can invite administrators.', 403);
    const org = c.get('organisationId'), actor = c.get('userId');
    const id = crypto.randomUUID(), token = rnd(), expiresAt = days(7), now = isoNow();
    const locationIds = locations as string[];
    const scope = locationIds.length
      ? ' AND (SELECT COUNT(*) FROM locations WHERE organisation_id=?1 AND archived_at IS NULL AND id IN (' + locationIds.map(() => '?').join(',') + '))=' + locationIds.length
      : '';
    const result = await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO invitations(organisation_id,id,email_normalized,role,employee_id,token_hash,expires_at,created_at,created_by)
        SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9
        WHERE EXISTS (SELECT 1 FROM memberships WHERE organisation_id=?1 AND user_id=?9 AND status='active'
          AND (role='owner' OR (role='admin' AND ?4<>'admin')))
        AND NOT EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organisation_id=?1 AND u.email_normalized=?3)
        AND (?5 IS NULL OR EXISTS (SELECT 1 FROM employees WHERE organisation_id=?1 AND id=?5 AND user_id IS NULL AND employment_status='active'))
        ${scope} ON CONFLICT DO NOTHING`).bind(org,id,email,role,employeeId,await sha(token),expiresAt,now,actor,...locationIds),
      ...locationIds.map(locationId => c.env.DB.prepare(`INSERT INTO invitation_locations(organisation_id,invitation_id,location_id)
        SELECT organisation_id,id,? FROM invitations WHERE organisation_id=? AND id=?`).bind(locationId,org,id)),
      c.env.DB.prepare(`INSERT INTO audit_events(id,organisation_id,actor_user_id,action,resource_type,resource_id)
        SELECT ?,organisation_id,?,'create','invitation',id FROM invitations WHERE organisation_id=? AND id=?`).bind(crypto.randomUUID(),actor,org,id)
    ]);
    if (!result[0].meta.changes) return fail(c, 'An invitation or membership already exists, or the staff record or branch scope is unavailable.', 409);
    return c.json({ invitation: { id, token, expiresAt } }, 201);
  });

  app.post(path + '/:invitationId/:action{renew|revoke}', async c => {
    if (!orgAdmin(c)) return fail(c, 'Not permitted', 403);
    const org = c.get('organisationId'), id = c.req.param('invitationId');
    const invitation = await c.env.DB.prepare(`SELECT role FROM invitations WHERE organisation_id=? AND id=? AND ${pending}`)
      .bind(org,id).first<{role:string}>();
    if (!invitation) return fail(c, 'Open invitation not found', 404);
    if (!canGrant(c, invitation.role)) return fail(c, 'Not permitted', 403);
    const renew = c.req.param('action') === 'renew', token = rnd(), expiresAt = days(7), now = isoNow();
    const operation = renew ? 'token_hash=?,expires_at=?' : 'revoked_at=?';
    const values = renew ? [await sha(token),expiresAt] : [now];
    const updated = await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE invitations SET ${operation} WHERE organisation_id=? AND id=? AND ${pending}`)
        .bind(...values,org,id),
      c.env.DB.prepare(`INSERT INTO audit_events(id,organisation_id,actor_user_id,action,resource_type,resource_id)
        SELECT ?,?,?,?,'invitation',? WHERE changes()>0`).bind(crypto.randomUUID(),org,c.get('userId'),renew?'renew':'revoke',id)
    ]);
    if (!updated[0].meta.changes) return fail(c, 'Open invitation not found', 404);
    return c.json(renew ? { invitation: { id, token, expiresAt } } : { ok: true });
  });

  app.post('/api/v1/invitations/accept', async c => {
    const user = await currentUser(c);
    if (!user) return fail(c, 'Sign in required', 401);
    const input = await body(c), token = safeStr(input?.token, 65);
    if (!/^[a-f0-9]{64}$/.test(token)) return fail(c, 'Invalid invitation link', 422);
    const now = isoNow(), claim = crypto.randomUUID(), employeeId = crypto.randomUUID();
    const db = c.env.DB;
    const results = await db.batch<{organisation_id:string;role:string}>([
      db.prepare(`UPDATE invitations SET accepted_at=?1,accepted_by=?2,acceptance_id=?3
        WHERE token_hash=?4 AND email_normalized=?5 AND expires_at>?1 AND ${pending}
        AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.organisation_id=invitations.organisation_id AND m.user_id=?2)
        AND NOT EXISTS (SELECT 1 FROM invitation_locations il JOIN locations l
          ON l.organisation_id=il.organisation_id AND l.id=il.location_id
          WHERE il.organisation_id=invitations.organisation_id AND il.invitation_id=invitations.id AND l.archived_at IS NOT NULL)
        AND (role<>'employee' OR (
          NOT EXISTS (SELECT 1 FROM employees e WHERE e.organisation_id=invitations.organisation_id AND e.user_id=?2)
          AND (employee_id IS NULL OR EXISTS (SELECT 1 FROM employees e WHERE e.organisation_id=invitations.organisation_id
            AND e.id=invitations.employee_id AND e.user_id IS NULL AND e.employment_status='active'))))
        RETURNING organisation_id,role`).bind(now,user.id,claim,await sha(token),user.email_normalized),
      db.prepare(`INSERT INTO memberships(organisation_id,user_id,role)
        SELECT organisation_id,accepted_by,role FROM invitations WHERE acceptance_id=?`).bind(claim),
      db.prepare(`UPDATE employees SET user_id=? WHERE (organisation_id,id) IN
        (SELECT organisation_id,employee_id FROM invitations WHERE acceptance_id=? AND role='employee')`).bind(user.id,claim),
      db.prepare(`INSERT INTO employees(id,organisation_id,user_id,display_name)
        SELECT ?,i.organisation_id,i.accepted_by,u.display_name FROM invitations i JOIN users u ON u.id=i.accepted_by
        WHERE i.acceptance_id=? AND i.role='employee' AND i.employee_id IS NULL`).bind(employeeId,claim),
      db.prepare(`INSERT INTO employee_locations(organisation_id,employee_id,location_id)
        SELECT i.organisation_id,COALESCE(i.employee_id,?),il.location_id FROM invitations i
        JOIN invitation_locations il ON il.organisation_id=i.organisation_id AND il.invitation_id=i.id
        WHERE i.acceptance_id=? AND i.role='employee' ON CONFLICT DO NOTHING`).bind(employeeId,claim),
      db.prepare(`INSERT INTO location_access(organisation_id,location_id,user_id)
        SELECT i.organisation_id,il.location_id,i.accepted_by FROM invitations i
        JOIN invitation_locations il ON il.organisation_id=i.organisation_id AND il.invitation_id=i.id
        WHERE i.acceptance_id=? AND i.role='manager'`).bind(claim),
      db.prepare(`INSERT INTO audit_events(id,organisation_id,actor_user_id,action,resource_type,resource_id)
        SELECT ?,organisation_id,accepted_by,'accept','invitation',id FROM invitations WHERE acceptance_id=?`).bind(crypto.randomUUID(),claim)
    ]);
    const joined = results[0].results[0];
    if (!joined) return fail(c, 'This invitation is unavailable for this account. Check the email address or ask the organisation to issue a new link.', 404);
    return c.json({ organisationId: joined.organisation_id, role: joined.role });
  });

  app.patch(orgRoute + '/members/:userId', async c => {
    if (!orgAdmin(c)) return fail(c, 'Not permitted', 403);
    const user = c.req.param('userId') ?? '', input = await body(c), org = c.get('organisationId');
    const status = input?.status;
    if (status !== 'active' && status !== 'suspended') return fail(c, 'Use active or suspended membership status.', 422);
    const member = await c.env.DB.prepare('SELECT role,status FROM memberships WHERE organisation_id=? AND user_id=?')
      .bind(org,user).first<{role:string;status:string}>();
    if (!member) return fail(c, 'Membership not found', 404);
    if (member.role === 'owner' || !canGrant(c, member.role) || member.status === 'invited') return fail(c, 'Not permitted', 403);
    if (member.status !== status) {
      await c.env.DB.batch([
        c.env.DB.prepare('UPDATE memberships SET status=? WHERE organisation_id=? AND user_id=? AND role=? AND status=?')
          .bind(status,org,user,member.role,member.status),
        c.env.DB.prepare(`INSERT INTO audit_events(id,organisation_id,actor_user_id,action,resource_type,resource_id)
          SELECT ?,?,?,?,'membership',? WHERE changes()>0`).bind(crypto.randomUUID(),org,c.get('userId'),status==='active'?'restore':'suspend',user)
      ]);
    }
    return c.json({ok:true});
  });
}
