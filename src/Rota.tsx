import { useEffect, useState, type FormEvent } from 'react';
import { api, write } from './api';
import type { Location, Org } from './Locations';
import { appPath, go, useRoute } from './routes';
import { branchInstant, branchWallTime, formatShiftTime, isRepeatedTime, rotaWeek } from './time';

export type Shift = {
  id: string;
  location_id: string;
  employee_id: string | null;
  starts_at_utc: string;
  ends_at_utc: string;
  unpaid_break_minutes: number;
  status: 'draft' | 'published' | 'cancelled';
  revision: number;
  location_name: string;
  time_zone: string;
  employee_name: string | null;
};
type Employee = { id: string; display_name: string; employment_status: string };
type Assignment = { employee_id: string; location_id: string };
type Props = {
  org: Org; locations: Location[]; employees: Employee[]; assignments: Assignment[];
  locationFilter: string; resourceId?: string;
};

export function Rota(props: Props) {
  const { org, locations, locationFilter, resourceId } = props;
  const route = useRoute();
  const zone = locations.find(location => location.id === locationFilter)?.time_zone || org.time_zone;
  const week = rotaWeek(route.searchParams.get('week'), zone, org.week_start);
  const manage = org.role !== 'employee';
  const base = '/organisations/' + org.id + '/shifts';
  const root = appPath(org.id, 'Schedule');
  const href = (id?: string, date = week.start, cursor?: string) => {
    const params = new URLSearchParams({ week: date });
    if (locationFilter) params.set('location', locationFilter);
    if (cursor) params.set('cursor', cursor);
    return root + (id ? '/' + id : '') + '?' + params;
  };
  const [result, setResult] = useState<{ shifts: Shift[]; nextCursor: string | null } | null>(null);
  const [record, setRecord] = useState<Shift | null>(null);
  const [loadedPath, setLoadedPath] = useState('');
  const [error, setError] = useState('');
  const cursor = route.searchParams.get('cursor');
  const copyId = resourceId === 'new' ? route.searchParams.get('copy') : null;
  const copyEndpoint = copyId ? base + '/' + encodeURIComponent(copyId) : null;
  const query = new URLSearchParams({ from: week.days[0].from, to: week.days[6].to });
  if (locationFilter) query.set('location', locationFilter);
  if (cursor) query.set('cursor', cursor);
  const endpoint = resourceId ? base + '/' + resourceId : base + '?' + query;

  useEffect(() => {
    if (resourceId === 'new' && !copyEndpoint) return;
    let active = true;
    setError('');
    if (resourceId) {
      const source = copyEndpoint || endpoint;
      void api<{ shift: Shift }>(source).then(data => { if (active) setRecord(data.shift); })
        .catch(reason => { if (active) setError(reason.message); }).finally(() => { if (active) setLoadedPath(source); });
    } else {
      void api<{ shifts: Shift[]; nextCursor: string | null }>(endpoint).then(data => { if (active) setResult(data); })
        .catch(reason => { if (active) setError(reason.message); }).finally(() => { if (active) setLoadedPath(endpoint); });
    }
    return () => { active = false; };
  }, [endpoint, resourceId, copyEndpoint]);

  if (resourceId === 'new') return <><a className="btn outline" href={href()}>Back to rota</a>
    {!manage ? <p className="alert error" role="alert">Only schedulers can create shifts.</p> :
      copyEndpoint && loadedPath !== copyEndpoint ? <p role="status">Loading shift template…</p> :
      error ? <p className="alert error" role="alert">{error}</p> :
      <ShiftEditor key={copyEndpoint || 'new'} {...props} endpoint={base} template={copyEndpoint ? record || undefined : undefined}
        onSaved={id => go(href(id), true)}/>}</>;
  if (loadedPath !== endpoint) return <p role="status">Loading rota…</p>;
  if (error) return <><p className="alert error" role="alert">{error}</p><a className="btn outline" href={href()}>Back to rota</a></>;

  if (resourceId && record) return <><a className="btn outline" href={href()}>Back to rota</a>
    <ShiftDetails key={record.id + '/' + record.revision} record={record} org={org} manage={manage} endpoint={endpoint}
      onChanged={async () => setRecord((await api<{ shift: Shift }>(endpoint)).shift)} onDiscard={() => go(href(), true)}
      copyHref={href('new') + '&copy=' + encodeURIComponent(record.id)}/>
    {manage && record.status === 'draft' && <ShiftEditor key={record.id + '/' + record.revision}
      {...props} endpoint={endpoint} shift={record} onSaved={async () => setRecord((await api<{ shift: Shift }>(endpoint)).shift)}/>}</>;

  const shifts = result?.shifts ?? [];
  return <section className="rota">
    <div className="rota-toolbar">
      <div><h2>{manage ? 'Weekly rota' : 'My published shifts'}</h2><p>Week starting {week.days[0].label} · Calendar dates in {zone}</p></div>
      <div className="rota-controls">
        <a className="btn outline" href={href(undefined, week.previous)}>Previous week</a>
        <a className="btn outline" href={root + (locationFilter ? '?location=' + encodeURIComponent(locationFilter) : '')}>This week</a>
        <a className="btn outline" href={href(undefined, week.next)}>Next week</a>
        {manage && <a className="btn primary" href={href('new')}>Create draft shift</a>}
      </div>
    </div>
    <div className="rota-days">{week.days.map(day => {
      const records = shifts.filter(shift => shift.starts_at_utc < day.to && shift.ends_at_utc > day.from)
        .sort((first, second) => first.starts_at_utc.localeCompare(second.starts_at_utc));
      return <section className="rota-day" key={day.date}><h3>{day.label}</h3>
        {!records.length ? <p>No shifts</p> : <ul>{records.map(shift => <li key={shift.id}>
          <a className={'rota-shift ' + shift.status} href={href(shift.id)}>
            <strong>{shift.employee_name || 'Unassigned'}</strong>
            <span>{shift.location_name} · {shift.status}</span>
            <span>{formatShiftTime(shift.starts_at_utc, shift.time_zone, org.time_format)}</span>
            {shift.starts_at_utc < day.from && <span>Continues from previous day</span>}
          </a>
        </li>)}</ul>}
      </section>;
    })}</div>
    {(cursor || result?.nextCursor) && <div className="rota-controls pagination">
      {cursor && <a className="btn outline" href={href()}>First page</a>}
      {result?.nextCursor && <a className="btn outline" href={href(undefined, week.start, result.nextCursor)}>More shifts in this week</a>}
    </div>}
  </section>;
}

