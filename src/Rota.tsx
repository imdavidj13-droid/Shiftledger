import { useEffect, useState, type FormEvent } from 'react';
import { api, write } from './api';
import type { Location, Org } from './Locations';
import { appPath, go, useRoute } from './routes';
import { branchInstant, branchWallTime, formatShiftTime, formatShiftClock, isRepeatedTime, rotaDay, rotaMonth, rotaWeek } from './time';

export type Shift = {
  id: string;
  location_id: string;
  employee_id: string | null;
  starts_at_utc: string;
  ends_at_utc: string;
  unpaid_break_minutes: number;
  status: 'draft' | 'published' | 'cancelled';
  revision: number;
  is_open?: number;
  location_name: string;
  time_zone: string;
  employee_name: string | null;
};
type Employee = { id: string; display_name: string; employment_status: string };
type Assignment = { employee_id: string; location_id: string };
type Props = {
  org: Org; locations: Location[]; employees: Employee[]; assignments: Assignment[];
  locationFilter: string; resourceId?: string; openShifts: boolean;
};

type CalendarView = 'week' | 'month' | 'day';
type ShiftPage = { shifts: Shift[]; nextCursor: string | null };
type ShiftClaim = { id: string; employee_name: string; status: 'pending' | 'approved' | 'declined' | 'cancelled' };

function isVacancy(shift: Shift) {
  return Boolean(shift.is_open && shift.status === 'published');
}

function shiftName(shift: Shift) {
  if (isVacancy(shift)) return 'Open shift';
  if (shift.is_open && shift.status === 'draft') return 'Open shift draft';
  return shift.employee_name || 'Unassigned';
}

function calendarQuery(view: CalendarView, date: string) {
  if (view === 'week') return new URLSearchParams({ week: date });
  return new URLSearchParams(view === 'month' ? { view, month: date } : { view, date });
}

async function loadShifts(base: string, query: URLSearchParams, view: CalendarView, signal: AbortSignal): Promise<ShiftPage> {
  const first = await api<ShiftPage>(base + '?' + query, { signal });
  if (view === 'week') return first;
  const shifts = first.shifts;
  let cursor = first.nextCursor;
  while (cursor) {
    const nextQuery = new URLSearchParams(query);
    nextQuery.set('cursor', cursor);
    const next = await api<ShiftPage>(base + '?' + nextQuery, { signal });
    shifts.push(...next.shifts);
    cursor = next.nextCursor;
  }
  return { shifts, nextCursor: null };
}

