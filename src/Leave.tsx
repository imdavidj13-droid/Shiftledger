import { useEffect, useState, type FormEvent } from 'react';
import { api, write } from './api';
import type { Location, Org } from './Locations';
import { appPath, go, useRoute } from './routes';

type LeaveKind = 'holiday' | 'sickness' | 'other';
type LeaveStatus = 'pending' | 'approved' | 'declined' | 'cancelled';
type LeaveRequest = {
  id: string; employee_name: string; location_name: string; first_date: string; last_date: string;
  kind: LeaveKind; status: LeaveStatus; note: string; time_zone: string; shift_conflict?: number;
  requested_at: string; decided_at: string | null; cancelled_at: string | null;
};
type LeavePage = { requests: LeaveRequest[]; nextCursor: string | null };
const kinds: Record<LeaveKind, string> = { holiday: 'Holiday', sickness: 'Sickness', other: 'Other absence' };
const statuses: Record<LeaveStatus, string> = { pending: 'Pending', approved: 'Approved', declined: 'Declined', cancelled: 'Cancelled' };

export type WorkforceProps = {
  org: Org; locations: Location[]; employees: { id: string; display_name: string; employment_status: string }[];
  assignments: { employee_id: string; location_id: string }[];
  resourceId?: string; locationFilter: string;
};

function leaveDates(record: LeaveRequest) {
  return record.first_date === record.last_date ? record.first_date : record.first_date + ' to ' + record.last_date;
}

