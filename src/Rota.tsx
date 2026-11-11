import { useEffect, useState, type FormEvent } from 'react';
import { api, write } from './api';
import { RotaBatch } from './RotaBatch';
import { ScheduleCalendar } from './ScheduleCalendar';
import type { ShiftTemplate } from './RotaTemplates';
import type { Location, Org } from './Locations';
import { appPath, go, useRoute } from './routes';
import { branchInstant, branchWallTime, formatShiftTime, isRepeatedTime, moveWallTime, rotaDay, rotaMonth, rotaWeek, shiftOccurrence } from './time';

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
  leave_conflict?: number;
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

export async function loadShifts(base: string, query: URLSearchParams, paginate: boolean, signal: AbortSignal): Promise<ShiftPage> {
  const first = await api<ShiftPage>(base + '?' + query, { signal });
  if (paginate) return first;
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
  const isBulk = resourceId === 'bulk';
  const shiftId = isBulk ? undefined : resourceId;
  const viewParam = isBulk ? 'week' : params.get('view') || (params.has('week') ? 'week' : null);
  const view: CalendarView = viewParam === 'week' || viewParam === 'day' ? viewParam : 'month';
  const week = rotaWeek(params.get('week') || params.get('date'), zone, org.week_start);
  const month = rotaMonth(params.get('month') || params.get('date')?.slice(0,7) || params.get('week')?.slice(0,7) || null, zone, org.week_start);
  const day = rotaDay(params.get('date'), zone);
  const days = view === 'month' ? month.days : view === 'day' ? [day] : week.days;
  const date = view === 'month' ? month.month : view === 'day' ? day.date : week.start;
  const focusDate = view === 'month' ? (month.today.startsWith(date) ? month.today : days[0].date) : date;
  const period = view === 'month' ? month : view === 'day' ? day : week;
  const manage = org.role !== 'employee';
  const coverage = manage && params.get('coverage') === '1';
  const base = '/organisations/' + org.id + '/shifts';
  const root = appPath(org.id, 'Schedule');
  const href = (id?: string, targetView = view, targetDate = date, cursor?: string, onlyCoverage = coverage) => {
    const query = calendarQuery(targetView, targetDate);
    if (locationFilter) query.set('location', locationFilter);
    if (onlyCoverage) query.set('coverage', '1');
    if (cursor) query.set('cursor', cursor);
    return root + (id ? '/' + id : '') + '?' + query;
  };
  const [result, setResult] = useState<ShiftPage | null>(null);
  const [record, setRecord] = useState<Shift | null>(null);
  const [preset, setPreset] = useState<ShiftTemplate | null>(null);
  const [loadedPath, setLoadedPath] = useState('');
  const [error, setError] = useState('');
  const cursor = view === 'week' && !isBulk ? params.get('cursor') : null;
  const copyId = resourceId === 'new' ? params.get('copy') : null;
  const copyEndpoint = copyId ? base + '/' + encodeURIComponent(copyId) : null;
  const presetId = resourceId === 'new' && !copyId ? params.get('template') : null;
  const presetEndpoint = presetId ? '/organisations/' + org.id + '/shift-templates/' + encodeURIComponent(presetId) : null;
  const editorSource = copyEndpoint || presetEndpoint;
  const query = new URLSearchParams({ from: days[0].from, to: days[days.length - 1].to });
  if (locationFilter) query.set('location', locationFilter);
  if (coverage) query.set('coverage','1');
  if (cursor) query.set('cursor', cursor);
  const queryString = query.toString();
  const endpoint = shiftId ? base + '/' + shiftId : base + '?' + queryString;
  const paginate = view === 'week' && !isBulk;
  const loadKey = editorSource || (shiftId ? endpoint : String(paginate) + ':' + endpoint);

  useEffect(() => {
    setError('');
    if (shiftId === 'new' && !editorSource) return;
    const controller = new AbortController();
    const { signal } = controller;
    const load = presetEndpoint
      ? api<{ template: ShiftTemplate }>(presetEndpoint, { signal }).then(data => { if (!signal.aborted) setPreset(data.template); })
      : shiftId
      ? api<{ shift: Shift }>(copyEndpoint || endpoint, { signal }).then(data => { if (!signal.aborted) setRecord(data.shift); })
      : loadShifts(base, new URLSearchParams(queryString), paginate, signal).then(data => { if (!signal.aborted) setResult(data); });
    void load.catch(reason => { if (!signal.aborted) setError(reason.message); })
      .finally(() => { if (!signal.aborted) setLoadedPath(loadKey); });
    return () => controller.abort();
  }, [base, endpoint, shiftId, copyEndpoint, queryString, paginate, loadKey, editorSource, presetEndpoint]);

  if (resourceId === 'new') return <><a className="btn outline" href={href()}>Back to calendar</a>
    {!manage ? <p className="alert error" role="alert">Only schedulers can create shifts.</p> :
      editorSource && loadedPath !== editorSource ? <p role="status">Loading shift template…</p> :
      error ? <p className="alert error" role="alert">{error}</p> :
      <ShiftEditor key={editorSource || 'new'} {...props} endpoint={base}
        initialDate={presetEndpoint ? focusDate : view === 'day' ? day.date : undefined}
        initialOpen={params.get('open') === '1'}
        template={copyEndpoint ? record || undefined : undefined} preset={presetEndpoint ? preset || undefined : undefined}
        onSaved={id => go(href(id), true)}/>}</>;
  if (loadedPath !== loadKey) return <p role="status">Loading rota…</p>;
  if (error) return <><p className="alert error" role="alert">{error}</p><a className="btn outline" href={href()}>Back to rota</a></>;

  if (isBulk) return <>
    <a className="btn outline" href={href()}>Back to rota</a>
    {manage ? <RotaBatch key={loadKey} records={[...(result?.shifts ?? [])].reverse()} base={base} org={org}
      from={days[0].from} to={days[6].to} back={href()}
      targetWeek={weeks => href(undefined, 'week', moveWallTime(week.start + 'T00:00', weeks * 7).slice(0, 10))}/>
      : <p className="alert error" role="alert">Only schedulers can copy or publish shifts.</p>}
  </>;
  if (shiftId && record) return <><a className="btn outline" href={href()}>Back to rota</a>
    <ShiftDetails key={'details/' + record.id + '/' + record.revision} record={record} org={org} manage={manage} endpoint={endpoint}
      onChanged={async () => setRecord((await api<{ shift: Shift }>(endpoint)).shift)} onDiscard={() => go(href(), true)}
      copyHref={href('new') + '&copy=' + encodeURIComponent(record.id)} openShifts={openShifts}/>
    {manage && openShifts && record.status !== 'draft' && <ShiftClaims key={endpoint + '/' + record.revision} endpoint={endpoint} onChanged={async () => setRecord((await api<{ shift: Shift }>(endpoint)).shift)}/>}
    {manage && (record.status === 'draft' || (record.status === 'published' && record.employee_id &&
      Date.parse(record.starts_at_utc) > Date.now())) && <ShiftEditor key={'editor/' + record.id + '/' + record.revision}
      {...props} endpoint={endpoint} shift={record} onSaved={async () => setRecord((await api<{ shift: Shift }>(endpoint)).shift)}/>}</>;

  const shifts = [...(result?.shifts ?? [])].reverse();
  return <ScheduleCalendar org={org} locations={locations} locationFilter={locationFilter}
    employees={props.employees} assignments={props.assignments} shifts={shifts}
    view={view} days={days} month={month} week={week} period={period} date={date}
    zone={zone} coverage={coverage} manage={manage} root={root} openShifts={openShifts}
    href={href} cursor={cursor} nextCursor={result?.nextCursor ?? null}/>;
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
      {Boolean(record.leave_conflict) && <p className="alert error" role="status">The assigned employee has approved leave during this shift.</p>}
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

function ShiftEditor({ locations, employees, assignments, locationFilter, openShifts, endpoint, shift, template, preset, initialDate, initialOpen, onSaved }: Props & {
  endpoint: string; shift?: Shift; template?: Shift; preset?: ShiftTemplate; initialDate?: string; initialOpen?: boolean; onSaved: (id: string) => void | Promise<void>;
}) {
  const initial = shift || template;
  const published = shift?.status === 'published';
  const [locationId, setLocationId] = useState(initial?.location_id || preset?.location_id || locationFilter);
  const [employeeId, setEmployeeId] = useState(initial?.employee_id || '');
  const [isOpen, setIsOpen] = useState(Boolean(initial?.is_open) || Boolean(initialOpen && openShifts));
  const [start, setStart] = useState(initial ? branchWallTime(initial.starts_at_utc, initial.time_zone) : initialDate ? initialDate + 'T' + (preset?.start_time ?? '09:00') : '');
  const [end, setEnd] = useState(initial ? branchWallTime(initial.ends_at_utc, initial.time_zone) : initialDate ? moveWallTime(initialDate + 'T' + (preset?.end_time ?? '17:00'), preset?.end_day_offset ?? 0) : '');
  const [startOccurrence, setStartOccurrence] = useState(initial ? shiftOccurrence(initial.starts_at_utc, initial.time_zone) : 'earlier');
  const [endOccurrence, setEndOccurrence] = useState(initial ? shiftOccurrence(initial.ends_at_utc, initial.time_zone) : 'earlier');
  const [occurrences, setOccurrences] = useState(1);
  const [operationId] = useState(() => crypto.randomUUID());
  const [breakMinutes, setBreakMinutes] = useState(initial?.unpaid_break_minutes ?? preset?.unpaid_break_minutes ?? 0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveAsUnpublished, setSaveAsUnpublished] = useState(false);
  const zone = locations.find(location => location.id === locationId)?.time_zone || '';
  const eligible = employees.filter(employee => employee.employment_status === 'active' &&
    assignments.some(assignment => assignment.employee_id === employee.id && assignment.location_id === locationId));
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!Number.isInteger(occurrences) || occurrences < 1 || occurrences > 12) return;
    setBusy(true); setError('');
    try {
      const draftAt = (days: number) => ({
        locationId, employeeId: employeeId || null, isOpen, breakMinutes,
        startsAt: branchInstant(moveWallTime(start, days), zone, startOccurrence),
        endsAt: branchInstant(moveWallTime(end, days), zone, endOccurrence)
      });
      if (!shift && occurrences > 1) {
        const result = await write<{ shifts: Shift[] }>(endpoint + '/bulk-create', {
          operationId, shifts: Array.from({ length: occurrences }, (_, index) => draftAt(index * 7))
        });
        await onSaved(result.shifts[0].id);
      } else {
        const result = await write<{ shift: Shift }>(endpoint, { ...draftAt(0), revision: shift?.revision }, shift ? 'PATCH' : 'POST');
        if (!shift && !saveAsUnpublished && (employeeId || (isOpen && openShifts))) {
          await write(endpoint + '/' + result.shift.id + '/publish', { revision: result.shift.revision });
        }
        await onSaved(result.shift.id);
      }
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel rota-detail">
    <div className="panel-title"><h2>{published ? 'Edit shift' : shift ? 'Edit unpublished shift' : template ? 'Duplicate shift' : 'Add shift'}</h2></div>
    <form className="form-stack pad" onSubmit={save}>
      {error && <p className="alert error" role="alert">{error}</p>}
      {preset && <p className="form-hint">Using {preset.name}. Review the date and choose a staff assignment before publishing.</p>}
      {template && <p className="form-hint">Copied from an existing shift. Review the date and time before creating a separate draft; overlapping shifts are still prevented.</p>}
      <label className="field">Location<select required value={locationId} onChange={event => {
        setLocationId(event.target.value); setEmployeeId(''); setStartOccurrence('earlier'); setEndOccurrence('earlier');
      }}><option value="">Select a location</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
      <label className="field">Employee<select value={employeeId} required={published} disabled={isOpen} onChange={event => setEmployeeId(event.target.value)}>
        <option value="">Unassigned</option>{eligible.map(employee => <option key={employee.id} value={employee.id}>{employee.display_name}</option>)}
      </select></label>
      {published && <p className="form-hint">Saving updates the published schedule immediately.</p>}
      {openShifts && !published && <label className="rota-checkbox"><input type="checkbox" checked={isOpen} onChange={event => {
        setIsOpen(event.target.checked);
        if (event.target.checked) setEmployeeId('');
      }}/> Mark as an open shift</label>}
      <div className="form-grid">
        <label className="field">Start<input type="datetime-local" step={0.001} required value={start} onChange={event => {setStart(event.target.value);setStartOccurrence('earlier');}}/></label>
        <label className="field">End<input type="datetime-local" step={0.001} required value={end} onChange={event => {setEnd(event.target.value);setEndOccurrence('earlier');}}/></label>
      </div>
      {isRepeatedTime(start, zone) && <label className="field">Start time occurrence<select value={startOccurrence} onChange={event => setStartOccurrence(event.target.value === 'later' ? 'later' : 'earlier')}>
        <option value="earlier">First occurrence</option><option value="later">Second occurrence</option>
      </select></label>}
      {isRepeatedTime(end, zone) && <label className="field">End time occurrence<select value={endOccurrence} onChange={event => setEndOccurrence(event.target.value === 'later' ? 'later' : 'earlier')}>
        <option value="earlier">First occurrence</option><option value="later">Second occurrence</option>
      </select></label>}
      <label className="field">Unpaid break (minutes)<input type="number" min={0} max={1440} required value={breakMinutes} onChange={event => setBreakMinutes(Number(event.target.value))}/></label>
      <p className="form-hint">{zone ? 'Enter local times in ' + zone + '.' : 'Select a branch to see its time zone.'}</p>
      {!shift && <label className="field">Weekly occurrences
        <input type="number" min={1} max={12} required value={occurrences} onChange={event => setOccurrences(Number(event.target.value))}/>
        <small className="form-hint">Includes this shift. Repeats use the same local times each week.</small>
      </label>}
      {!shift && occurrences === 1 && <label className="rota-checkbox"><input type="checkbox" checked={saveAsUnpublished} onChange={event => setSaveAsUnpublished(event.target.checked)}/> Save without publishing</label>}
      <button className="btn primary" disabled={busy || !zone}>{published ? 'Save changes' : shift ? 'Save changes' : occurrences > 1
        ? 'Create ' + occurrences + ' unpublished shifts' : !saveAsUnpublished && (employeeId || (isOpen && openShifts)) ? 'Add and publish shift' : 'Save shift without publishing'}</button>
    </form>
  </section>;
}
