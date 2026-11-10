import type { Hono } from 'hono';
import { audit, body, fail, isoNow, orgRoute, safeStr, type ApiContext, type Env } from './http';
import { activeEmployeeMember, activeLocation, canManage, locationPermission, schemaHasTable, staffEligible, utc } from './workforce';

const path = orgRoute + '/timesheets';
const idPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const maximumRange = 95 * 86_400_000;
const ready = (c: ApiContext) => schemaHasTable(c.env.DB,'time_entries');
const pending = (c: ApiContext) => fail(c,'Timesheets require the pending database update.',503);

const self = (entry: string, user: string) => `${activeEmployeeMember(entry + '.organisation_id',user)}
  AND EXISTS (SELECT 1 FROM employees employee WHERE employee.organisation_id=${entry}.organisation_id
    AND employee.id=${entry}.employee_id AND employee.user_id=${user})`;
const scope = (c: ApiContext) => canManage(c) ? locationPermission('?1','t.location_id','?2') : self('t','?2');
const noTimeOverlap = (employee: string) => `NOT EXISTS (SELECT 1 FROM time_entries overlapping
  WHERE overlapping.organisation_id=?1 AND overlapping.employee_id=${employee} AND overlapping.id<>?3
  AND overlapping.clock_in_utc<?5 AND (overlapping.clock_out_utc IS NULL OR overlapping.clock_out_utc>?4))`;

const select = `SELECT t.*,e.display_name AS employee_name,l.name AS location_name,l.time_zone,
  s.starts_at_utc AS scheduled_start,s.ends_at_utc AS scheduled_end,s.unpaid_break_minutes AS scheduled_unpaid_minutes,
  COALESCE((SELECT SUM(ROUND((julianday(b.ended_at_utc)-julianday(b.started_at_utc))*86400))
    FROM time_breaks b WHERE b.organisation_id=t.organisation_id AND b.entry_id=t.id AND b.kind='unpaid'),0) AS unpaid_seconds
  FROM time_entries t JOIN employees e ON e.organisation_id=t.organisation_id AND e.id=t.employee_id
  JOIN locations l ON l.organisation_id=t.organisation_id AND l.id=t.location_id
  LEFT JOIN shifts s ON s.organisation_id=t.organisation_id AND s.id=t.shift_id`;
type Entry = { id: string; location_id: string; employee_id: string; clock_in_utc: string; clock_out_utc: string | null;
  status: 'open' | 'submitted' | 'approved'; revision: number };
async function find(c: ApiContext, id: string) {
  return c.env.DB.prepare(select + ' WHERE t.organisation_id=?1 AND t.id=?3 AND ' + scope(c))
    .bind(c.get('organisationId'),c.get('userId'),id).first<Entry>();
}

const breakOpen = (org: string, entry: string) => `EXISTS (SELECT 1 FROM time_breaks active_break
  WHERE active_break.organisation_id=${org} AND active_break.entry_id=${entry} AND active_break.ended_at_utc IS NULL)`;

