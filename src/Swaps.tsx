import { useEffect, useState, type FormEvent } from 'react';
import { api, write } from './api';
import type { WorkforceProps } from './Leave';
import { loadShifts, type Shift } from './Rota';
import { appPath, go, useRoute } from './routes';
import { formatShiftTime, moveWallTime, rotaDay } from './time';

type SwapStatus = 'awaiting_employee' | 'pending' | 'approved' | 'declined' | 'cancelled';
type Swap = {
  id: string; status: SwapStatus; created_at: string; consent_at: string | null; decided_at: string | null;
  offered_shift_id: string; requested_shift_id: string;
  offered_start: string; offered_end: string; requested_start: string; requested_end: string;
  offering_name: string; receiving_name: string; offered_branch: string; requested_branch: string;
  offered_zone: string; requested_zone: string;
};
type SwapPage = { swaps: Swap[]; nextCursor: string | null };
const statuses: Record<SwapStatus, string> = {
  awaiting_employee: 'Awaiting employee consent', pending: 'Awaiting manager review',
  approved: 'Approved', declined: 'Declined', cancelled: 'Cancelled'
};

export function Swaps({ org, resourceId, locationFilter }: WorkforceProps) {
  const route = useRoute();
  const status = route.searchParams.get('status') || '';
  const cursor = route.searchParams.get('cursor');
  const date = rotaDay(route.searchParams.get('window'), org.time_zone).date;
  const managing = org.role !== 'employee';
  const root = appPath(org.id,'Shift swaps'), base = '/organisations/' + org.id + '/shift-swaps';
  const filters = (state: string, page?: string, window?: string) => {
    const query = new URLSearchParams();
    if (locationFilter) query.set('location', locationFilter);
    if (state) query.set('status', state);
    if (page) query.set('cursor', page);
    if (window) query.set('window', window);
    return query.size ? '?' + query : '';
  };
  const back = root + filters(status);
  const detail = (id: string) => root + '/' + id + filters(status);
  const endpoint = resourceId ? base + '/' + resourceId : base + filters(status, cursor || undefined);
  const [record, setRecord] = useState<Swap | null>(null);
  const [list, setList] = useState<SwapPage | null>(null);
  const [loaded, setLoaded] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!managing || resourceId === 'new') return;
    const controller = new AbortController();
    const { signal } = controller;
    setError('');
    const load = resourceId
      ? api<{ swap: Swap }>(endpoint, { signal }).then(data => { if (!signal.aborted) setRecord(data.swap); })
      : api<SwapPage>(endpoint, { signal }).then(data => { if (!signal.aborted) setList(data); });
    void load.catch(reason => { if (!signal.aborted) setError(reason.message); })
      .finally(() => { if (!signal.aborted) setLoaded(endpoint); });
    return () => controller.abort();
  }, [endpoint, managing, resourceId]);

  if (!managing) return <p className="alert error" role="alert">Swap management is available to schedulers.</p>;
  if (resourceId === 'new') return <>
    <a className="btn outline" href={back}>Back to shift swaps</a>
    <SwapForm key={date} org={org} locationFilter={locationFilter} date={date} base={base}
      onWindowChanged={window => go(root + '/new' + filters(status, undefined, window))}
      onSaved={id => go(detail(id), true)}/>
  </>;
  if (loaded !== endpoint) return <p role="status">Loading swap requests…</p>;
  if (error) return <p className="alert error" role="alert">{error}</p>;
  if (resourceId && record) return <>
    <a className="btn outline" href={back}>Back to shift swaps</a>
    <SwapDetails key={record.id + '/' + record.status} swap={record} endpoint={endpoint} org={org}
      onChanged={async () => setRecord((await api<{ swap: Swap }>(endpoint)).swap)}/>
  </>;
  return <section className="panel">
    <div className="panel-title"><h2>Shift swap requests</h2><a className="btn primary" href={detail('new')}>Record agreed swap</a></div>
    <div className="form-stack pad">
      <label className="field">Swap status<select value={status} onChange={event => go(root + filters(event.target.value))}>
        <option value="">All statuses</option>
        {Object.entries(statuses).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {list?.swaps.length === 0 && <p>No swap requests match these filters.</p>}
      {list?.swaps.map(swap => <a key={swap.id} className="record workforce-record" href={detail(swap.id)}>
        <div><strong>{swap.offering_name} and {swap.receiving_name}</strong><small>{swap.offered_branch} · {swap.requested_branch}</small></div>
        <span>{statuses[swap.status]}</span>
      </a>)}
      <div className="rota-controls">
        {cursor && <a className="btn outline" href={back}>First page</a>}
        {list?.nextCursor && <a className="btn outline" href={root + filters(status, list.nextCursor)}>Older requests</a>}
      </div>
    </div>
  </section>;
}

