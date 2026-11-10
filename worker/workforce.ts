import { orgAdmin, type ApiContext } from './http';

export const canManage = (c: ApiContext) => orgAdmin(c) || c.get('role') === 'manager';

export const locationPermission = (org: string, location: string, user: string) => `EXISTS (
  SELECT 1 FROM memberships m LEFT JOIN location_access permitted_branch
    ON permitted_branch.organisation_id=m.organisation_id AND permitted_branch.user_id=m.user_id
    AND permitted_branch.location_id=${location}
  WHERE m.organisation_id=${org} AND m.user_id=${user} AND m.status='active'
  AND (m.role IN ('owner','admin') OR (m.role='manager' AND permitted_branch.user_id IS NOT NULL)))`;

export const staffEligible = (org: string, location: string, employee: string) => `EXISTS (
  SELECT 1 FROM employee_locations el JOIN employees eligible_employee
    ON eligible_employee.organisation_id=el.organisation_id AND eligible_employee.id=el.employee_id
  WHERE el.organisation_id=${org} AND el.location_id=${location} AND el.employee_id=${employee} AND eligible_employee.employment_status='active')`;

export const activeLocation = (org: string, location: string) => `EXISTS (
  SELECT 1 FROM locations WHERE organisation_id=${org} AND id=${location} AND archived_at IS NULL)`;

export const noOverlap = (org: string, id: string, employee: string, start: string, end: string) => `NOT EXISTS (
  SELECT 1 FROM shifts overlapping WHERE overlapping.organisation_id=${org} AND overlapping.employee_id=${employee}
    AND overlapping.id<>${id} AND overlapping.status IN ('draft','published')
    AND overlapping.starts_at_utc<${end} AND overlapping.ends_at_utc>${start})`;

export function utc(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const iso = new Date(ms).toISOString();
  return iso.slice(0,19) === value.slice(0,19) ? iso : null;
}

export async function schemaHasTable(db: D1Database, name: string) {
  return Boolean(await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").bind(name).first());
}

export const activeEmployeeMember = (org: string, user: string) => `EXISTS (
  SELECT 1 FROM memberships m WHERE m.organisation_id=${org} AND m.user_id=${user}
  AND m.role='employee' AND m.status='active')`;

export const noApprovedLeave = (org: string, employee: string, start: string, end: string) => `NOT EXISTS (
  SELECT 1 FROM leave_requests lr WHERE lr.organisation_id=${org} AND lr.employee_id=${employee}
    AND lr.status='approved' AND lr.starts_at_utc<${end} AND lr.ends_at_utc>${start})`;
