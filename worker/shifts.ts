import type { Hono } from 'hono';
import { audit, body, fail, isoNow, orgAdmin, orgRoute, safeStr, type ApiContext, type Env } from './http';
import { activeEmployeeMember, activeLocation, canManage, locationPermission, noApprovedLeave, noOverlap, schemaHasTable, staffEligible, utc } from './workforce';

const path = orgRoute + '/shifts';
const leaveConflict = `s.status IN ('draft','published') AND s.employee_id IS NOT NULL
  AND NOT ${noApprovedLeave('s.organisation_id','s.employee_id','s.starts_at_utc','s.ends_at_utc')}`;
const selectShift = (openShifts: boolean, leaveEnabled = false) => `SELECT s.id,s.location_id,s.employee_id,s.starts_at_utc,s.ends_at_utc,
  s.unpaid_break_minutes,s.status,s.revision,${openShifts ? 's.is_open' : '0 AS is_open'},l.name AS location_name,l.time_zone,
  e.display_name AS employee_name,${leaveEnabled ? '(' + leaveConflict + ')' : '0'} AS leave_conflict
  FROM shifts s JOIN locations l ON l.organisation_id=s.organisation_id AND l.id=s.location_id
  LEFT JOIN employees e ON e.organisation_id=s.organisation_id AND e.id=s.employee_id`;
type Shift = {
  id: string; location_id: string; employee_id: string | null; starts_at_utc: string;
  ends_at_utc: string; unpaid_break_minutes: number; status: string; revision: number; is_open: number;
};

function scope(c: ApiContext, openShifts: boolean) {
  if (orgAdmin(c)) return { sql: '', bindings: [] };
  if (c.get('role') === 'manager') return {
    sql: ` AND l.archived_at IS NULL AND EXISTS (SELECT 1 FROM location_access a
      WHERE a.organisation_id=s.organisation_id AND a.location_id=s.location_id AND a.user_id=?)`,
    bindings: [c.get('userId')]
  };
  return {
    sql: ` AND l.archived_at IS NULL AND s.status='published'
      AND EXISTS (SELECT 1 FROM employees staff JOIN employee_locations el
        ON el.organisation_id=staff.organisation_id AND el.employee_id=staff.id
        WHERE staff.organisation_id=s.organisation_id AND el.location_id=s.location_id
        AND staff.user_id=? AND staff.employment_status='active'
        AND (staff.id=s.employee_id ${openShifts ? "OR (s.is_open=1 AND s.starts_at_utc>?)" : ''}))`,
    bindings: openShifts ? [c.get('userId'), isoNow()] : [c.get('userId')]
  };
}
async function findShift(c: ApiContext, id: string, openShifts: boolean, leaveEnabled = false) {
  const access = scope(c, openShifts);
  return c.env.DB.prepare(selectShift(openShifts,leaveEnabled) + ' WHERE s.organisation_id=? AND s.id=?' + access.sql)
    .bind(c.get('organisationId'),id,...access.bindings).first<Shift>();
}

const openShiftSchema = (c: ApiContext) => schemaHasTable(c.env.DB, 'shift_claims');
const writeGuard = (leaveEnabled: boolean) => `${activeLocation('?2','?3')} AND ${locationPermission('?2','?3','?8')}
  AND (?4 IS NULL OR (${staffEligible('?2','?3','?4')} AND ${noOverlap('?2','?1','?4','?5','?6')}
    ${leaveEnabled ? 'AND ' + noApprovedLeave('?2','?4','?5','?6') : ''}))`;

