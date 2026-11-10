import { useEffect, useState, type FormEvent } from 'react';
import { api, write } from './api';
import type { WorkforceProps } from './Leave';
import { appPath, go, useRoute } from './routes';
import { branchInstant, branchWallTime, formatShiftTime, isRepeatedTime, rotaDay, rotaWeek, shiftOccurrence } from './time';

type EntryStatus = 'open' | 'submitted' | 'approved';
type Entry = {
  id: string; employee_name: string; location_name: string; time_zone: string;
  clock_in_utc: string; clock_out_utc: string | null; status: EntryStatus; revision: number;
  scheduled_start: string | null; scheduled_end: string | null; scheduled_unpaid_minutes: number | null;
  unpaid_seconds: number;
};
type TimeBreak = { id: string; kind: 'paid' | 'unpaid'; started_at_utc: string; ended_at_utc: string | null };
type TimeEvent = { action: string; occurred_at: string; actor: string | null; details_json: string };
type TimeDetails = { entry: Entry; breaks: TimeBreak[]; history: TimeEvent[] };
type TimePage = { entries: Entry[]; nextCursor: string | null };
const statuses: Record<EntryStatus, string> = { open: 'Clocked in', submitted: 'Awaiting approval', approved: 'Approved' };

function hours(start: string, end: string, unpaidSeconds: number) {
  return (Date.parse(end) - Date.parse(start) - unpaidSeconds * 1000) / 3_600_000;
}

const formatHours = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value) + ' h';

export function Timesheets(props: WorkforceProps) {
  const { org, locations, locationFilter, resourceId } = props;
  const route = useRoute();
  const zone = locations.find(location => location.id === locationFilter)?.time_zone || org.time_zone;
  const week = rotaWeek(null, zone, org.week_start);
  const from = rotaDay(route.searchParams.get('from') || week.start, zone);
  const to = rotaDay(route.searchParams.get('to') || week.days[6].date, zone);
  const status = route.searchParams.get('status') || '';
  const cursor = route.searchParams.get('cursor');
  const root = appPath(org.id, 'Timesheets'), base = '/organisations/' + org.id + '/timesheets';
  const managing = org.role !== 'employee';
  const [record, setRecord] = useState<TimeDetails | null>(null);
  const [list, setList] = useState<TimePage | null>(null);
  const [loaded, setLoaded] = useState('');
  const [error, setError] = useState('');

  const query = (start: string, end: string, state: string, page?: string) => {
    const params = new URLSearchParams({ from: start, to: end });
    if (locationFilter) params.set('location', locationFilter);
    if (state) params.set('status', state);
    if (page) params.set('cursor', page);
    return '?' + params;
  };
  const detail = (id: string) => root + '/' + id + query(from.date, to.date, status);
  const back = root + query(from.date, to.date, status);
  const endpoint = resourceId ? base + '/' + resourceId : base + query(from.from, to.to, status, cursor || undefined);
  useEffect(() => {
    if (!managing || resourceId === 'new') return;
    const controller = new AbortController();
    const { signal } = controller;
    setError('');
    const load = resourceId
      ? api<TimeDetails>(endpoint, { signal }).then(data => { if (!signal.aborted) setRecord(data); })
      : api<TimePage>(endpoint, { signal }).then(data => { if (!signal.aborted) setList(data); });
    void load.catch(reason => { if (!signal.aborted) setError(reason.message); })
      .finally(() => { if (!signal.aborted) setLoaded(endpoint); });
    return () => controller.abort();
  }, [endpoint, managing, resourceId]);

  if (!managing) return <p className="alert error" role="alert">Timesheet management is available to schedulers.</p>;
  if (resourceId === 'new') return <>
    <a className="btn outline" href={back}>Back to timesheets</a>
    <TimeEditor {...props} endpoint={base} onSaved={id => go(detail(id), true)}/>
  </>;
  if (loaded !== endpoint) return <p role="status">Loading timesheets…</p>;
  if (resourceId) {
    if (error || !record) return <p className="alert error" role="alert">{error || 'Timesheet not found.'}</p>;
    const reload = async () => setRecord(await api<TimeDetails>(endpoint));
    return <>
      <a className="btn outline" href={back}>Back to timesheets</a>
      <TimeEntryDetails key={'details/' + record.entry.id + '/' + record.entry.revision} {...record} org={org} endpoint={endpoint} reload={reload}/>
      {record.entry.status !== 'approved' && <TimeEditor key={'editor/' + record.entry.id + '/' + record.entry.revision}
        {...props} entry={record.entry} endpoint={endpoint} onSaved={reload}/>}
    </>;
  }
  return <section className="panel">
    <div className="panel-title"><h2>Timesheets</h2>{list && <a className="btn primary" href={detail('new')}>Record missed punches</a>}</div>
    <div className="form-stack pad">
      <form key={back} className="form-stack" onSubmit={event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        go(root + query(String(form.get('from')), String(form.get('to')), String(form.get('status'))));
      }}>
        <div className="form-grid">
          <label className="field">First day<input type="date" name="from" required defaultValue={from.date}/></label>
          <label className="field">Last day (inclusive)<input type="date" name="to" required defaultValue={to.date}/></label>
        </div>
        <label className="field">Timesheet status<select name="status" defaultValue={status}>
          <option value="">All statuses</option>
          {Object.entries(statuses).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <div className="rota-controls"><button className="btn outline">Apply filters</button><span>Period dates use {zone}.</span></div>
      </form>
      {error && <p className="alert error" role="alert">{error}</p>}
      {!error && list?.entries.length === 0 && <p>No timesheets match these filters.</p>}
      {!error && list?.entries.map(item => <a className="record workforce-record" key={item.id} href={detail(item.id)}>
        <div><strong>{item.employee_name}</strong><small>{item.location_name} · {formatShiftTime(item.clock_in_utc, item.time_zone, org.time_format)}</small></div>
        <span>{statuses[item.status]}</span>
      </a>)}
      <div className="rota-controls">
        {cursor && <a className="btn outline" href={back}>First page</a>}
        {!error && list?.nextCursor && <a className="btn outline" href={root + query(from.date, to.date, status, list.nextCursor)}>Older timesheets</a>}
      </div>
    </div>
  </section>;
}

