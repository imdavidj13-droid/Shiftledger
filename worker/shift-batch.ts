import type { Hono } from 'hono';
import { audit, body, fail, isoNow, orgRoute, type Env } from './http';
import { activeLocation, canManage, locationPermission, noApprovedLeave, noOverlap, schemaHasTable, staffEligible, utc } from './workforce';

const path = orgRoute + '/shifts';
const idPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const operationPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const limit = 50;

type Draft = { id: string; location: string; employee: string | null; start: string; end: string; breaks: number; open: number };

function parseDraft(value: unknown, id: string): Draft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { locationId, employeeId, startsAt, endsAt, breakMinutes = 0, isOpen = false } = value as Record<string, unknown>;
  const start = utc(startsAt), end = utc(endsAt), employee = employeeId ?? null;
  if (typeof locationId !== 'string' || !idPattern.test(locationId) ||
      (employee !== null && (typeof employee !== 'string' || !idPattern.test(employee))) ||
      !start || !end || start >= end || typeof breakMinutes !== 'number' || !Number.isInteger(breakMinutes) ||
      breakMinutes < 0 || breakMinutes > 1440 || breakMinutes * 60_000 >= Date.parse(end) - Date.parse(start) ||
      typeof isOpen !== 'boolean' || (isOpen && employee)) return null;
  return {id,location:locationId,employee,start,end,breaks:breakMinutes,open:Number(isOpen)};
}

function parsePublication(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { id, revision } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !idPattern.test(id) || typeof revision !== 'number' ||
      !Number.isSafeInteger(revision) || revision < 1) return null;
  return {id,revision};
}

export function registerShiftBatch(app: Hono<Env>) {
  app.post(path + '/bulk-create', async c => {
    if (!canManage(c)) return fail(c,'Not permitted.',403);
    const input = await body(c), raw = input?.shifts, operation = input?.operationId;
    if (!Array.isArray(raw) || !raw.length || raw.length > limit || typeof operation !== 'string' ||
        !operationPattern.test(operation)) return fail(c,'Provide an operation ID and between 1 and 50 shifts.',422);
    const drafts = raw.map((value,index) => parseDraft(value,operation + '-' + index));
    if (drafts.some(draft => !draft)) return fail(c,'Each shift needs a valid branch, time range, assignment and break duration.',422);

    const rows = drafts as Draft[], db = c.env.DB, org = c.get('organisationId'), user = c.get('userId');
    const [open,leave] = await Promise.all([schemaHasTable(db,'shift_claims'),schemaHasTable(db,'leave_requests')]);
    if (!open && rows.some(row => row.open)) return fail(c,'Open shifts require the pending database update.',503);
    const results = await db.batch([
      db.prepare(`WITH input AS (
          SELECT json_extract(value,'$.id') AS id, json_extract(value,'$.location') AS location,
            json_extract(value,'$.employee') AS employee, json_extract(value,'$.start') AS start,
            json_extract(value,'$.end') AS end, json_extract(value,'$.breaks') AS breaks, json_extract(value,'$.open') AS open
          FROM json_each(?3)
        )
        INSERT INTO shifts (id,organisation_id,location_id,employee_id,starts_at_utc,ends_at_utc,unpaid_break_minutes${open ? ',is_open' : ''})
        SELECT id,?1,location,employee,start,end,breaks${open ? ',open' : ''} FROM input
        WHERE NOT EXISTS (SELECT 1 FROM input candidate WHERE
          NOT ${activeLocation('?1','candidate.location')} OR NOT ${locationPermission('?1','candidate.location','?2')}
          OR EXISTS (SELECT 1 FROM shifts s WHERE s.id=candidate.id)
          OR (candidate.employee IS NOT NULL AND (
            NOT ${staffEligible('?1','candidate.location','candidate.employee')}
            OR NOT ${noOverlap('?1','candidate.id','candidate.employee','candidate.start','candidate.end')}
            ${leave ? 'OR NOT ' + noApprovedLeave('?1','candidate.employee','candidate.start','candidate.end') : ''}
            OR EXISTS (SELECT 1 FROM input other WHERE other.id<>candidate.id AND other.employee=candidate.employee
              AND other.start<candidate.end AND other.end>candidate.start)
          )))`).bind(org,user,JSON.stringify(rows)),
      audit(c,'bulk_create','shift_batch',operation,{shiftIds:rows.map(row=>row.id)},true)
    ]);
    if (!results[0].meta.changes) return fail(c,'No drafts were created. Check branch access, staff assignments, shift or leave conflicts, or whether this batch was already saved.',409);
    return c.json({shifts:rows.map(row=>({id:row.id,revision:1,status:'draft'}))},201);
  });

  app.post(path + '/bulk-publish', async c => {
    if (!canManage(c)) return fail(c,'Not permitted.',403);
    const raw = (await body(c))?.shifts;
    if (!Array.isArray(raw) || !raw.length || raw.length > limit) return fail(c,'Select between 1 and 50 draft shifts.',422);
    const rows = raw.map(parsePublication);
    if (rows.some(row => !row) || new Set(rows.map(row => row?.id)).size !== rows.length) {
      return fail(c,'Each draft must have a unique ID and its current revision.',422);
    }

    const db = c.env.DB, org = c.get('organisationId'), user = c.get('userId');
    const [open,leave] = await Promise.all([schemaHasTable(db,'shift_claims'),schemaHasTable(db,'leave_requests')]);
    const results = await db.batch([
      db.prepare(`WITH eligible AS MATERIALIZED (
          SELECT s.id FROM shifts s JOIN json_each(?3) supplied
            ON s.id=json_extract(supplied.value,'$.id') AND s.revision=json_extract(supplied.value,'$.revision')
          WHERE s.organisation_id=?1 AND s.status='draft' AND ${activeLocation('?1','s.location_id')}
          AND ${locationPermission('?1','s.location_id','?2')}
          AND (${open ? 's.is_open=1' : 's.employee_id IS NULL'} OR (
            ${staffEligible('?1','s.location_id','s.employee_id')}
            AND ${noOverlap('?1','s.id','s.employee_id','s.starts_at_utc','s.ends_at_utc')}
            ${leave ? 'AND ' + noApprovedLeave('?1','s.employee_id','s.starts_at_utc','s.ends_at_utc') : ''}
          ))
        )
        UPDATE shifts SET status='published',revision=revision+1,updated_at=?4
        WHERE organisation_id=?1 AND id IN (SELECT id FROM eligible)
        AND (SELECT COUNT(*) FROM eligible)=json_array_length(?3)`).bind(org,user,JSON.stringify(rows),isoNow()),
      audit(c,'bulk_publish','shift_batch',crypto.randomUUID(),{shifts:rows},true)
    ]);
    if (!results[0].meta.changes) return fail(c,'No shifts were published. One or more drafts changed, have a conflict or are unavailable to you.',409);
    return c.json({published:results[0].meta.changes});
  });
}