async function saveShift(c: ApiContext, openShifts: boolean, previous?: Shift) {
  const input = await body(c);
  const location = safeStr(input?.locationId,64), employee = safeStr(input?.employeeId,64) || null;
  const open = input?.isOpen ?? Boolean(previous?.is_open);
  if (typeof open !== 'boolean' || (open && employee)) return fail(c,'An open shift must be unassigned.',422);
  if (open && !openShifts) return fail(c,'Open shifts require the pending database update.',503);
  const start = utc(input?.startsAt), end = utc(input?.endsAt), breaks = input?.breakMinutes ?? 0;
  const version = input?.revision;
  if (!location || !start || !end || start >= end || !Number.isInteger(breaks) || breaks < 0 || breaks > 1440 ||
      (previous && (!Number.isInteger(version) || version < 1))) return fail(c,'Enter a location, valid UTC start and end times, and unpaid break minutes.',422);
  if (breaks * 60000 >= Date.parse(end) - Date.parse(start)) return fail(c,'Break must be shorter than the shift.',422);
  if (previous && (previous.status === 'cancelled' || previous.revision !== version)) {
    return fail(c,'This shift changed or was cancelled. Refresh and try again.',409);
  }
  const published = previous?.status === 'published';
  const now = isoNow();
  if (published && (previous.is_open || !previous.employee_id || !employee || open || previous.starts_at_utc <= now || start <= now)) {
    return fail(c,'Only upcoming published shifts with an employee assignment can be edited.',409);
  }
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
  const [leaveEnabled,timekeeping] = await Promise.all([
    Boolean(employee) && schemaHasTable(db,'leave_requests'), published && schemaHasTable(db,'time_entries')
  ]);
  const guard = writeGuard(leaveEnabled);
  const publishedGuard = published ? `AND starts_at_utc>?10 AND employee_id IS NOT NULL
    ${timekeeping ? 'AND NOT EXISTS (SELECT 1 FROM time_entries t WHERE t.organisation_id=?2 AND t.shift_id=?1)' : ''}` : '';
  const values = [id,org,location,employee,start,end,breaks,user];
  const change = previous
    ? db.prepare(`UPDATE shifts SET location_id=?3,employee_id=?4,starts_at_utc=?5,ends_at_utc=?6,
        unpaid_break_minutes=?7,updated_at=?10,revision=revision+1${openShifts ? ',is_open=?12' : ''}
        WHERE id=?1 AND organisation_id=?2 AND revision=?9 AND status=?11 AND ${guard} ${publishedGuard}
        AND ${locationPermission('?2','shifts.location_id','?8')}`).bind(...values,version,now,previous.status,...(openShifts ? [Number(open)] : []))
    : db.prepare(`INSERT INTO shifts(id,organisation_id,location_id,employee_id,starts_at_utc,ends_at_utc,unpaid_break_minutes${openShifts ? ',is_open' : ''})
        SELECT ?1,?2,?3,?4,?5,?6,?7${openShifts ? ',?9' : ''} WHERE ${guard}`)
        .bind(...values,...(openShifts ? [Number(open)] : []));
  const results = await db.batch([change,audit(c,published?'revise':previous?'update':'create','shift',id,{
    previous: published ? {locationId:previous.location_id,employeeId:previous.employee_id,
      startsAt:previous.starts_at_utc,endsAt:previous.ends_at_utc,breakMinutes:previous.unpaid_break_minutes} : undefined,
    revision: previous ? previous.revision + 1 : 1, locationId: location, employeeId: employee, startsAt: start, endsAt: end, breakMinutes: breaks, isOpen: open
  },true)]);
  if (!results[0].meta.changes) return fail(c,'The employee has a shift or leave conflict, the assignment changed, or timekeeping has already started.',409);
  return c.json({shift:{id,status:previous?.status || 'draft',revision:previous?previous.revision+1:1}},previous?200:201);
}

function claimEligible(shift: string, employee: string, now: string, leaveEnabled: boolean) {
  return `${shift}.status='published' AND ${shift}.is_open=1 AND ${shift}.starts_at_utc>${now}
    AND ${activeLocation(shift + '.organisation_id',shift + '.location_id')}
    AND ${staffEligible(shift + '.organisation_id',shift + '.location_id',employee)}
    AND ${noOverlap(shift + '.organisation_id',shift + '.id',employee,shift + '.starts_at_utc',shift + '.ends_at_utc')}
    ${leaveEnabled ? 'AND ' + noApprovedLeave(shift + '.organisation_id',employee,shift + '.starts_at_utc',shift + '.ends_at_utc') : ''}`;
}