export function registerTimekeeping(app: Hono<Env>) {
  app.get(path, async c => {
    if (!await ready(c)) return pending(c);
    const { location, status, cursor } = c.req.query();
    const from = utc(c.req.query('from')), to = utc(c.req.query('to'));
    if (!from || !to || from >= to || Date.parse(to)-Date.parse(from) > maximumRange ||
        (location && !idPattern.test(location)) || (status && !['open','submitted','approved'].includes(status))) {
      return fail(c,'Enter a valid time period of up to 95 days and a valid status and location filter.',422);
    }
    const values: string[] = [c.get('organisationId'),c.get('userId'),to,from];
    let where = ' WHERE t.organisation_id=?1 AND ' + scope(c) +
      ' AND t.clock_in_utc<?3 AND (t.clock_out_utc IS NULL OR t.clock_out_utc>?4)';
    if (location) { where += ' AND t.location_id=?'; values.push(location); }
    if (status) { where += ' AND t.status=?'; values.push(status); }
    if (cursor) {
      const [instant,id,extra] = cursor.split('|');
      if (!utc(instant) || !idPattern.test(id || '') || extra !== undefined) return fail(c,'Invalid timesheet cursor.',422);
      where += ' AND (t.clock_in_utc,t.id)<(?,?)'; values.push(instant,id);
    }
    const rows = (await c.env.DB.prepare(select + where + ' ORDER BY t.clock_in_utc DESC,t.id DESC LIMIT 51')
      .bind(...values).all<Entry>()).results;
    const entries = rows.slice(0,50), last = entries.at(-1);
    return c.json({entries,nextCursor:rows.length>50 && last ? last.clock_in_utc + '|' + last.id : null});
  });

  app.get(path + '/:entryId', async c => {
    if (!await ready(c)) return pending(c);
    const id = c.req.param('entryId') || '', org = c.get('organisationId'), db = c.env.DB;
    const entry = await find(c,id);
    if (!entry) return fail(c,'Timesheet not found.',404);
    const breaks = (await db.prepare(`SELECT id,kind,started_at_utc,ended_at_utc FROM time_breaks
      WHERE organisation_id=? AND entry_id=? ORDER BY started_at_utc,id`).bind(org,id).all()).results;
    const history = canManage(c) ? (await db.prepare(`SELECT a.action,a.occurred_at,a.details_json,u.display_name AS actor
      FROM audit_events a LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.organisation_id=? AND a.resource_type='timesheet'
      AND a.resource_id=? ORDER BY a.occurred_at DESC,a.id DESC LIMIT 100`).bind(org,id).all()).results : [];
    return c.json({entry,breaks,history});
  });

  app.post(path + '/clock-in', async c => {
    if (c.get('role') !== 'employee') return fail(c,'Only staff can clock themselves in.',403);
    if (!await ready(c)) return pending(c);
    const input = await body(c), location = safeStr(input?.locationId,65), shift = safeStr(input?.shiftId,65) || null;
    if (!idPattern.test(location) || (shift && !idPattern.test(shift))) return fail(c,'A valid location is required.',422);
    const org = c.get('organisationId'), user = c.get('userId'), db = c.env.DB;
    const id = crypto.randomUUID(), now = isoNow(), earlyWindow = new Date(Date.parse(now) + 2 * 3600_000).toISOString();
    const results = await db.batch([
      db.prepare(`INSERT INTO time_entries(organisation_id,id,employee_id,location_id,shift_id,clock_in_utc)
        SELECT ?1,?2,e.id,?3,?4,?6 FROM employees e WHERE e.organisation_id=?1 AND e.user_id=?5
        AND ${activeEmployeeMember('?1','?5')} AND ${activeLocation('?1','?3')} AND ${staffEligible('?1','?3','e.id')}
        AND (?4 IS NULL OR EXISTS (SELECT 1 FROM shifts s WHERE s.organisation_id=?1 AND s.id=?4 AND s.location_id=?3
          AND s.employee_id=e.id AND s.status='published' AND s.starts_at_utc<=?7 AND s.ends_at_utc>?6))
        ON CONFLICT DO NOTHING`).bind(org,id,location,shift,user,now,earlyWindow),
      audit(c,'clock_in','timesheet',id,{locationId:location,shiftId:shift,clockIn:now},true)
    ]);
    if (!results[0].meta.changes) return fail(c,'You are already clocked in, this shift already has a timesheet, or the branch or assignment is unavailable.',409);
    return c.json({entry:{id,status:'open',revision:1}},201);
  });

  app.post(path + '/:entryId/:action{clock-out|break-start|break-end}', async c => {
    if (c.get('role') !== 'employee') return fail(c,'Only staff can record their own punches.',403);
    if (!await ready(c)) return pending(c);
    const id = c.req.param('entryId') || '', action = c.req.param('action'), db = c.env.DB;
    const org = c.get('organisationId'), user = c.get('userId'), now = isoNow();
    const entry = await find(c,id);
    if (!entry) return fail(c,'Timesheet not found.',404);
    const open = `t.organisation_id=?1 AND t.id=?3 AND t.status='open' AND ${self('t','?2')}`;
    let change: D1PreparedStatement;
    let kind: 'paid' | 'unpaid' | undefined;
    if (action === 'break-start') {
      kind = (await body(c))?.kind;
      if (kind !== 'paid' && kind !== 'unpaid') return fail(c,'Choose a paid or unpaid break.',422);
      change = db.prepare(`INSERT INTO time_breaks(organisation_id,id,entry_id,kind,started_at_utc)
        SELECT ?1,?5,?3,?6,?4 FROM time_entries t WHERE ${open} AND t.clock_in_utc<=?4 ON CONFLICT DO NOTHING`)
        .bind(org,user,id,now,crypto.randomUUID(),kind);
    } else if (action === 'break-end') {
      change = db.prepare(`UPDATE time_breaks SET ended_at_utc=?4 WHERE organisation_id=?1 AND entry_id=?3
        AND ended_at_utc IS NULL AND started_at_utc<?4 AND EXISTS (SELECT 1 FROM time_entries t WHERE ${open})`)
        .bind(org,user,id,now);
    } else {
      change = db.prepare(`UPDATE time_entries AS t SET clock_out_utc=?4,status='submitted',revision=revision+1
        WHERE ${open} AND clock_in_utc<?4 AND NOT ${breakOpen('?1','?3')}`).bind(org,user,id,now);
    }
    const writes = [change];
    if (action !== 'clock-out') {
      writes.push(db.prepare('UPDATE time_entries SET revision=revision+1 WHERE organisation_id=? AND id=? AND changes()>0').bind(org,id));
    }
    writes.push(audit(c,(action || '').replaceAll('-','_'),'timesheet',id,{at:now,kind},true));
    const results = await db.batch(writes);
    if (!results[0].meta.changes) return fail(c,'The punch could not be recorded. Check the current clock and break status.',409);
    return c.json({ok:true});
  });

  app.post(path, async c => {
    if (!canManage(c)) return fail(c,'Not permitted.',403);
    if (!await ready(c)) return pending(c);
    const data = await body(c), employee = safeStr(data?.employeeId,65), location = safeStr(data?.locationId,65);
    const start = utc(data?.clockIn), end = utc(data?.clockOut), reason = safeStr(data?.reason,501);
    if (!idPattern.test(employee) || !idPattern.test(location) || !start || !end || start >= end || end > isoNow() ||
        !reason || reason.length > 500) return fail(c,'Enter an eligible employee, branch, past start and end times and a correction reason.',422);
    const org = c.get('organisationId'), user = c.get('userId'), id = crypto.randomUUID(), db = c.env.DB;
    const results = await db.batch([
      db.prepare(`INSERT INTO time_entries(organisation_id,id,employee_id,location_id,clock_in_utc,clock_out_utc,status)
        SELECT ?1,?3,?7,?6,?4,?5,'submitted' WHERE ${locationPermission('?1','?6','?2')}
        AND ${activeLocation('?1','?6')} AND ${staffEligible('?1','?6','?7')} AND ${noTimeOverlap('?7')}`)
        .bind(org,user,id,start,end,location,employee),
      audit(c,'manual_entry','timesheet',id,{reason,clockIn:start,clockOut:end},true)
    ]);
    if (!results[0].meta.changes) return fail(c,'The times overlap another entry, or the employee or branch is unavailable.',409);
    return c.json({entry:{id,status:'submitted',revision:1}},201);
  });

  app.patch(path + '/:entryId', async c => {
    if (!canManage(c)) return fail(c,'Not permitted.',403);
    if (!await ready(c)) return pending(c);
    const id = c.req.param('entryId') || '', entry = await find(c,id);
    if (!entry) return fail(c,'Timesheet not found.',404);
    const input = await body(c), start = utc(input?.clockIn), end = utc(input?.clockOut);
    const reason = safeStr(input?.reason,501), revision = input?.revision;
    if (!start || !end || start >= end || end > isoNow() || !reason || reason.length > 500 ||
        !Number.isSafeInteger(revision) || revision < 1) return fail(c,'Enter valid past times, a revision and a correction reason.',422);
    const org = c.get('organisationId'), user = c.get('userId'), db = c.env.DB;
    const results = await db.batch([
      db.prepare(`UPDATE time_entries AS t SET clock_in_utc=?4,clock_out_utc=?5,status='submitted',revision=revision+1
        WHERE t.organisation_id=?1 AND t.id=?3 AND t.revision=?6 AND t.status IN ('open','submitted')
        AND ${locationPermission('?1','t.location_id','?2')} AND ${noTimeOverlap('t.employee_id')}
        AND NOT EXISTS (SELECT 1 FROM time_breaks b WHERE b.organisation_id=?1 AND b.entry_id=?3
          AND (b.ended_at_utc IS NULL OR b.started_at_utc<?4 OR b.ended_at_utc>?5))`)
        .bind(org,user,id,start,end,revision),
      audit(c,'correct','timesheet',id,{reason,previousClockIn:entry.clock_in_utc,previousClockOut:entry.clock_out_utc,
        clockIn:start,clockOut:end},true)
    ]);
    if (!results[0].meta.changes) return fail(c,'The timesheet changed or is locked, overlaps another entry, or does not contain all recorded breaks.',409);
    return c.json({ok:true});
  });

  app.post(path + '/:entryId/close-break', async c => {
    if (!canManage(c)) return fail(c,'Not permitted.',403);
    if (!await ready(c)) return pending(c);
    const id = c.req.param('entryId') || '';
    if (!await find(c,id)) return fail(c,'Timesheet not found.',404);
    const input = await body(c), end = utc(input?.endedAt), reason = safeStr(input?.reason,501), revision = input?.revision;
    if (!end || end > isoNow() || !reason || reason.length > 500 || !Number.isSafeInteger(revision) || revision < 1) {
      return fail(c,'Enter a past break end, a revision and a correction reason.',422);
    }
    const org = c.get('organisationId'), user = c.get('userId'), db = c.env.DB;
    const results = await db.batch([
      db.prepare(`UPDATE time_breaks SET ended_at_utc=?5 WHERE organisation_id=?1 AND entry_id=?3
        AND ended_at_utc IS NULL AND started_at_utc<?5 AND EXISTS (
          SELECT 1 FROM time_entries t WHERE t.organisation_id=?1 AND t.id=?3 AND t.status='open' AND t.revision=?4
          AND ${locationPermission('?1','t.location_id','?2')})`).bind(org,user,id,revision,end),
      db.prepare('UPDATE time_entries SET revision=revision+1 WHERE organisation_id=? AND id=? AND changes()>0').bind(org,id),
      audit(c,'correct_break_end','timesheet',id,{reason,endedAt:end},true)
    ]);
    if (!results[0].meta.changes) return fail(c,'The timesheet changed or the break end must follow the current open break start.',409);
    return c.json({ok:true});
  });

  app.post(path + '/:entryId/approve', async c => {
    if (!canManage(c)) return fail(c,'Not permitted.',403);
    if (!await ready(c)) return pending(c);
    const id = c.req.param('entryId') || '';
    if (!await find(c,id)) return fail(c,'Timesheet not found.',404);
    const revision = (await body(c))?.revision;
    if (!Number.isSafeInteger(revision) || revision < 1) return fail(c,'A valid timesheet revision is required.',422);
    const org = c.get('organisationId'), user = c.get('userId'), db = c.env.DB;
    const results = await db.batch([
      db.prepare(`UPDATE time_entries AS t SET status='approved',revision=revision+1,approved_at=?5,approved_by=?2
        WHERE t.organisation_id=?1 AND t.id=?3 AND t.revision=?4 AND t.status='submitted'
        AND ${locationPermission('?1','t.location_id','?2')} AND NOT ${breakOpen('?1','?3')}`).bind(org,user,id,revision,isoNow()),
      audit(c,'approve','timesheet',id,{revision:revision+1},true)
    ]);
    if (!results[0].meta.changes) return fail(c,'The timesheet changed or is no longer ready for approval.',409);
    return c.json({ok:true});
  });
}
