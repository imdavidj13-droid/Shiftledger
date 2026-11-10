import type { Hono } from 'hono';
import { audit, body, fail, isoNow, orgRoute, safeStr, type ApiContext, type Env } from './http';
import { activeEmployeeMember, activeLocation, canManage, locationPermission, noApprovedLeave, schemaHasTable, staffEligible, utc } from './workforce';

const path = orgRoute + '/shift-swaps';
const idPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const statuses = ['awaiting_employee','pending','approved','declined','cancelled'];
const active = "status IN ('awaiting_employee','pending')";
const ready = (c: ApiContext) => schemaHasTable(c.env.DB,'shift_swaps');
const pending = (c: ApiContext) => fail(c,'Shift swaps require the pending database update.',503);

const shifts = `JOIN shifts a ON a.organisation_id=w.organisation_id AND a.id=w.offered_shift_id
  JOIN shifts b ON b.organisation_id=w.organisation_id AND b.id=w.requested_shift_id`;
const employees = `JOIN employees proposer ON proposer.organisation_id=w.organisation_id AND proposer.id=w.offering_employee_id
  JOIN employees recipient ON recipient.organisation_id=w.organisation_id AND recipient.id=w.receiving_employee_id`;
const manageBoth = (user: string) => `${locationPermission('a.organisation_id','a.location_id',user)}
  AND ${locationPermission('b.organisation_id','b.location_id',user)}`;
const inScope = (c: ApiContext) => canManage(c) ? manageBoth('?2') :
  `(proposer.user_id=?2 OR recipient.user_id=?2) AND ${activeEmployeeMember('?1','?2')}`;

const summary = `SELECT w.id,w.status,w.created_at,w.consent_at,w.decided_at,
  a.id AS offered_shift_id,b.id AS requested_shift_id,
  a.starts_at_utc AS offered_start,a.ends_at_utc AS offered_end,b.starts_at_utc AS requested_start,b.ends_at_utc AS requested_end,
  proposer.display_name AS offering_name,recipient.display_name AS receiving_name,
  first_branch.name AS offered_branch,first_branch.time_zone AS offered_zone,
  second_branch.name AS requested_branch,second_branch.time_zone AS requested_zone
  FROM shift_swaps w ${shifts} ${employees}
  JOIN locations first_branch ON first_branch.organisation_id=a.organisation_id AND first_branch.id=a.location_id
  JOIN locations second_branch ON second_branch.organisation_id=b.organisation_id AND second_branch.id=b.location_id`;

function freeFor(shift: string, staff: string) {
  return `NOT EXISTS (SELECT 1 FROM shifts other WHERE other.organisation_id=${shift}.organisation_id
    AND other.employee_id=${staff} AND other.id NOT IN (a.id,b.id) AND other.status IN ('draft','published')
    AND other.starts_at_utc<${shift}.ends_at_utc AND other.ends_at_utc>${shift}.starts_at_utc)
    AND ${noApprovedLeave(shift + '.organisation_id',staff,shift + '.starts_at_utc',shift + '.ends_at_utc')}`;
}

const pairAvailable = (now: string) => `a.status='published' AND b.status='published'
  AND a.starts_at_utc>${now} AND b.starts_at_utc>${now}
  AND a.employee_id<>b.employee_id
  AND ${activeLocation('a.organisation_id','a.location_id')} AND ${activeLocation('b.organisation_id','b.location_id')}
  AND ${staffEligible('a.organisation_id','a.location_id','a.employee_id')}
  AND ${staffEligible('b.organisation_id','b.location_id','b.employee_id')}
  AND ${staffEligible('a.organisation_id','a.location_id','b.employee_id')}
  AND ${staffEligible('b.organisation_id','b.location_id','a.employee_id')}
  AND ${freeFor('a','b.employee_id')} AND ${freeFor('b','a.employee_id')}`;

const unchanged = `a.revision=w.offered_revision AND b.revision=w.requested_revision
  AND a.employee_id=w.offering_employee_id AND b.employee_id=w.receiving_employee_id`;