export function Leave(props: WorkforceProps) {
  const { org, resourceId, locationFilter } = props;
  const route = useRoute();
  const status = route.searchParams.get('status') || '';
  const cursor = route.searchParams.get('cursor');
  const [record, setRecord] = useState<LeaveRequest | null>(null);
  const [list, setList] = useState<LeavePage | null>(null);
  const [loaded, setLoaded] = useState('');
  const [error, setError] = useState('');
  const root = appPath(org.id, 'Leave');
  const base = '/organisations/' + org.id + '/leave';
  const queryFor = (targetStatus: string, targetCursor?: string) => {
    const query = new URLSearchParams();
    if (locationFilter) query.set('location', locationFilter);
    if (targetStatus) query.set('status', targetStatus);
    if (targetCursor) query.set('cursor', targetCursor);
    return query.size ? '?' + query : '';
  };
  const back = root + queryFor(status);
  const detail = (id: string) => root + '/' + id + queryFor(status);
  const endpoint = resourceId ? base + '/' + resourceId : base + queryFor(status, cursor || undefined);
  const managing = org.role !== 'employee';

  useEffect(() => {
    if (!managing || resourceId === 'new') return;
    const controller = new AbortController();
    const { signal } = controller;
    setError('');
    const load = resourceId
      ? api<{ request: LeaveRequest }>(endpoint, { signal }).then(data => { if (!signal.aborted) setRecord(data.request); })
      : api<LeavePage>(endpoint, { signal }).then(data => { if (!signal.aborted) setList(data); });
    void load.catch(reason => { if (!signal.aborted) setError(reason.message); })
      .finally(() => { if (!signal.aborted) setLoaded(endpoint); });
    return () => controller.abort();
  }, [endpoint, managing, resourceId]);

  if (!managing) return <p className="alert error" role="alert">Leave management is available to schedulers.</p>;
  if (resourceId === 'new') return <>
    <a className="btn outline" href={back}>Back to leave</a>
    <LeaveForm {...props} base={base} onSaved={id => go(detail(id), true)}/>
  </>;
  if (loaded !== endpoint) return <p role="status">Loading leave requests…</p>;
  if (error) return <p className="alert error" role="alert">{error}</p>;
  if (resourceId && record) return <>
    <a className="btn outline" href={back}>Back to leave</a>
    <LeaveDetails key={record.id + '/' + record.status} record={record} endpoint={endpoint}
      onChanged={async () => setRecord((await api<{ request: LeaveRequest }>(endpoint)).request)}/>
  </>;
  return <section className="panel">
    <div className="panel-title"><h2>Leave requests</h2><a className="btn primary" href={detail('new')}>Record leave request</a></div>
    <div className="form-stack pad">
      <label className="field">Request status<select value={status} onChange={event => go(root + queryFor(event.target.value))}>
        <option value="">All statuses</option>
        {Object.entries(statuses).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {list?.requests.length === 0 && <p>No leave requests match these filters.</p>}
      {list?.requests.map(item => <a className="record workforce-record" key={item.id} href={detail(item.id)}>
        <div><strong>{item.employee_name} · {kinds[item.kind]}</strong><small>{leaveDates(item)} · {item.location_name}</small></div>
        <span>{statuses[item.status]}</span>
      </a>)}
      <div className="rota-controls">
        {cursor && <a className="btn outline" href={back}>First page</a>}
        {list?.nextCursor && <a className="btn outline" href={root + queryFor(status, list.nextCursor)}>Older requests</a>}
      </div>
    </div>
  </section>;
}

function LeaveDetails({ record, endpoint, onChanged }: { record: LeaveRequest; endpoint: string; onChanged: () => Promise<void> }) {
  const [acknowledge, setAcknowledge] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function decide(action: 'approve' | 'decline' | 'cancel') {
    setError(''); setBusy(true);
    try {
      await write(endpoint + '/' + action, { acknowledgeShiftConflict: acknowledge });
      await onChanged();
    } catch (reason) {
      setError((reason as Error).message);
      await onChanged().catch(() => {});
    } finally { setBusy(false); }
  }

  return <section className="panel rota-detail">
    <div className="panel-title"><h2>{kinds[record.kind]} request</h2><span>{statuses[record.status]}</span></div>
    <div className="form-stack pad">
      {error && <p className="alert error" role="alert">{error}</p>}
      <div><strong>{record.employee_name}</strong> · {record.location_name}</div>
      <div>{leaveDates(record)} · {record.time_zone}</div>
      {record.note && <p className="workforce-note">{record.note}</p>}
      <div>Recorded {new Date(record.requested_at).toLocaleString()}</div>
      {record.decided_at && <div>Reviewed {new Date(record.decided_at).toLocaleString()}</div>}
      {record.cancelled_at && <div>Cancelled {new Date(record.cancelled_at).toLocaleString()}</div>}
      {record.status === 'pending' && <>
        {Boolean(record.shift_conflict) && <label className="rota-checkbox"><input type="checkbox" checked={acknowledge}
          onChange={event => setAcknowledge(event.target.checked)}/> I acknowledge overlapping shifts and will arrange cover</label>}
        <div className="rota-controls">
          <button className="btn primary" disabled={busy || (Boolean(record.shift_conflict) && !acknowledge)} onClick={() => void decide('approve')}>Approve leave</button>
          <button className="btn outline" disabled={busy} onClick={() => void decide('decline')}>Decline leave</button>
        </div>
      </>}
      {(record.status === 'pending' || record.status === 'approved') &&
        <div><button className="btn outline" disabled={busy} onClick={() => void decide('cancel')}>Cancel request</button></div>}
    </div>
  </section>;
}

function LeaveForm({ locations, employees, assignments, locationFilter, base, onSaved }: WorkforceProps & { base: string; onSaved: (id: string) => void }) {
  const [locationId, setLocationId] = useState(locationFilter);
  const [employeeId, setEmployeeId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const eligible = employees.filter(employee => employee.employment_status === 'active' &&
    assignments.some(assignment => assignment.location_id === locationId && assignment.employee_id === employee.id));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setError(''); setBusy(true);
    try {
      const { request } = await write<{ request: LeaveRequest }>(base, { ...Object.fromEntries(fields), locationId, employeeId });
      onSaved(request.id);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel rota-detail">
    <div className="panel-title"><h2>Record leave request</h2></div>
    <form className="form-stack pad" onSubmit={save}>
      {error && <p className="alert error" role="alert">{error}</p>}
      <label className="field">Location<select required value={locationId} onChange={event => { setLocationId(event.target.value); setEmployeeId(''); }}>
        <option value="">Select a location</option>
        {locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
      </select></label>
      <label className="field">Employee<select required value={employeeId} onChange={event => setEmployeeId(event.target.value)}>
        <option value="">Select an employee</option>
        {eligible.map(employee => <option key={employee.id} value={employee.id}>{employee.display_name}</option>)}
      </select></label>
      {locationId && !eligible.length && <p className="form-hint">No active employees are assigned to this location.</p>}
      <label className="field">Leave type<select name="kind" required>
        {Object.entries(kinds).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <div className="form-grid">
        <label className="field">First day<input type="date" required name="firstDate"/></label>
        <label className="field">Last day (inclusive)<input type="date" required name="lastDate"/></label>
      </div>
      <p className="form-hint">Dates use the selected location’s time zone.</p>
      <label className="field">Note (optional)<textarea name="note" maxLength={500} rows={3}/></label>
      <div><button className="btn primary" disabled={busy || !employeeId}>Submit request</button></div>
    </form>
  </section>;
}