function ShiftDetails({ record, org, manage, endpoint, onChanged, onDiscard, copyHref }: {
  record: Shift; org: Org; manage: boolean; endpoint: string; onChanged: () => Promise<void>; onDiscard: () => void; copyHref: string;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function change(action: 'publish' | 'cancel' | 'discard') {
    setBusy(true); setError('');
    try {
      await write(endpoint + '/' + action, { revision: record.revision });
      if (action === 'discard') onDiscard();
      else await onChanged();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel rota-detail">
    <div className="panel-title"><h2>{record.employee_name || 'Unassigned shift'}</h2><span>{record.status}</span></div>
    <div className="form-stack pad">
      {error && <p className="alert error" role="alert">{error}</p>}
      <div><strong>{record.location_name}</strong> · {record.time_zone}</div>
      <div>{formatShiftTime(record.starts_at_utc, record.time_zone, org.time_format)} – {formatShiftTime(record.ends_at_utc, record.time_zone, org.time_format)}</div>
      <div>{record.unpaid_break_minutes} minutes unpaid break</div>
      {manage && <div className="rota-controls">
        <a className="btn outline" href={copyHref}>Duplicate as draft</a>
        {record.status === 'draft' && <><button className="btn primary" disabled={busy} onClick={() => void change('publish')}>Publish shift</button>
          <button className="btn outline" disabled={busy} onClick={() => void change('discard')}>Discard draft</button></>}
        {record.status === 'published' && <button className="btn outline" disabled={busy} onClick={() => void change('cancel')}>Cancel shift</button>}
      </div>}
    </div>
  </section>;
}

function ShiftEditor({ locations, employees, assignments, locationFilter, endpoint, shift, template, onSaved }: Props & {
  endpoint: string; shift?: Shift; template?: Shift; onSaved: (id: string) => void | Promise<void>;
}) {
  const initial = shift || template;
  const [locationId, setLocationId] = useState(initial?.location_id || locationFilter);
  const [employeeId, setEmployeeId] = useState(initial?.employee_id || '');
  const [start, setStart] = useState(initial ? branchWallTime(initial.starts_at_utc, initial.time_zone) : '');
  const [end, setEnd] = useState(initial ? branchWallTime(initial.ends_at_utc, initial.time_zone) : '');
  const [startOccurrence, setStartOccurrence] = useState(initial && isRepeatedTime(start, initial.time_zone) && branchInstant(start, initial.time_zone) !== initial.starts_at_utc ? 'later' : 'earlier');
  const [endOccurrence, setEndOccurrence] = useState(initial && isRepeatedTime(end, initial.time_zone) && branchInstant(end, initial.time_zone) !== initial.ends_at_utc ? 'later' : 'earlier');
  const [breakMinutes, setBreakMinutes] = useState(initial?.unpaid_break_minutes ?? 0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const zone = locations.find(location => location.id === locationId)?.time_zone || '';
  const eligible = employees.filter(employee => employee.employment_status === 'active' &&
    assignments.some(assignment => assignment.employee_id === employee.id && assignment.location_id === locationId));
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await write<{ shift: Shift }>(endpoint, {
        locationId, employeeId: employeeId || null, revision: shift?.revision,
        startsAt: branchInstant(start, zone, startOccurrence as 'earlier' | 'later'),
        endsAt: branchInstant(end, zone, endOccurrence as 'earlier' | 'later'), breakMinutes
      }, shift ? 'PATCH' : 'POST');
      await onSaved(result.shift.id);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel rota-detail">
    <div className="panel-title"><h2>{shift ? 'Edit draft shift' : template ? 'Duplicate shift as draft' : 'Create draft shift'}</h2></div>
    <form className="form-stack pad" onSubmit={save}>
      {error && <p className="alert error" role="alert">{error}</p>}
      {template && <p className="form-hint">Copied from an existing shift. Review the date and time before creating a separate draft; overlapping shifts are still prevented.</p>}
      <label className="field">Location<select required value={locationId} onChange={event => {
        setLocationId(event.target.value); setEmployeeId(''); setStartOccurrence('earlier'); setEndOccurrence('earlier');
      }}><option value="">Select a location</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
      <label className="field">Employee<select value={employeeId} onChange={event => setEmployeeId(event.target.value)}>
        <option value="">Unassigned</option>{eligible.map(employee => <option key={employee.id} value={employee.id}>{employee.display_name}</option>)}
      </select></label>
      <div className="form-grid">
        <label className="field">Start<input type="datetime-local" step={0.001} required value={start} onChange={event => {setStart(event.target.value);setStartOccurrence('earlier');}}/></label>
        <label className="field">End<input type="datetime-local" step={0.001} required value={end} onChange={event => {setEnd(event.target.value);setEndOccurrence('earlier');}}/></label>
      </div>
      {isRepeatedTime(start, zone) && <label className="field">Start time occurrence<select value={startOccurrence} onChange={event => setStartOccurrence(event.target.value)}>
        <option value="earlier">First occurrence</option><option value="later">Second occurrence</option>
      </select></label>}
      {isRepeatedTime(end, zone) && <label className="field">End time occurrence<select value={endOccurrence} onChange={event => setEndOccurrence(event.target.value)}>
        <option value="earlier">First occurrence</option><option value="later">Second occurrence</option>
      </select></label>}
      <label className="field">Unpaid break (minutes)<input type="number" min={0} max={1440} required value={breakMinutes} onChange={event => setBreakMinutes(Number(event.target.value))}/></label>
      <p className="form-hint">{zone ? 'Enter local times in ' + zone + '.' : 'Select a branch to see its time zone.'}</p>
      <button className="btn primary" disabled={busy || !zone}>{shift ? 'Save draft' : template ? 'Create duplicate draft' : 'Create draft'}</button>
    </form>
  </section>;
}