function registerClaims(app: Hono<Env>) {
  const claimPath = path + '/:shiftId/claims';
  app.get(claimPath, async c => {
    if (!canManage(c)) return fail(c,'Not permitted',403);
    if (!await openShiftSchema(c)) return fail(c,'Open shifts require the pending database update.',503);
    const id = c.req.param('shiftId') || '';
    if (!await findShift(c,id,true)) return fail(c,'Shift not found',404);
    const claims = await c.env.DB.prepare(`SELECT cl.id,cl.employee_id,cl.status,cl.requested_at,cl.decided_at,
      e.display_name AS employee_name FROM shift_claims cl JOIN employees e
      ON e.organisation_id=cl.organisation_id AND e.id=cl.employee_id
      WHERE cl.organisation_id=? AND cl.shift_id=? ORDER BY (cl.status='pending') DESC,cl.requested_at DESC LIMIT 100`)
      .bind(c.get('organisationId'),id).all();
    return c.json({claims:claims.results});
  });

  app.post(claimPath, async c => {
    if (c.get('role') !== 'employee') return fail(c,'Only employees can request a vacancy.',403);
    if (!await openShiftSchema(c)) return fail(c,'Open shifts require the pending database update.',503);
    const shiftId = c.req.param('shiftId') || '', org = c.get('organisationId'), user = c.get('userId');
    const shift = await findShift(c,shiftId,true);
    if (!shift?.is_open) return fail(c,'Open shift not found',404);
    const db = c.env.DB, id = crypto.randomUUID(), now = isoNow();
    const leaveEnabled = await schemaHasTable(db,'leave_requests');
    const results = await db.batch([
      db.prepare(`INSERT INTO shift_claims(organisation_id,id,shift_id,employee_id,requested_at)
        SELECT ?1,?2,s.id,e.id,?5 FROM shifts s JOIN employees e ON e.organisation_id=s.organisation_id
        WHERE s.organisation_id=?1 AND s.id=?3 AND e.user_id=?4 AND ${activeEmployeeMember('?1','?4')}
        AND ${claimEligible('s','e.id','?5',leaveEnabled)} ON CONFLICT DO NOTHING`).bind(org,id,shiftId,user,now),
      audit(c,'request','shift_claim',id,{shiftId},true)
    ]);
    if (!results[0].meta.changes) return fail(c,'This vacancy already has a claim or is no longer available to you.',409);
    return c.json({claim:{id,status:'pending'}},201);
  });

  app.post(claimPath + '/:claimId/:action{approve|decline}', async c => {
    if (!canManage(c)) return fail(c,'Not permitted',403);
    if (!await openShiftSchema(c)) return fail(c,'Open shifts require the pending database update.',503);
    const shiftId = c.req.param('shiftId') || '', id = c.req.param('claimId') || '';
    const shift = await findShift(c,shiftId,true);
    if (!shift) return fail(c,'Shift not found',404);
    const action = c.req.param('action') || '', approve = action === 'approve';
    const org = c.get('organisationId'), user = c.get('userId'), now = isoNow(), db = c.env.DB;
    const leaveEnabled = approve && await schemaHasTable(db,'leave_requests');
    const candidate = `SELECT cl.employee_id FROM shift_claims cl JOIN employees e
      ON e.organisation_id=cl.organisation_id AND e.id=cl.employee_id
      WHERE cl.organisation_id=?1 AND cl.shift_id=?2 AND cl.id=?3 AND cl.status='pending'
      AND ${activeEmployeeMember('?1','e.user_id')} AND ${claimEligible('shifts','cl.employee_id','?5',leaveEnabled)}`;
    const approveShift = db.prepare(`UPDATE shifts SET employee_id=(${candidate}),is_open=0,revision=revision+1,updated_at=?5
      WHERE organisation_id=?1 AND id=?2 AND ${locationPermission('?1','shifts.location_id','?4')}
      AND EXISTS (${candidate})`).bind(org,shiftId,id,user,now);
    const decide = db.prepare(`UPDATE shift_claims SET status=?6,decided_by=?4,decided_at=?5
      WHERE organisation_id=?1 AND shift_id=?2 AND id=?3 AND status='pending'
      AND ${approve ? 'changes()>0' : `EXISTS (SELECT 1 FROM shifts s WHERE s.organisation_id=?1 AND s.id=?2
        AND s.status='published' AND s.is_open=1 AND ${locationPermission('?1','s.location_id','?4')})`}`)
      .bind(org,shiftId,id,user,now,approve?'approved':'declined');
    const writes = approve ? [approveShift,decide] : [decide];
    writes.push(audit(c,action,'shift_claim',id,{shiftId},true));
    const results = await db.batch(writes);
    if (!results[0].meta.changes) return fail(c,'This claim is no longer pending or the employee is no longer eligible for the shift.',409);
    return c.json({ok:true});
  });
}