export function Rota(props: Props) {
  const { org, locations, locationFilter, resourceId, openShifts } = props;
  const route = useRoute();
  const zone = locations.find(location => location.id === locationFilter)?.time_zone || org.time_zone;
  const params = route.searchParams;
  const viewParam = params.get('view');
  const view: CalendarView = viewParam === 'month' || viewParam === 'day' ? viewParam : 'week';
  const week = rotaWeek(params.get('week') || params.get('date'), zone, org.week_start);
  const month = rotaMonth(params.get('month'), zone, org.week_start);
  const day = rotaDay(params.get('date'), zone);
  const days = view === 'month' ? month.days : view === 'day' ? [day] : week.days;
  const date = view === 'month' ? month.month : view === 'day' ? day.date : week.start;
  const period = view === 'month' ? month : view === 'day' ? day : week;
  const manage = org.role !== 'employee';
  const base = '/organisations/' + org.id + '/shifts';
  const root = appPath(org.id, 'Schedule');
  const href = (id?: string, targetView = view, targetDate = date, cursor?: string) => {
    const query = calendarQuery(targetView, targetDate);
    if (locationFilter) query.set('location', locationFilter);
    if (cursor) query.set('cursor', cursor);
    return root + (id ? '/' + id : '') + '?' + query;
  };
  const [result, setResult] = useState<ShiftPage | null>(null);
  const [record, setRecord] = useState<Shift | null>(null);
  const [loadedPath, setLoadedPath] = useState('');
  const [error, setError] = useState('');
  const cursor = view === 'week' ? params.get('cursor') : null;
  const copyId = resourceId === 'new' ? params.get('copy') : null;
  const copyEndpoint = copyId ? base + '/' + encodeURIComponent(copyId) : null;
  const query = new URLSearchParams({ from: days[0].from, to: days[days.length - 1].to });
  if (locationFilter) query.set('location', locationFilter);
  if (cursor) query.set('cursor', cursor);
  const queryString = query.toString();
  const endpoint = resourceId ? base + '/' + resourceId : base + '?' + queryString;
  const loadKey = copyEndpoint || (resourceId ? endpoint : view + ':' + endpoint);

  useEffect(() => {
    setError('');
    if (resourceId === 'new' && !copyEndpoint) return;
    const controller = new AbortController();
    const { signal } = controller;
    const load = resourceId
      ? api<{ shift: Shift }>(copyEndpoint || endpoint, { signal }).then(data => { if (!signal.aborted) setRecord(data.shift); })
      : loadShifts(base, new URLSearchParams(queryString), view, signal).then(data => { if (!signal.aborted) setResult(data); });
    void load.catch(reason => { if (!signal.aborted) setError(reason.message); })
      .finally(() => { if (!signal.aborted) setLoadedPath(loadKey); });
    return () => controller.abort();
  }, [base, endpoint, resourceId, copyEndpoint, queryString, view, loadKey]);

  if (resourceId === 'new') return <><a className="btn outline" href={href()}>Back to rota</a>
    {!manage ? <p className="alert error" role="alert">Only schedulers can create shifts.</p> :
      copyEndpoint && loadedPath !== copyEndpoint ? <p role="status">Loading shift template…</p> :
      error ? <p className="alert error" role="alert">{error}</p> :
      <ShiftEditor key={copyEndpoint || 'new'} {...props} endpoint={base} initialDate={view === 'day' ? day.date : undefined} template={copyEndpoint ? record || undefined : undefined}
        onSaved={id => go(href(id), true)}/>}</>;
  if (loadedPath !== loadKey) return <p role="status">Loading rota…</p>;
  if (error) return <><p className="alert error" role="alert">{error}</p><a className="btn outline" href={href()}>Back to rota</a></>;

  if (resourceId && record) return <><a className="btn outline" href={href()}>Back to rota</a>
    <ShiftDetails key={record.id + '/' + record.revision} record={record} org={org} manage={manage} endpoint={endpoint}
      onChanged={async () => setRecord((await api<{ shift: Shift }>(endpoint)).shift)} onDiscard={() => go(href(), true)}
      copyHref={href('new') + '&copy=' + encodeURIComponent(record.id)} openShifts={openShifts}/>
    {manage && openShifts && record.status !== 'draft' && <ShiftClaims key={endpoint + '/' + record.revision} endpoint={endpoint} onChanged={async () => setRecord((await api<{ shift: Shift }>(endpoint)).shift)}/>}
    {manage && record.status === 'draft' && <ShiftEditor key={record.id + '/' + record.revision}
      {...props} endpoint={endpoint} shift={record} onSaved={async () => setRecord((await api<{ shift: Shift }>(endpoint)).shift)}/>}</>;

  const shifts = [...(result?.shifts ?? [])].reverse();
  const focusDate = view === 'month' ? (month.today.startsWith(date) ? month.today : days[0].date) : date;
  const today = month.today;
  return <section className="rota">
    <div className="rota-toolbar">
      <div><h2>{manage ? { week: 'Weekly rota', month: 'Monthly rota', day: 'Daily rota' }[view] : 'My published shifts'}</h2>
        <p>{view === 'month' ? month.label : view === 'day' ? day.label : 'Week starting ' + days[0].label} · Calendar dates in {zone}</p></div>
      <div className="rota-controls">
        <nav className="rota-controls rota-views" aria-label="Calendar view">
          <a className={'btn ' + (view === 'week' ? 'primary' : 'outline')} aria-current={view === 'week' ? 'page' : undefined} href={href(undefined, 'week', focusDate)}>Week</a>
          <a className={'btn ' + (view === 'month' ? 'primary' : 'outline')} aria-current={view === 'month' ? 'page' : undefined} href={href(undefined, 'month', focusDate.slice(0, 7))}>Month</a>
        </nav>
        <a className="btn outline" href={href(undefined, view, period.previous)}>Previous {view}</a>
        <a className="btn outline" href={href(undefined, view, view === 'month' ? today.slice(0, 7) : today)}>{view === 'week' ? 'This week' : 'Today'}</a>
        <a className="btn outline" href={href(undefined, view, period.next)}>Next {view}</a>
        {manage && <a className="btn primary" href={href('new')}>Create draft shift</a>}
      </div>
    </div>
    <div className={'rota-days rota-view-' + view}>
      {view === 'month' && <>
        {month.weekdays.map((label, index) => <div key={index} className="rota-weekday">{label}</div>)}
        {Array.from({ length: month.leading }, (_, index) => <div className="rota-blank" key={'before-' + index} aria-hidden="true"/>)}
      </>}
      {days.map(day => {
        const records = shifts.filter(shift => shift.starts_at_utc < day.to && shift.ends_at_utc > day.from);
        const shown = view === 'month' ? records.slice(0, 2) : records;
        const vacancies = view === 'month' ? records.filter(isVacancy).length : 0;
        const daily = href(undefined, 'day', day.date);
        return <section className="rota-day" key={day.date}>
          <h3>{view === 'day' ? day.label : <a href={daily} aria-label={'View ' + day.label} aria-current={day.date === today ? 'date' : undefined}>{view === 'month' ? day.number : day.label}</a>}</h3>
          {!shown.length ? view !== 'month' && <p>No shifts</p> : <ul>{shown.map(shift => <li key={shift.id}>
            <a className={'rota-shift ' + shift.status + (isVacancy(shift) ? ' rota-vacancy' : '')} href={href(shift.id)}>
              <strong>{shiftName(shift)}</strong>
              {view === 'month'
                ? <span>{shift.starts_at_utc < day.from ? 'Continues' : formatShiftClock(shift.starts_at_utc, shift.time_zone, org.time_format)} · {shift.status}</span>
                : <><span>{shift.location_name} · {shift.status}</span>
                  <span>{formatShiftTime(shift.starts_at_utc, shift.time_zone, org.time_format)}</span>
                  {shift.starts_at_utc < day.from && <span>Continues from previous day</span>}</>}
            </a>
          </li>)}</ul>}
          {vacancies > 0 && <a className="rota-more" href={daily} aria-label={day.label + ', ' + vacancies + ' open shifts'}>{vacancies} open</a>}
          {records.length > shown.length && <a className="rota-more" href={daily} aria-label={day.label + ', ' + records.length + ' shifts'}>+{records.length - shown.length} more</a>}
        </section>;
      })}
      {view === 'month' && Array.from({ length: month.trailing }, (_, index) => <div className="rota-blank" key={'after-' + index} aria-hidden="true"/>)}
    </div>
    {(cursor || result?.nextCursor) && <div className="rota-controls pagination">
      {cursor && <a className="btn outline" href={href()}>First page</a>}
      {result?.nextCursor && <a className="btn outline" href={href(undefined, 'week', week.start, result.nextCursor)}>More shifts in this week</a>}
    </div>}
  </section>;
}

