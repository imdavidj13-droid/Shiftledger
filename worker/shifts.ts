import type { Hono } from 'hono';
import { body, fail, isoNow, orgAdmin, orgRoute, safeStr, type ApiContext, type Env } from './http';

const path = orgRoute + '/shifts';
const active = "status IN ('draft','published')";
const selectShift = `SELECT s.id,s.location_id,s.employee_id,s.starts_at_utc,s.ends_at_utc,
  s.unpaid_break_minutes,s.status,s.revision,l.name AS location_name,l.time_zone,
  e.display_name AS employee_name
  FROM shifts s JOIN locations l ON l.organisation_id=s.organisation_id AND l.id=s.location_id
  LEFT JOIN employees e ON e.organisation_id=s.organisation_id AND e.id=s.employee_id`;
type Shift = {
  id: string; location_id: string; employee_id: string | null; starts_at_utc: string;
  ends_at_utc: string; unpaid_break_minutes: number; status: string; revision: number;
};

function scope(c: ApiContext) {
  if (orgAdmin(c)) return { sql: '', bindings: [] };
  if (c.get('role') === 'manager') return {
    sql: ` AND l.archived_at IS NULL AND EXISTS (SELECT 1 FROM location_access a
      WHERE a.organisation_id=s.organisation_id AND a.location_id=s.location_id AND a.user_id=?)`,
    bindings: [c.get('userId')]
  };
  return {
    sql: ` AND l.archived_at IS NULL AND s.status='published' AND e.user_id=? AND e.employment_status='active'
      AND EXISTS (SELECT 1 FROM employee_locations el WHERE el.organisation_id=s.organisation_id
        AND el.location_id=s.location_id AND el.employee_id=s.employee_id)`,
    bindings: [c.get('userId')]
  };
}
async function findShift(c: ApiContext, id: string) {
  const access = scope(c);
  return c.env.DB.prepare(selectShift + ' WHERE s.organisation_id=? AND s.id=?' + access.sql)
    .bind(c.get('organisationId'),id,...access.bindings).first<Shift>();
}
function utc(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const iso = new Date(ms).toISOString();
  return iso.slice(0,19) === value.slice(0,19) ? iso : null;
}

const canManage = (c: ApiContext) => orgAdmin(c) || c.get('role') === 'manager';
const locationPermission = (org: string, location: string, user: string) => `EXISTS (
  SELECT 1 FROM memberships m WHERE m.organisation_id=${org} AND m.user_id=${user} AND m.status='active'
  AND (m.role IN ('owner','admin') OR (m.role='manager' AND EXISTS
    (SELECT 1 FROM location_access a WHERE a.organisation_id=${org} AND a.location_id=${location} AND a.user_id=${user}))))`;
const staffEligible = (org: string, location: string, employee: string) => `EXISTS (
  SELECT 1 FROM employee_locations el JOIN employees e ON e.organisation_id=el.organisation_id AND e.id=el.employee_id
  WHERE el.organisation_id=${org} AND el.location_id=${location} AND el.employee_id=${employee} AND e.employment_status='active')`;
const activeLocation = (org: string, location: string) => `EXISTS (
  SELECT 1 FROM locations WHERE organisation_id=${org} AND id=${location} AND archived_at IS NULL)`;
const noOverlap = (org: string, id: string, employee: string, start: string, end: string) => `NOT EXISTS (
  SELECT 1 FROM shifts overlapping WHERE overlapping.organisation_id=${org} AND overlapping.employee_id=${employee}
    AND overlapping.id<>${id} AND overlapping.${active} AND overlapping.starts_at_utc<${end} AND overlapping.ends_at_utc>${start})`;
const writeGuard = `${activeLocation('?2','?3')} AND ${locationPermission('?2','?3','?8')}
  AND (?4 IS NULL OR (${staffEligible('?2','?3','?4')} AND ${noOverlap('?2','?1','?4','?5','?6')}))`;

function auditChange(c: ApiContext, action: string, id: string, details: object) {
  return c.env.DB.prepare(`INSERT INTO audit_events(id,organisation_id,actor_user_id,action,resource_type,resource_id,details_json)
    SELECT ?,?,?,?,'shift',?,? WHERE changes()>0`)
    .bind(crypto.randomUUID(),c.get('organisationId'),c.get('userId'),action,id,JSON.stringify(details));
}