export function registerShifts(app: Hono<Env>) {
  registerClaims(app);
  app.get(path, async c => {
    const managing = canManage(c);
    const [openShifts,leaveEnabled] = await Promise.all([
      openShiftSchema(c), managing && schemaHasTable(c.env.DB,'leave_requests')
    ]);
    const access = scope(c, openShifts), location = c.req.query('location');
    const { from: fromValue, to: toValue, cursor, status, coverage } = c.req.query();
    if (coverage && !managing) return fail(c,'Not permitted.',403);
    if (coverage && coverage !== '1') return fail(c,'Invalid coverage filter.',422);
    if (status && !['draft','published','cancelled'].includes(status)) return fail(c,'Invalid shift status.',422);
    const from = utc(fromValue), to = utc(toValue);
    if ((fromValue || toValue) && (!from || !to || from >= to || Date.parse(to) - Date.parse(from) > 32*86400000)) {
      return fail(c,'Provide a valid time range up to 32 days.',422);
    }
    const args: string[] = [c.get('organisationId'), ...access.bindings];
    let sql = selectShift(openShifts,leaveEnabled) + ' WHERE s.organisation_id=?' + access.sql;
    if (location) { sql += ' AND s.location_id=?'; args.push(location); }
    if (status) { sql += ' AND s.status=?'; args.push(status); }
    if (coverage) {
      const vacancy = openShifts ? "(s.status='published' AND s.is_open=1)" : '0';
      sql += ` AND s.ends_at_utc>? AND (${vacancy} OR (${leaveEnabled ? leaveConflict : '0'}))`;
      args.push(isoNow());
    }
    if (from && to) { sql += ' AND s.starts_at_utc<? AND s.ends_at_utc>?'; args.push(to,from); }
    if (cursor) {
      const [instant,id,extra] = cursor.split('|');
      if (!utc(instant) || !/^[a-zA-Z0-9_-]{1,64}$/.test(id || '') || extra !== undefined) return fail(c,'Invalid shift cursor',422);
      sql += ' AND (s.starts_at_utc,s.id)<(?,?)'; args.push(instant,id);
    }
    const rows = (await c.env.DB.prepare(sql + ' ORDER BY s.starts_at_utc DESC,s.id DESC LIMIT 201').bind(...args).all<Shift>()).results;
    const shifts = rows.slice(0,200), last = shifts.at(-1);
    return c.json({shifts,openShifts,nextCursor:rows.length>200&&last?last.starts_at_utc+'|'+last.id:null});
  });
  app.get(path+'/:shiftId',async c=>{
    const [openShifts,leaveEnabled] = await Promise.all([
      openShiftSchema(c), canManage(c) && schemaHasTable(c.env.DB,'leave_requests')
    ]);
    const shift = await findShift(c,c.req.param('shiftId') || '',openShifts,leaveEnabled);
    return shift ? c.json({shift,openShifts}) : fail(c,'Shift not found',404);
  });
  app.post(path, async c => canManage(c) ? saveShift(c,await openShiftSchema(c)) : fail(c,'Not permitted',403));
  app.patch(path+'/:shiftId',async c=>{
    if (!canManage(c)) return fail(c,'Not permitted',403);
    const openShifts = await openShiftSchema(c);
    const shift = await findShift(c,c.req.param('shiftId') || '',openShifts);
    return shift ? saveShift(c,openShifts,shift) : fail(c,'Shift not found',404);
  });
  app.post(path+'/:shiftId/:operation{publish|cancel|discard}', async c => {
    if (!canManage(c)) return fail(c,'Not permitted',403);
    const id = c.req.param('shiftId') || '', action = c.req.param('operation') || '';
    const openShifts = await openShiftSchema(c);
    const shift = await findShift(c,id,openShifts);
    if (!shift) return fail(c,'Shift not found',404);
    const revision = (await body(c))?.revision;
    if (!Number.isInteger(revision) || revision < 1) return fail(c,'A valid shift revision is required.',422);
    if (action === 'publish' && openShifts && !shift.employee_id && !shift.is_open) {
      return fail(c,'Assign an employee or mark this draft as an open shift before publishing.',422);
    }
    const next = action === 'publish' ? 'published' : 'cancelled';
    const expected = action === 'cancel' ? 'published' : 'draft';
    const org = c.get('organisationId'), user = c.get('userId');
    const where = `organisation_id=?1 AND id=?2 AND revision=?3 AND status=?4
      AND ${locationPermission('?1','shifts.location_id','?5')}`;
    const db = c.env.DB;
    const leaveEnabled = action === 'publish' && Boolean(shift.employee_id) && await schemaHasTable(db,'leave_requests');
    const change = action === 'discard'
      ? db.prepare('DELETE FROM shifts WHERE ' + where).bind(org,id,revision,expected,user)
      : db.prepare(`UPDATE shifts SET status=?6,updated_at=?7,revision=revision+1 WHERE ${where}
        ${action === 'publish' ? `AND ${activeLocation('?1','shifts.location_id')}
          AND (${openShifts ? 'is_open=1' : 'employee_id IS NULL'} OR (${staffEligible('?1','shifts.location_id','shifts.employee_id')}
          AND ${noOverlap('?1','shifts.id','shifts.employee_id','shifts.starts_at_utc','shifts.ends_at_utc')}
          ${leaveEnabled ? 'AND ' + noApprovedLeave('?1','shifts.employee_id','shifts.starts_at_utc','shifts.ends_at_utc') : ''}))` : ''}`)
        .bind(org,id,revision,expected,user,next,isoNow());
    const writes = [change,audit(c,action,'shift',id,{
      revision:revision+1,locationId:shift.location_id,employeeId:shift.employee_id,startsAt:shift.starts_at_utc,endsAt:shift.ends_at_utc
    },true)];
    if (openShifts && action === 'cancel') {
      writes.push(db.prepare(`UPDATE shift_claims SET status='cancelled',decided_at=?,decided_by=?
        WHERE organisation_id=? AND shift_id=? AND status='pending' AND changes()>0`).bind(isoNow(),user,org,id));
    }
    const results = await db.batch(writes);
    if (!results[0].meta.changes) return fail(c,'The shift changed or can no longer be moved to this status.',409);
    return c.json({ok:true});
  });
}
