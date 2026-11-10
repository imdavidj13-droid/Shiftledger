import type { Hono } from 'hono';
import { audit, body, fail, isoNow, orgRoute, safeStr, type ApiContext, type Env } from './http';
import { activeLocation, canManage, locationPermission, schemaHasTable } from './workforce';

const path = orgRoute + '/shift-templates';
const idPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const select = `SELECT t.id,t.location_id,t.name,t.start_time,t.end_time,t.end_day_offset,
  t.unpaid_break_minutes,t.revision,l.name AS location_name
  FROM shift_templates t JOIN locations l ON l.organisation_id=t.organisation_id AND l.id=t.location_id
  WHERE t.organisation_id=?1 AND t.archived_at IS NULL AND l.archived_at IS NULL
  AND ${locationPermission('?1','t.location_id','?2')}`;
const schema = (c: ApiContext) => schemaHasTable(c.env.DB,'shift_templates');
const unavailable = (c: ApiContext) => fail(c,'Shift templates require the pending database update.',503);
const minutes = (time: string) => Number(time.slice(0,2)) * 60 + Number(time.slice(3,5));

async function save(c: ApiContext, id?: string) {
  if (!canManage(c)) return fail(c,'Not permitted.',403);
  if (!await schema(c)) return unavailable(c);
  const input = await body(c), location = safeStr(input?.locationId,65), name = safeStr(input?.name,81);
  const start = safeStr(input?.startTime,6), end = safeStr(input?.endTime,6);
  const offset = input?.endDayOffset, breaks = input?.breakMinutes ?? 0, revision = input?.revision;
  if (!idPattern.test(location) || name.length < 2 || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name) ||
      !timePattern.test(start) || !timePattern.test(end) || ![0,1].includes(offset) || !Number.isInteger(breaks) ||
      breaks < 0 || breaks >= minutes(end) - minutes(start) + offset * 1440 ||
      (id && (!Number.isSafeInteger(revision) || revision < 1))) {
    return fail(c,'Enter a template name, active branch, local times and a break shorter than the shift.',422);
  }
  const org = c.get('organisationId'), user = c.get('userId'), db = c.env.DB, templateId = id || crypto.randomUUID();
  const access = `${activeLocation('?1','?4')} AND ${locationPermission('?1','?4','?2')}`;
  const values = [org,user,templateId,location,name,start,end,offset,breaks];
  const change = id
    ? db.prepare(`UPDATE OR IGNORE shift_templates AS t SET location_id=?4,name=?5,start_time=?6,end_time=?7,
        end_day_offset=?8,unpaid_break_minutes=?9,revision=revision+1
        WHERE organisation_id=?1 AND id=?3 AND archived_at IS NULL AND revision=?10
        AND ${access} AND ${locationPermission('?1','t.location_id','?2')}`).bind(...values,revision)
    : db.prepare(`INSERT INTO shift_templates(organisation_id,id,location_id,name,start_time,end_time,end_day_offset,unpaid_break_minutes)
        SELECT ?1,?3,?4,?5,?6,?7,?8,?9 WHERE ${access} ON CONFLICT DO NOTHING`).bind(...values);
  const result = await db.batch([change,audit(c,id?'update':'create','shift_template',templateId,{
    locationId:location,name,startTime:start,endTime:end,endDayOffset:offset,breakMinutes:breaks
  },true)]);
  if (!result[0].meta.changes) return fail(c,'The template changed, a name already exists at this branch, or the branch is unavailable.',409);
  return c.json({template:{id:templateId}},id?200:201);
}

export function registerShiftTemplates(app: Hono<Env>) {
  app.get(path, async c => {
    if (!canManage(c)) return fail(c,'Not permitted.',403);
    if (!await schema(c)) return unavailable(c);
    const location = c.req.query('location');
    if (location && !idPattern.test(location)) return fail(c,'Invalid location.',422);
    const values = [c.get('organisationId'),c.get('userId'),...(location ? [location] : [])];
    const rows = await c.env.DB.prepare(select + (location ? ' AND t.location_id=?3' : '') + ' ORDER BY t.name,t.id')
      .bind(...values).all();
    return c.json({templates:rows.results});
  });

  app.get(path + '/:templateId', async c => {
    if (!canManage(c)) return fail(c,'Not permitted.',403);
    if (!await schema(c)) return unavailable(c);
    const template = await c.env.DB.prepare(select + ' AND t.id=?3')
      .bind(c.get('organisationId'),c.get('userId'),c.req.param('templateId')).first();
    return template ? c.json({template}) : fail(c,'Shift template not found.',404);
  });

  app.post(path, c => save(c));
  app.patch(path + '/:templateId', c => save(c,c.req.param('templateId')));
  app.post(path + '/:templateId/archive', async c => {
    if (!canManage(c)) return fail(c,'Not permitted.',403);
    if (!await schema(c)) return unavailable(c);
    const revision = (await body(c))?.revision;
    if (!Number.isSafeInteger(revision) || revision < 1) return fail(c,'A valid template revision is required.',422);
    const org = c.get('organisationId'), user = c.get('userId'), id = c.req.param('templateId') || '', db = c.env.DB;
    const result = await db.batch([
      db.prepare(`UPDATE shift_templates AS t SET archived_at=?5,revision=revision+1
        WHERE organisation_id=?1 AND id=?3 AND revision=?4 AND archived_at IS NULL
        AND ${locationPermission('?1','t.location_id','?2')}`).bind(org,user,id,revision,isoNow()),
      audit(c,'archive','shift_template',id,{},true)
    ]);
    if (!result[0].meta.changes) return fail(c,'The template changed or is unavailable to you.',409);
    return c.json({ok:true});
  });
}