function SwapDetails({ swap, endpoint, org, onChanged }: {
  swap: Swap; endpoint: string; org: WorkforceProps['org']; onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canReview = swap.status === 'pending' || swap.status === 'awaiting_employee';
  async function decide(action: 'approve' | 'decline' | 'cancel') {
    setBusy(true); setError('');
    try {
      await write(endpoint + '/' + action, {});
      await onChanged();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  const shiftLink = (id: string) => appPath(org.id, 'Schedule') + '/' + id;
  const format = (time: string, zone: string) => formatShiftTime(time, zone, org.time_format);
  return <section className="panel rota-detail">
    <div className="panel-title"><h2>Shift swap request</h2><span>{statuses[swap.status]}</span></div>
    <div className="form-stack pad">
      {error && <p className="alert error" role="alert">{error}</p>}
      <a className="record workforce-record" href={shiftLink(swap.offered_shift_id)}>
        <div><strong>Offered by {swap.offering_name}</strong><small>{swap.offered_branch} · {format(swap.offered_start,swap.offered_zone)} to {format(swap.offered_end,swap.offered_zone)}</small></div>
      </a>
      <a className="record workforce-record" href={shiftLink(swap.requested_shift_id)}>
        <div><strong>Requested from {swap.receiving_name}</strong><small>{swap.requested_branch} · {format(swap.requested_start,swap.requested_zone)} to {format(swap.requested_end,swap.requested_zone)}</small></div>
      </a>
      {swap.consent_at && <p>Consent recorded {format(swap.consent_at,org.time_zone)}</p>}
      {swap.decided_at && <p>Reviewed {format(swap.decided_at,org.time_zone)}</p>}
      {canReview && <div className="rota-controls">
        {swap.status === 'pending' && <button className="btn primary" disabled={busy} onClick={() => void decide('approve')}>Approve swap</button>}
        <button className="btn outline" disabled={busy} onClick={() => void decide('decline')}>Decline swap</button>
        <button className="btn outline" disabled={busy} onClick={() => void decide('cancel')}>Cancel request</button>
      </div>}
    </div>
  </section>;
}

function SwapForm({ org, locationFilter, date, base, onSaved, onWindowChanged }: {
  org: WorkforceProps['org']; locationFilter: string; date: string; base: string;
  onSaved: (id: string) => void; onWindowChanged: (date: string) => void;
}) {
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [offered, setOffered] = useState('');
  const [requested, setRequested] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const first = rotaDay(date, org.time_zone).from;
    const lastDate = moveWallTime(date + 'T00:00', 27).slice(0, 10);
    const query = new URLSearchParams({ from: first, to: rotaDay(lastDate, org.time_zone).to, status: 'published' });
    void loadShifts('/organisations/' + org.id + '/shifts', query, false, signal).then(data => {
      if (!signal.aborted) setShifts(data.shifts.filter(shift => shift.employee_id && Date.parse(shift.starts_at_utc) > Date.now()).reverse());
    }).catch(reason => { if (!signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [date, org.id, org.time_zone]);

  const firstShift = shifts?.find(shift => shift.id === offered);
  const firstChoices = shifts?.filter(shift => !locationFilter || shift.location_id === locationFilter) || [];
  const secondChoices = shifts?.filter(shift => shift.employee_id !== firstShift?.employee_id) || [];
  const option = (shift: Shift) => <option key={shift.id} value={shift.id}>
    {shift.employee_name} · {shift.location_name} · {formatShiftTime(shift.starts_at_utc,shift.time_zone,org.time_format)}
  </option>;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const { swap } = await write<{ swap: Swap }>(base, {
        offeredShiftId: offered, requestedShiftId: requested, confirmedConsent: consent
      });
      onSaved(swap.id);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="panel rota-detail">
    <div className="panel-title"><h2>Record agreed swap</h2></div>
    <form className="form-stack pad" onSubmit={submit}>
      {error && <p className="alert error" role="alert">{error}</p>}
      {!shifts && !error && <p role="status">Loading published shifts…</p>}
      <label className="field">Search shifts from<input type="date" value={date} onChange={event => {
        if (event.target.value) onWindowChanged(event.target.value);
      }}/></label>
      <p className="form-hint">Showing upcoming assigned shifts within 28 days of the selected date.</p>
      {shifts && !firstChoices.length && <p>No assigned shifts in this window for the selected branch.</p>}
      <label className="field">Offered shift<select required value={offered} onChange={event => {
        setOffered(event.target.value); setRequested(''); setConsent(false);
      }}><option value="">Select a shift</option>{firstChoices.map(option)}</select></label>
      <label className="field">Requested shift<select required value={requested} disabled={!offered} onChange={event => {
        setRequested(event.target.value); setConsent(false);
      }}><option value="">Select a shift</option>{secondChoices.map(option)}</select></label>
      <label className="rota-checkbox"><input type="checkbox" required checked={consent} onChange={event => setConsent(event.target.checked)}/>
        Both employees have agreed to exchange these shifts</label>
      <div><button className="btn primary" disabled={busy || !offered || !requested || !consent}>Record swap for review</button></div>
    </form>
  </section>;
}