function ShiftDetails({ record, org, manage, endpoint, onChanged, onDiscard, copyHref, openShifts }: {
  record: Shift; org: Org; manage: boolean; endpoint: string; onChanged: () => Promise<void>; onDiscard: () => void; copyHref: string; openShifts: boolean;
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
    <div className="panel-title"><h2>{shiftName(record) === 'Unassigned' ? 'Unassigned shift' : shiftName(record)}</h2><span>{record.status}</span></div>
    <div className="form-stack pad">
      {error && <p className="alert error" role="alert">{error}</p>}
      <div><strong>{record.location_name}</strong> · {record.time_zone}</div>
      <div>{formatShiftTime(record.starts_at_utc, record.time_zone, org.time_format)} – {formatShiftTime(record.ends_at_utc, record.time_zone, org.time_format)}</div>
      <div>{record.unpaid_break_minutes} minutes unpaid break</div>
      {manage && openShifts && record.status === 'draft' && !record.is_open && !record.employee_id &&
        <p className="form-hint">Assign an employee or mark this as an open shift before publishing.</p>}
      {manage && <div className="rota-controls">
        <a className="btn outline" href={copyHref}>Duplicate as draft</a>
        {record.status === 'draft' && <><button className="btn primary" disabled={busy || (openShifts && !record.is_open && !record.employee_id)} onClick={() => void change('publish')}>Publish shift</button>
          <button className="btn outline" disabled={busy} onClick={() => void change('discard')}>Discard draft</button></>}
        {record.status === 'published' && <button className="btn outline" disabled={busy} onClick={() => void change('cancel')}>Cancel shift</button>}
      </div>}
    </div>
  </section>;
}

function ShiftClaims({ endpoint, onChanged }: { endpoint: string; onChanged: () => Promise<void> }) {
  const [claims, setClaims] = useState<ShiftClaim[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const path = endpoint + '/claims';
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void api<{ claims: ShiftClaim[] }>(path, { signal })
      .then(data => { if (!signal.aborted) setClaims(data.claims); })
      .catch(reason => { if (!signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [path]);

  async function decide(id: string, action: 'approve' | 'decline') {
    setError(''); setBusy(true);
    try {
      await write(path + '/' + id + '/' + action, {});
      setClaims((await api<{ claims: ShiftClaim[] }>(path)).claims);
      await onChanged();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="panel rota-detail">
    <div className="panel-title"><h2>Open shift claims</h2></div>
    <div className="form-stack pad">
      {error && <p className="alert error" role="alert">{error}</p>}
      {!claims && !error && <p role="status">Loading claims…</p>}
      {claims?.length === 0 && <p>No claims for this shift.</p>}
      {claims?.map(claim => <div className="record" key={claim.id}>
        <div><strong>{claim.employee_name}</strong><small>{claim.status}</small></div>
        {claim.status === 'pending' && <div className="rota-controls">
          <button className="btn primary" disabled={busy} onClick={() => void decide(claim.id, 'approve')}>Approve claim</button>
          <button className="btn outline" disabled={busy} onClick={() => void decide(claim.id, 'decline')}>Decline claim</button>
        </div>}
      </div>)}
    </div>
  </section>;
}

function ShiftEditor({ locations, employees, assignments, locationFilter, openShifts, endpoint, shift, template, initialDate, onSaved }: Props & {
  endpoint: string; shift?: Shift; template?: Shift; initialDate?: string; onSaved: (id: string) => void | Promise<void>;
}) {
  const initial = shift || template;
  const [locationId, setLocationId] = useState(initial?.location_id || locationFilter);
  const [employeeId, setEmployeeId] = useState(initial?.employee_id || '');
  const [isOpen, setIsOpen] = useState(Boolean(initial?.is_open));
  const [start, setStart] = useState(initial ? branchWallTime(initial.starts_at_utc, initial.time_zone) : initialDate ? initialDate + 'T09:00' : '');
  const [end, setEnd] = useState(initial ? branchWallTime(initial.ends_at_utc, initial.time_zone) : initialDate ? initialDate + 'T17:00' : '');
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
        locationId, employeeId: employeeId || null, isOpen, revision: shift?.revision,
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
      <label className="field">Employee<select value={employeeId} disabled={isOpen} onChange={event => setEmployeeId(event.target.value)}>
        <option value="">Unassigned</option>{eligible.map(employee => <option key={employee.id} value={employee.id}>{employee.display_name}</option>)}
      </select></label>
      {openShifts && <label className="rota-checkbox"><input type="checkbox" checked={isOpen} onChange={event => {
        setIsOpen(event.target.checked);
        if (event.target.checked) setEmployeeId('');
      }}/> Mark as an open shift</label>}
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
