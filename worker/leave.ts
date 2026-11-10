import { Temporal } from '@js-temporal/polyfill';
import type { Hono } from 'hono';
import { audit, body, fail, isoNow, orgRoute, safeStr, type ApiContext, type Env } from './http';
import { activeEmployeeMember, canManage, locationPermission, schemaHasTable, staffEligible } from './workforce';

const path = orgRoute + '/leave';
const kinds = ['holiday', 'sickness', 'other'];
const statuses = ['pending', 'approved', 'declined', 'cancelled'];
const identifier = /^[a-zA-Z0-9_-]{1,64}$/;
const conflictingShift = `EXISTS (SELECT 1 FROM shifts s WHERE s.organisation_id=lr.organisation_id
  AND s.employee_id=lr.employee_id AND s.status IN ('draft','published')
  AND s.starts_at_utc<lr.ends_at_utc AND s.ends_at_utc>lr.starts_at_utc)`;

const select = (withConflict = false) => `SELECT lr.id,lr.employee_id,lr.location_id,lr.kind,lr.first_date,lr.last_date,lr.time_zone,lr.note,
  lr.status,lr.requested_at,lr.decided_at,lr.cancelled_at,e.display_name AS employee_name,l.name AS location_name
  ${withConflict ? ', ' + conflictingShift + ' AS shift_conflict' : ''}
  FROM leave_requests lr JOIN employees e ON e.organisation_id=lr.organisation_id AND e.id=lr.employee_id
  JOIN locations l ON l.organisation_id=lr.organisation_id AND l.id=lr.location_id`;
const inScope = (c: ApiContext) => canManage(c)
  ? locationPermission('?1','lr.location_id','?2')
  : 'e.user_id=?2 AND ' + activeEmployeeMember('?1','?2');

function dateRange(first: unknown, last: unknown) {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof first !== 'string' || typeof last !== 'string' || !datePattern.test(first) || !datePattern.test(last)) return null;
  try {
    const start = Temporal.PlainDate.from(first), end = Temporal.PlainDate.from(last).add({ days: 1 });
    const days = start.until(end).days;
    return days >= 1 && days <= 366 && datePattern.test(end.toString()) ? { first, last, start, end } : null;
  } catch { return null; }
}

const boundary = (date: Temporal.PlainDate, zone: string) =>
  date.toZonedDateTime(zone).toInstant().toString({ smallestUnit: 'millisecond' });

const schemaReady = (c: ApiContext) => schemaHasTable(c.env.DB, 'leave_requests');
const pendingUpdate = (c: ApiContext) => fail(c,'Leave requests require the pending database update.',503);

