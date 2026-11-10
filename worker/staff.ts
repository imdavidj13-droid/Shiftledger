import type { Hono } from 'hono';
import { audit, body, fail, isoNow, orgAdmin, orgRoute, safeStr, type Env } from './http';
import { canManage, locationPermission, schemaHasTable } from './workforce';

const path = orgRoute + '/employees/:employeeId';
const pattern = /^[a-zA-Z0-9_-]{1,64}$/;
const assignedBranch = `FROM employee_locations el JOIN locations l
  ON l.organisation_id=el.organisation_id AND l.id=el.location_id AND l.archived_at IS NULL
  WHERE el.organisation_id=?1 AND el.employee_id=?2`;

export function registerStaff(app: Hono<Env>) {
  app.get(path, async c => {
    if (!canManage(c)) return fail(c,'Not permitted.',403);
    const org = c.get('organisationId'), id = c.req.param('employeeId'), user = c.get('userId'), db = c.env.DB;
    const profiles = await schemaHasTable(db,'employee_profiles');
    const managed = c.get('role') === 'manager';
    const branchAccess = locationPermission('?1','l.id','?3');
    const metadata = profiles ? `,COALESCE(p.department,'') AS department,COALESCE(p.position,'') AS position,
      ${managed ? `CASE WHEN ${locationPermission('?1','p.primary_location_id','?3')} THEN p.primary_location_id END` : 'p.primary_location_id'} AS primary_location_id` : '';
    const employee = await db.prepare(`SELECT e.id,e.display_name,e.employment_status${metadata} FROM employees e
      ${profiles ? 'LEFT JOIN employee_profiles p ON p.organisation_id=e.organisation_id AND p.employee_id=e.id' : ''}
      WHERE e.organisation_id=?1 AND e.id=?2
      AND EXISTS (SELECT 1 FROM memberships m WHERE m.organisation_id=?1 AND m.user_id=?3 AND m.status='active'
        AND (m.role IN ('owner','admin') OR (m.role='manager' AND EXISTS (SELECT 1 ${assignedBranch} AND ${branchAccess}))))`)
      .bind(org,id,user).first();
    if (!employee) return fail(c,'Employee not found.',404);
    const branches = (await db.prepare(`SELECT l.id,l.name ${assignedBranch} AND ${branchAccess} ORDER BY l.name,l.id`)
      .bind(org,id,user).all()).results;
    return c.json({employee,branches,profiles});
  });

  app.patch(path, async c => {
    if (!orgAdmin(c)) return fail(c,'Only owners and administrators can edit staff profiles.',403);
    const input = await body(c), name = safeStr(input?.displayName,101), status = input?.employmentStatus;
    const department = input?.department, position = input?.position, primary = input?.primaryLocationId;
    const validLabel = (label: unknown) => label === undefined || (typeof label === 'string' && label.trim().length <= 100 && !/[\u0000-\u001f\u007f]/.test(label));
    if (name.length < 2 || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name) ||
        !['active','inactive'].includes(status) || !validLabel(department) || !validLabel(position) ||
        (primary !== undefined && primary !== null && (typeof primary !== 'string' || !pattern.test(primary)))) {
      return fail(c,'Enter a valid employee name, employment status, department, position and primary branch.',422);
    }
    const org = c.get('organisationId'), id = c.req.param('employeeId') || '', user = c.get('userId'), db = c.env.DB;
    if (!await db.prepare('SELECT 1 FROM employees WHERE organisation_id=? AND id=?').bind(org,id).first()) {
      return fail(c,'Employee not found.',404);
    }
    const editingMetadata = department !== undefined || position !== undefined || primary !== undefined;
    const [profiles,timekeeping] = await Promise.all([schemaHasTable(db,'employee_profiles'),schemaHasTable(db,'time_entries')]);
    if (editingMetadata && !profiles) return fail(c,'Staff profile metadata requires the pending database update.',503);
    const departmentLabel = department?.trim() ?? null, positionLabel = position?.trim() ?? null;
    const writes = [db.prepare(`UPDATE employees SET display_name=?4,employment_status=?5 WHERE organisation_id=?1 AND id=?2
      AND EXISTS (SELECT 1 FROM memberships WHERE organisation_id=?1 AND user_id=?3 AND status='active' AND role IN ('owner','admin'))
      AND (?5='active' OR employment_status='inactive' OR (
        NOT EXISTS (SELECT 1 FROM shifts s WHERE s.organisation_id=?1 AND s.employee_id=?2 AND s.ends_at_utc>?6
          AND s.status IN ('draft','published'))
        ${timekeeping ? "AND NOT EXISTS (SELECT 1 FROM time_entries t WHERE t.organisation_id=?1 AND t.employee_id=?2 AND t.status='open')" : ''}
      ))
      AND (?7 IS NULL OR EXISTS (SELECT 1 ${assignedBranch} AND l.id=?7))`)
      .bind(org,id,user,name,status,isoNow(),primary ?? null)];
    if (editingMetadata) {
      writes.push(db.prepare(`INSERT INTO employee_profiles(organisation_id,employee_id,department,position,primary_location_id)
        SELECT ?1,?2,COALESCE(?3,''),COALESCE(?4,''),?5 WHERE changes()>0
        ON CONFLICT(organisation_id,employee_id) DO UPDATE SET
          department=COALESCE(?3,employee_profiles.department),position=COALESCE(?4,employee_profiles.position),
          primary_location_id=CASE WHEN ?6=1 THEN ?5 ELSE employee_profiles.primary_location_id END`)
        .bind(org,id,departmentLabel,positionLabel,primary ?? null,Number(primary !== undefined)));
    }
    writes.push(audit(c,'update','employee',id,{displayName:name,employmentStatus:status,
      department:departmentLabel,position:positionLabel,primaryLocationId:primary},true));
    const results = await db.batch(writes);
    if (!results[0].meta.changes) return fail(c,'Resolve future shifts or open timesheets before marking staff inactive. The primary branch must be an active assignment.',409);
    return c.json({ok:true});
  });
}