function eventReason(event: TimeEvent) {
  const details = JSON.parse(event.details_json) as { reason?: string };
  return details.reason;
}

function TimeEntryDetails({ entry, breaks, history, org, endpoint, reload }: TimeDetails & {
  org: WorkforceProps['org']; endpoint: string; reload: () => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const format = (instant: string) => formatShiftTime(instant, entry.time_zone, org.time_format);
  const actual = entry.clock_out_utc ? hours(entry.clock_in_utc, entry.clock_out_utc, entry.unpaid_seconds) : null;
  const scheduled = entry.scheduled_start && entry.scheduled_end
    ? hours(entry.scheduled_start, entry.scheduled_end, (entry.scheduled_unpaid_minutes ?? 0) * 60) : null;
  async function approve() {
    setBusy(true); setError('');
    try {
      await write(endpoint + '/approve', { revision: entry.revision });
      await reload();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel rota-detail">
    <div className="panel-title"><h2>{entry.employee_name} timesheet</h2><span>{statuses[entry.status]}</span></div>
    <div className="form-stack pad">
      {error && <p className="alert error" role="alert">{error}</p>}
      <div><strong>{entry.location_name}</strong> · {entry.time_zone}</div>
      <div>Clock in {format(entry.clock_in_utc)}</div>
      <div>{entry.clock_out_utc ? 'Clock out ' + format(entry.clock_out_utc) : 'Clock out pending'}</div>
      <div>Scheduled paid time {scheduled === null ? '—' : formatHours(scheduled)}</div>
      <div>Actual paid time {actual === null ? '—' : formatHours(actual)}</div>
      {scheduled !== null && actual !== null && <div>Difference {formatHours(actual - scheduled)}</div>}
      <h3>Breaks</h3>
      {breaks.length ? <ul>{breaks.map(item => <li key={item.id}>
        {item.kind === 'paid' ? 'Paid' : 'Unpaid'} · {format(item.started_at_utc)} to {item.ended_at_utc ? format(item.ended_at_utc) : 'in progress'}
      </li>)}</ul> : <p>No breaks recorded.</p>}
      {entry.status === 'open' && breaks.some(item => !item.ended_at_utc) &&
        <OpenBreakCorrection entry={entry} endpoint={endpoint} reload={reload}/>}
      {entry.status === 'submitted' && <div><button className="btn primary" disabled={busy} onClick={() => void approve()}>Approve and lock timesheet</button></div>}
      <h3>Audit history</h3>
      {history.length ? <ul>{history.map((item, index) => <li key={index}>
        {item.action.replaceAll('_',' ')} · {item.actor || 'Former account'} · {format(item.occurred_at)}
        {eventReason(item) && <p className="workforce-note">{eventReason(item)}</p>}
      </li>)}</ul> : <p>No audit events recorded.</p>}
    </div>
  </section>;
}

function OpenBreakCorrection({ entry, endpoint, reload }: { entry: Entry; endpoint: string; reload: () => Promise<void> }) {
  const [end, setEnd] = useState('');
  const [occurrence, setOccurrence] = useState<'earlier' | 'later'>('earlier');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = new FormData(event.currentTarget).get('reason');
    setBusy(true); setError('');
    try {
      await write(endpoint + '/close-break', {
        endedAt: branchInstant(end, entry.time_zone, occurrence), reason, revision: entry.revision
      });
      await reload();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <form className="form-stack" onSubmit={save}>
    <h3>Correct missing break end</h3>
    {error && <p className="alert error" role="alert">{error}</p>}
    <label className="field">Break end<input type="datetime-local" required value={end} onChange={event => {
      setEnd(event.target.value); setOccurrence('earlier');
    }}/></label>
    {isRepeatedTime(end, entry.time_zone) && <label className="field">Break end time occurrence<select value={occurrence} onChange={event =>
      setOccurrence(event.target.value === 'later' ? 'later' : 'earlier')}>
      <option value="earlier">First occurrence</option><option value="later">Second occurrence</option></select></label>}
    <label className="field">Break correction reason<textarea required name="reason" maxLength={500} rows={3}/></label>
    <div><button className="btn outline" disabled={busy}>Save break end</button></div>
  </form>;
}

function TimeEditor({ locations, employees, assignments, locationFilter, entry, endpoint, onSaved }: WorkforceProps & {
  entry?: Entry; endpoint: string; onSaved: (id: string) => void | Promise<void>;
}) {
  const [locationId, setLocationId] = useState(locationFilter);
  const [employeeId, setEmployeeId] = useState('');
  const zone = entry?.time_zone || locations.find(location => location.id === locationId)?.time_zone || '';
  const [start, setStart] = useState(entry ? branchWallTime(entry.clock_in_utc, zone) : '');
  const [end, setEnd] = useState(entry?.clock_out_utc ? branchWallTime(entry.clock_out_utc, zone) : '');
  const [startOccurrence, setStartOccurrence] = useState(entry ? shiftOccurrence(entry.clock_in_utc, zone) : 'earlier');
  const [endOccurrence, setEndOccurrence] = useState(entry?.clock_out_utc ? shiftOccurrence(entry.clock_out_utc, zone) : 'earlier');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const eligible = employees.filter(employee => employee.employment_status === 'active' &&
    assignments.some(assignment => assignment.employee_id === employee.id && assignment.location_id === locationId));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = new FormData(event.currentTarget).get('reason');
    setError(''); setBusy(true);
    try {
      const data = { clockIn: branchInstant(start, zone, startOccurrence), clockOut: branchInstant(end, zone, endOccurrence), reason };
      if (entry) {
        await write(endpoint, { ...data, revision: entry.revision }, 'PATCH');
        await onSaved(entry.id);
      } else {
        const result = await write<{ entry: Entry }>(endpoint, { ...data, locationId, employeeId });
        await onSaved(result.entry.id);
      }
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel rota-detail">
    <div className="panel-title"><h2>{entry ? 'Correct punches' : 'Record missed punches'}</h2></div>
    <form className="form-stack pad" onSubmit={save}>
      {error && <p className="alert error" role="alert">{error}</p>}
      {!entry && <>
        <label className="field">Location<select required value={locationId} onChange={event => {
          setLocationId(event.target.value); setEmployeeId(''); setStartOccurrence('earlier'); setEndOccurrence('earlier');
        }}><option value="">Select a location</option>{locations.map(location => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label>
        <label className="field">Employee<select required value={employeeId} onChange={event => setEmployeeId(event.target.value)}>
          <option value="">Select an employee</option>{eligible.map(employee => <option value={employee.id} key={employee.id}>{employee.display_name}</option>)}
        </select></label>
      </>}
      <div className="form-grid">
        <label className="field">Clock in<input type="datetime-local" required step={0.001} value={start} onChange={event => {
          setStart(event.target.value); setStartOccurrence('earlier');
        }}/></label>
        <label className="field">Clock out<input type="datetime-local" required step={0.001} value={end} onChange={event => {
          setEnd(event.target.value); setEndOccurrence('earlier');
        }}/></label>
      </div>
      {isRepeatedTime(start, zone) && <label className="field">Clock-in time occurrence<select value={startOccurrence} onChange={event =>
        setStartOccurrence(event.target.value === 'later' ? 'later' : 'earlier')}>
        <option value="earlier">First occurrence</option><option value="later">Second occurrence</option></select></label>}
      {isRepeatedTime(end, zone) && <label className="field">Clock-out time occurrence<select value={endOccurrence} onChange={event =>
        setEndOccurrence(event.target.value === 'later' ? 'later' : 'earlier')}>
        <option value="earlier">First occurrence</option><option value="later">Second occurrence</option></select></label>}
      <p className="form-hint">{zone ? 'Enter branch-local times in ' + zone + '.' : 'Choose a location to set the time zone.'}</p>
      <label className="field">Correction reason<textarea required name="reason" maxLength={500} rows={3}/></label>
      <div><button className="btn primary" disabled={busy || !zone || (!entry && !employeeId)}>Save timesheet</button></div>
    </form>
  </section>;
}