export function registerLeave(app: Hono<Env>) {
  app.get(path, async c => {
    if (!await schemaReady(c)) return pendingUpdate(c);
    const { location, status, cursor } = c.req.query();
    if ((location && !identifier.test(location)) || (status && !statuses.includes(status))) return fail(c,'Invalid leave filter.',422);
    const values: string[] = [c.get('organisationId'), c.get('userId')];
    let where = ' WHERE lr.organisation_id=?1 AND ' + inScope(c);
    if (location) { where += ' AND lr.location_id=?'; values.push(location); }
    if (status) { where += ' AND lr.status=?'; values.push(status); }
    if (cursor) {
      const [instant,id,extra] = cursor.split('|');
      if (!instant || !Number.isFinite(Date.parse(instant)) || !identifier.test(id || '') || extra !== undefined) {
        return fail(c,'Invalid leave cursor.',422);
      }
      where += ' AND (lr.requested_at,lr.id)<(?,?)';
      values.push(instant,id);
    }
    const rows = (await c.env.DB.prepare(select() + where + ' ORDER BY lr.requested_at DESC,lr.id DESC LIMIT 51')
      .bind(...values).all<{id:string;requested_at:string}>()).results;
    const requests = rows.slice(0,50), last = requests.at(-1);
    return c.json({ requests, nextCursor: rows.length > 50 && last ? last.requested_at + '|' + last.id : null });
  });

  app.get(path + '/:requestId', async c => {
    if (!await schemaReady(c)) return pendingUpdate(c);
    const row = await c.env.DB.prepare(select(canManage(c))
      + ' WHERE lr.organisation_id=?1 AND lr.id=?3 AND ' + inScope(c))
      .bind(c.get('organisationId'),c.get('userId'),c.req.param('requestId')).first();
    return row ? c.json({ request: row }) : fail(c,'Leave request not found.',404);
  });

  app.post(path, async c => {
    if (!await schemaReady(c)) return pendingUpdate(c);
    const data = await body(c);
    const kind = data?.kind, location = safeStr(data?.locationId,65), employee = safeStr(data?.employeeId,65);
    const note = safeStr(data?.note,501), range = dateRange(data?.firstDate,data?.lastDate), manage = canManage(c);
    if (!kinds.includes(kind) || !identifier.test(location) || !range || note.length > 500 ||
        (manage && !identifier.test(employee)) || (!manage && employee)) {
      return fail(c,'Enter an employee (if managing), a location, leave type and a date range of up to 366 days.',422);
    }
    const org = c.get('organisationId'), user = c.get('userId'), db = c.env.DB;
    const branch = await db.prepare(`SELECT l.time_zone FROM locations l WHERE l.organisation_id=?1 AND l.id=?2
      AND l.archived_at IS NULL AND ${manage ? locationPermission('?1','l.id','?3') : `EXISTS (
        SELECT 1 FROM employees e WHERE e.organisation_id=?1 AND e.user_id=?3 AND ${staffEligible('?1','l.id','e.id')})`}`)
      .bind(org,location,user).first<{ time_zone:string }>();
    if (!branch) return fail(c,'Location not found.',404);
    const zone = branch.time_zone;
    const start = boundary(range.start,zone), end = boundary(range.end,zone);
    if (start >= end) return fail(c,'The selected local dates do not exist in this location’s time zone.',422);
    const id = crypto.randomUUID();
    const results = await db.batch([
      db.prepare(`INSERT INTO leave_requests (organisation_id,id,employee_id,location_id,kind,first_date,last_date,
          time_zone,starts_at_utc,ends_at_utc,note,requested_at,requested_by)
        SELECT ?1,?2,e.id,l.id,?6,?7,?8,l.time_zone,?10,?11,?12,?13,?3
        FROM employees e JOIN locations l ON l.organisation_id=e.organisation_id
        WHERE e.organisation_id=?1 AND l.id=?4 AND l.archived_at IS NULL AND l.time_zone=?9
        AND ${manage ? "e.id=?5 AND " + locationPermission('?1','l.id','?3')
          : "?5='' AND e.user_id=?3 AND " + activeEmployeeMember('?1','?3')}
        AND ${staffEligible('?1','l.id','e.id')}
        AND NOT EXISTS (SELECT 1 FROM leave_requests lr WHERE lr.organisation_id=?1 AND lr.employee_id=e.id
          AND lr.status IN ('pending','approved') AND lr.starts_at_utc<?11 AND lr.ends_at_utc>?10)`)
        .bind(org,id,user,location,employee,kind,range.first,range.last,zone,start,end,note,isoNow()),
      audit(c,'request','leave',id,{locationId:location,kind},true)
    ]);
    if (!results[0].meta.changes) return fail(c,'The request overlaps existing leave, or the employee or location is no longer eligible.',409);
    return c.json({request:{id,status:'pending'}},201);
  });

  app.post(path + '/:requestId/:action{approve|decline|cancel}', async c => {
    const action = c.req.param('action'), manage = canManage(c);
    if (action !== 'cancel' && !manage) return fail(c,'Not permitted.',403);
    if (!await schemaReady(c)) return pendingUpdate(c);
    const id = c.req.param('requestId') || '', org = c.get('organisationId'), user = c.get('userId'), db = c.env.DB;
    const now = isoNow(), approve = action === 'approve', cancel = action === 'cancel';
    const acknowledge = approve && (await body(c))?.acknowledgeShiftConflict === true;
    const access = manage ? locationPermission('?1','lr.location_id','?2') : `${activeEmployeeMember('?1','?2')}
      AND EXISTS (SELECT 1 FROM employees e WHERE e.organisation_id=?1 AND e.id=lr.employee_id AND e.user_id=?2)`;
    const row = await db.prepare('SELECT 1 FROM leave_requests lr WHERE lr.organisation_id=?1 AND lr.id=?3 AND ' + access)
      .bind(org,user,id).first();
    if (!row) return fail(c,'Leave request not found.',404);
    const transition = cancel
      ? "status='cancelled',cancelled_at=?4,cancelled_by=?2"
      : `status='${approve ? 'approved' : 'declined'}',decided_at=?4,decided_by=?2`;
    const expected = cancel && manage ? "lr.status IN ('pending','approved')" : "lr.status='pending'";
    const approval = approve ? `AND (?5=1 OR NOT ${conflictingShift}) AND NOT EXISTS (
      SELECT 1 FROM leave_requests other WHERE other.organisation_id=?1 AND other.employee_id=lr.employee_id
      AND other.id<>lr.id AND other.status='approved' AND other.starts_at_utc<lr.ends_at_utc AND other.ends_at_utc>lr.starts_at_utc)` : '';
    const results = await db.batch([
      db.prepare(`UPDATE leave_requests AS lr SET ${transition} WHERE lr.organisation_id=?1 AND lr.id=?3
        AND ${expected} AND ${access} ${approval}`).bind(org,user,id,now,...(approve ? [Number(acknowledge)] : [])),
      audit(c,action || 'update','leave',id,{acknowledgedShiftConflict:acknowledge},true)
    ]);
    if (!results[0].meta.changes) return fail(c,approve
      ? 'The request changed, overlaps approved leave, or has a shift conflict that needs acknowledgement.'
      : 'This request can no longer move to that status.',409);
    return c.json({ok:true});
  });
}