async function saveDraft(c: ApiContext, previous?: Shift) {
  const input = await body(c);
  const location = safeStr(input?.locationId,64), employee = safeStr(input?.employeeId,64) || null;
  const start = utc(input?.startsAt), end = utc(input?.endsAt), breaks = input?.breakMinutes ?? 0;
  const version = input?.revision;
  if (!location || !start || !end || start >= end || !Number.isInteger(breaks) || breaks < 0 || breaks > 1440 ||
      (previous && (!Number.isInteger(version) || version < 1))) return fail(c,'Enter a location, valid UTC start and end times, and unpaid break minutes.',422);
  if (breaks * 60000 >= Date.parse(end) - Date.parse(start)) return fail(c,'Break must be shorter than the shift.',422);
  if (previous && (previous.status !== 'draft' || previous.revision !== version)) return fail(c,'This shift changed or is no longer a draft. Refresh and try again.',409);
  const org = c.get('organisationId'), user = c.get('userId'), id = previous?.id || crypto.randomUUID();
  const db = c.env.DB;
  if (!await db.prepare('SELECT 1 FROM locations WHERE organisation_id=? AND id=? AND archived_at IS NULL').bind(org,location).first()) {
    return fail(c,'Location not found',404);
  }
  if (c.get('role') === 'manager' && !await db.prepare('SELECT 1 FROM location_access WHERE organisation_id=? AND location_id=? AND user_id=?').bind(org,location,user).first()) {
    return fail(c,'You do not manage this location',403);
  }
  if (employee && !await db.prepare('SELECT 1 WHERE ' + staffEligible('?','?','?')).bind(org,location,employee).first()) {
    return fail(c,'Assign an active employee to the selected location before scheduling them',422);
  }
  const values = [id,org,location,employee,start,end,breaks,user];
  const change = previous
    ? db.prepare(`UPDATE shifts SET location_id=?3,employee_id=?4,starts_at_utc=?5,ends_at_utc=?6,
        unpaid_break_minutes=?7,updated_at=?10,revision=revision+1
        WHERE id=?1 AND organisation_id=?2 AND revision=?9 AND status='draft' AND ${writeGuard}
        AND ${locationPermission('?2','shifts.location_id','?8')}`).bind(...values,version,isoNow())
    : db.prepare(`INSERT INTO shifts(id,organisation_id,location_id,employee_id,starts_at_utc,ends_at_utc,unpaid_break_minutes)
        SELECT ?1,?2,?3,?4,?5,?6,?7 WHERE ${writeGuard}`).bind(...values);
  const results = await db.batch([change,auditChange(c,previous?'update':'create',id,{
    revision: previous ? previous.revision + 1 : 1, locationId: location, employeeId: employee, startsAt: start, endsAt: end, breakMinutes: breaks
  })]);
  if (!results[0].meta.changes) return fail(c,'The employee has an overlapping shift or the shift, location or assignment has changed.',409);
  return c.json({shift:{id,status:'draft',revision:previous?previous.revision+1:1}},previous?200:201);
}

export function registerShifts(app: Hono<Env>) {
  app.get(path, async c => {
    const access = scope(c), location = c.req.query('location');
    const fromValue = c.req.query('from'), toValue = c.req.query('to'), cursor = c.req.query('cursor');
    const from = utc(fromValue), to = utc(toValue);
    if ((fromValue || toValue) && (!from || !to || from >= to || Date.parse(to) - Date.parse(from) > 32*86400000)) {
      return fail(c,'Provide a valid time range up to 32 days.',422);
    }
    const args: string[] = [c.get('organisationId'), ...access.bindings];
    let sql = selectShift + ' WHERE s.organisation_id=?' + access.sql;
    if (location) { sql += ' AND s.location_id=?'; args.push(location); }
    if (from && to) { sql += ' AND s.starts_at_utc<? AND s.ends_at_utc>?'; args.push(to,from); }
    if (cursor) {
      const [instant,id,extra] = cursor.split('|');
      if (!utc(instant) || !/^[a-zA-Z0-9_-]{1,64}$/.test(id || '') || extra !== undefined) return fail(c,'Invalid shift cursor',422);
      sql += ' AND (s.starts_at_utc,s.id)<(?,?)'; args.push(instant,id);
    }
    const rows = (await c.env.DB.prepare(sql + ' ORDER BY s.starts_at_utc DESC,s.id DESC LIMIT 201').bind(...args).all<Shift>()).results;
    const shifts = rows.slice(0,200), last = shifts.at(-1);
    return c.json({shifts,nextCursor:rows.length>200&&last?last.starts_at_utc+'|'+last.id:null});
  });
  app.get(path+'/:shiftId',async c=>{
    const shift = await findShift(c,c.req.param('shiftId') || '');
    return shift ? c.json({shift}) : fail(c,'Shift not found',404);
  });
  app.post(path, c => canManage(c) ? saveDraft(c) : fail(c,'Not permitted',403));
  app.patch(path+'/:shiftId',async c=>{
    if (!canManage(c)) return fail(c,'Not permitted',403);
    const shift = await findShift(c,c.req.param('shiftId') || '');
    return shift ? saveDraft(c,shift) : fail(c,'Shift not found',404);
  });
  app.post(path+'/:shiftId/:operation{publish|cancel|discard}', async c => {
    if (!canManage(c)) return fail(c,'Not permitted',403);
    const id = c.req.param('shiftId') || '', action = c.req.param('operation') || '';
    const shift = await findShift(c,id);
    if (!shift) return fail(c,'Shift not found',404);
    const revision = (await body(c))?.revision;
    if (!Number.isInteger(revision) || revision < 1) return fail(c,'A valid shift revision is required.',422);
    const next = action === 'publish' ? 'published' : 'cancelled';
    const expected = action === 'cancel' ? 'published' : 'draft';
    const org = c.get('organisationId'), user = c.get('userId');
    const where = `organisation_id=?1 AND id=?2 AND revision=?3 AND status=?4
      AND ${locationPermission('?1','shifts.location_id','?5')}`;
    const db = c.env.DB;
    const change = action === 'discard'
      ? db.prepare('DELETE FROM shifts WHERE ' + where).bind(org,id,revision,expected,user)
      : db.prepare(`UPDATE shifts SET status=?6,updated_at=?7,revision=revision+1 WHERE ${where}
        ${action === 'publish' ? `AND ${activeLocation('?1','shifts.location_id')}
          AND (employee_id IS NULL OR (${staffEligible('?1','shifts.location_id','shifts.employee_id')}
          AND ${noOverlap('?1','shifts.id','shifts.employee_id','shifts.starts_at_utc','shifts.ends_at_utc')}))` : ''}`)
        .bind(org,id,revision,expected,user,next,isoNow());
    const results = await db.batch([change,auditChange(c,action,id,{
      revision,locationId:shift.location_id,employeeId:shift.employee_id,startsAt:shift.starts_at_utc,endsAt:shift.ends_at_utc
    })]);
    if (!results[0].meta.changes) return fail(c,'The shift changed or can no longer be moved to this status.',409);
    return c.json({ok:true});
  });
}