type SwapRow = { id: string; created_at: string };
async function find(c: ApiContext, id: string) {
  return c.env.DB.prepare(summary + ' WHERE w.organisation_id=?1 AND w.id=?3 AND ' + inScope(c))
    .bind(c.get('organisationId'),c.get('userId'),id).first<SwapRow>();
}

export function registerSwaps(app: Hono<Env>) {
  app.get(path, async c => {
    if (!await ready(c)) return pending(c);
    const { location,status,cursor } = c.req.query();
    if ((location && !idPattern.test(location)) || (status && !statuses.includes(status))) return fail(c,'Invalid swap filter.',422);
    const values = [c.get('organisationId'),c.get('userId')];
    let where = ' WHERE w.organisation_id=?1 AND ' + inScope(c);
    if (location) { where += ' AND (a.location_id=? OR b.location_id=?)'; values.push(location,location); }
    if (status) { where += ' AND w.status=?'; values.push(status); }
    if (cursor) {
      const [instant,id,extra] = cursor.split('|');
      if (!utc(instant) || !idPattern.test(id || '') || extra !== undefined) return fail(c,'Invalid swap cursor.',422);
      where += ' AND (w.created_at,w.id)<(?,?)'; values.push(instant,id);
    }
    const rows = (await c.env.DB.prepare(summary + where + ' ORDER BY w.created_at DESC,w.id DESC LIMIT 51')
      .bind(...values).all<SwapRow>()).results;
    const swaps = rows.slice(0,50), last = swaps.at(-1);
    return c.json({swaps,nextCursor:rows.length>50 && last ? last.created_at + '|' + last.id : null});
  });

  app.get(path + '/:swapId', async c => {
    if (!await ready(c)) return pending(c);
    const swap = await find(c,c.req.param('swapId') || '');
    return swap ? c.json({swap}) : fail(c,'Swap request not found.',404);
  });

  app.post(path, async c => {
    if (!await ready(c)) return pending(c);
    const input = await body(c), offered = safeStr(input?.offeredShiftId,65), requested = safeStr(input?.requestedShiftId,65);
    const manage = canManage(c), consent = manage && input?.confirmedConsent === true;
    if (!idPattern.test(offered) || !idPattern.test(requested) || offered === requested || (manage && !consent)) {
      return fail(c,'Select two different shifts and confirm both employees agreed if recording a swap for them.',422);
    }
    const org = c.get('organisationId'), user = c.get('userId'), id = crypto.randomUUID(), now = isoNow(), db = c.env.DB;
    const access = manage ? manageBoth('?5') : `proposer.user_id=?5 AND recipient.user_id IS NOT NULL
      AND ${activeEmployeeMember('?1','?5')} AND ${activeEmployeeMember('?1','recipient.user_id')}`;
    const status = consent ? 'pending' : 'awaiting_employee';
    const result = await db.batch([
      db.prepare(`INSERT INTO shift_swaps(organisation_id,id,offered_shift_id,requested_shift_id,
          offering_employee_id,receiving_employee_id,offered_revision,requested_revision,status,created_at,created_by,consent_at,consent_by)
        SELECT ?1,?2,a.id,b.id,a.employee_id,b.employee_id,a.revision,b.revision,?7,?6,?5,
          CASE WHEN ?7='pending' THEN ?6 END,CASE WHEN ?7='pending' THEN ?5 END
        FROM shifts a JOIN shifts b ON b.organisation_id=a.organisation_id
        JOIN employees proposer ON proposer.organisation_id=a.organisation_id AND proposer.id=a.employee_id
        JOIN employees recipient ON recipient.organisation_id=b.organisation_id AND recipient.id=b.employee_id
        WHERE a.organisation_id=?1 AND a.id=?3 AND b.id=?4 AND ${access} AND ${pairAvailable('?6')}
        AND NOT EXISTS (SELECT 1 FROM shift_swaps w WHERE w.organisation_id=?1 AND w.${active}
          AND (w.offered_shift_id IN (?3,?4) OR w.requested_shift_id IN (?3,?4)))`)
        .bind(org,id,offered,requested,user,now,status),
      audit(c,'request','shift_swap',id,{offeredShiftId:offered,requestedShiftId:requested,managerRecordedConsent:consent},true)
    ]);
    if (!result[0].meta.changes) return fail(c,'The shifts are unavailable, already in a swap, or the new assignments would conflict.',409);
    return c.json({swap:{id,status}},201);
  });

  app.post(path + '/:swapId/:action{accept|approve|decline|cancel}', async c => {
    const action = c.req.param('action'), manage = canManage(c);
    if ((action === 'approve' && !manage) || (action === 'accept' && manage)) return fail(c,'Not permitted.',403);
    if (!await ready(c)) return pending(c);
    const id = c.req.param('swapId') || '', org = c.get('organisationId'), user = c.get('userId'), now = isoNow(), db = c.env.DB;
    if (!await find(c,id)) return fail(c,'Swap request not found.',404);
    const writes: D1PreparedStatement[] = [];
    if (action === 'approve') {
      const approval = crypto.randomUUID();
      // A unique decision marker scopes the second statement to this successful review.
      writes.push(db.prepare(`UPDATE shift_swaps SET status='approved',decided_at=?4,decided_by=?2,approval_id=?5
        WHERE organisation_id=?1 AND id=?3 AND status='pending' AND EXISTS (
          SELECT 1 FROM shift_swaps w ${shifts}
          LEFT JOIN memberships consent_source ON consent_source.organisation_id=w.organisation_id
            AND consent_source.user_id=w.created_by AND consent_source.role='employee' AND consent_source.status='active'
          LEFT JOIN memberships consent_target ON consent_target.organisation_id=w.organisation_id
            AND consent_target.user_id=w.consent_by AND consent_target.role='employee' AND consent_target.status='active'
          WHERE w.organisation_id=?1 AND w.id=?3 AND ${manageBoth('?2')} AND ${unchanged} AND ${pairAvailable('?4')}
          AND (w.created_by=w.consent_by OR (consent_source.user_id IS NOT NULL AND consent_target.user_id IS NOT NULL))
        )`).bind(org,user,id,now,approval));
      writes.push(db.prepare(`UPDATE shifts AS s SET employee_id=(
          SELECT CASE WHEN s.id=w.offered_shift_id THEN w.receiving_employee_id ELSE w.offering_employee_id END
          FROM shift_swaps w WHERE w.organisation_id=?1 AND w.approval_id=?2
        ),revision=revision+1,updated_at=?3 WHERE s.organisation_id=?1 AND EXISTS (
          SELECT 1 FROM shift_swaps w WHERE w.organisation_id=?1 AND w.approval_id=?2
          AND s.id IN (w.offered_shift_id,w.requested_shift_id)
        )`).bind(org,approval,now));
    } else if (action === 'accept') {
      writes.push(db.prepare(`UPDATE shift_swaps SET status='pending',consent_at=?4,consent_by=?2
        WHERE organisation_id=?1 AND id=?3 AND status='awaiting_employee' AND EXISTS (
          SELECT 1 FROM shift_swaps w ${shifts} ${employees} WHERE w.organisation_id=?1 AND w.id=?3
          AND recipient.user_id=?2 AND ${activeEmployeeMember('?1','?2')}
          AND ${activeEmployeeMember('?1','proposer.user_id')} AND ${unchanged} AND ${pairAvailable('?4')})`).bind(org,user,id,now));
    } else {
      const access = manage ? manageBoth('?2') : `${activeEmployeeMember('?1','?2')} AND ${action === 'decline'
        ? "recipient.user_id=?2 AND w.status='awaiting_employee'" : '(proposer.user_id=?2 OR recipient.user_id=?2)'}`;
      writes.push(db.prepare(`UPDATE shift_swaps SET status=?5,decided_at=?4,decided_by=?2
        WHERE organisation_id=?1 AND id=?3 AND ${active} AND EXISTS (
          SELECT 1 FROM shift_swaps w ${shifts} ${employees} WHERE w.organisation_id=?1 AND w.id=?3
          AND ${access})`).bind(org,user,id,now,action === 'decline' ? 'declined' : 'cancelled'));
    }
    writes.push(audit(c,action || 'update','shift_swap',id,{},true));
    const results = await db.batch(writes);
    if (!results[0].meta.changes) return fail(c,'This swap is no longer actionable, or one of the assignments now has a conflict.',409);
    return c.json({ok:true});
  });
}
