import { useEffect, useState, type FormEvent } from 'react';
import { api, write } from './api';
import { appPath, go } from './routes';

export type Org = {
  id: string;
  name: string;
  slug: string;
  country_code: string;
  currency_code: string;
  time_zone: string;
  week_start: number;
  time_format: '12h' | '24h';
  role: string;
};
export type Location = { id: string; name: string; time_zone: string; archived_at: string | null };
type Member = { user_id: string; display_name: string; role: string; status: string };
type Assignment = { user_id: string; location_id: string };

const canEdit = (org: Org) => org.role === 'owner' || org.role === 'admin';

function Notice({ message, success = false }: { message: string; success?: boolean }) {
  return message && <p role={success ? 'status' : 'alert'} className={'alert ' + (success ? 'success' : 'error')}>{message}</p>;
}

export function OrganisationSettings({ org, onSave }: { org: Org; onSave: (org: Org) => void }) {
  const [name, setName] = useState(org.name);
  const [timeZone, setTimeZone] = useState(org.time_zone);
  const [weekStart, setWeekStart] = useState(org.week_start);
  const [timeFormat, setTimeFormat] = useState(org.time_format);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const editable = canEdit(org);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      await write('/organisations/' + org.id, { name, timeZone, weekStart, timeFormat }, 'PATCH');
      onSave({ ...org, name: name.trim(), time_zone: timeZone.trim(), week_start: weekStart, time_format: timeFormat });
      setMessage('Organisation settings saved.');
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="panel settings-panel">
    <div className="panel-title"><h2>Organisation settings</h2><a href={appPath(org.id, 'Locations')}>View locations</a></div>
    <form className="form-stack pad" onSubmit={save}>
      <Notice message={error}/><Notice message={message} success/>
      <label className="field">Organisation name<input required minLength={2} maxLength={100} value={name} onChange={event => setName(event.target.value)} readOnly={!editable}/></label>
      <label className="field">Default time zone<input required maxLength={64} value={timeZone} onChange={event => setTimeZone(event.target.value)} readOnly={!editable}/></label>
      <div className="form-grid">
        <label className="field">First day of the week<select value={weekStart} disabled={!editable} onChange={event => setWeekStart(Number(event.target.value))}><option value={1}>Monday</option><option value={0}>Sunday</option><option value={6}>Saturday</option></select></label>
        <label className="field">Time display<select value={timeFormat} disabled={!editable} onChange={event => setTimeFormat(event.target.value as Org['time_format'])}><option value="24h">24-hour</option><option value="12h">12-hour (AM/PM)</option></select></label>
      </div>
      <p className="form-hint">Country {org.country_code} · Reporting currency {org.currency_code}. Each location keeps its own time zone.</p>
      {editable && <button className="btn primary" disabled={busy}>Save organisation settings</button>}
    </form>
  </section>;
}

export function Locations({ org, resourceId, locations, onLocationsChanged }: {
  org: Org; resourceId?: string; locations: Location[]; onLocationsChanged: () => Promise<void>;
}) {
  const editable = canEdit(org);
  const base = '/organisations/' + org.id;
  const directory = appPath(org.id, 'Locations');
  const [location, setLocation] = useState<Location | null>(null);
  const [archived, setArchived] = useState<Location[]>([]);
  const [managers, setManagers] = useState<Member[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [manager, setManager] = useState('');
  const [name, setName] = useState('');
  const [zone, setZone] = useState(org.time_zone);
  const [loading, setLoading] = useState(Boolean(resourceId || editable));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    async function load() {
      try {
        if (!resourceId) {
          const result = editable ? await api<{ locations: Location[] }>(base + '/locations?archived=1') : { locations: [] };
          if (active) setArchived(result.locations);
          return;
        }
        const result = await api<{ location: Location }>(base + '/locations/' + resourceId);
        const [members, access] = editable && !result.location.archived_at
          ? await Promise.all([
              api<{ members: Member[] }>(base + '/members'),
              api<{ assignments: Assignment[] }>(base + '/location-access')
            ])
          : [{ members: [] }, { assignments: [] }];
        if (!active) return;
        setLocation(result.location); setName(result.location.name); setZone(result.location.time_zone);
        setManagers(members.members.filter(member => member.role === 'manager' && member.status === 'active'));
        setAssignments(access.assignments.filter(item => item.location_id === resourceId));
      } catch (reason) { if (active) setError((reason as Error).message); }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [base, editable, resourceId, revision]);

  async function perform(action: () => Promise<void>, done: string) {
    setBusy(true); setError(''); setMessage('');
    try {
      await action();
      setMessage(done);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  const refresh = () => setRevision(previous => previous + 1);
  const endpoint = base + '/locations' + (resourceId ? '/' + resourceId : '');
  function save(event: FormEvent) {
    event.preventDefault();
    void perform(async () => {
      const result = await write<{location?: Location}>(endpoint, { name, timeZone: zone }, resourceId ? 'PATCH' : 'POST');
      await onLocationsChanged();
      if (result.location) go(directory + '/' + result.location.id);
      else refresh();
    }, resourceId ? 'Location details saved.' : 'Location created.');
  }

  const editor = <form className="form-stack pad" onSubmit={save}>
    <label className="field">Location name<input required minLength={2} maxLength={100} value={name} onChange={event => setName(event.target.value)}/></label>
    <label className="field">Location time zone<input required maxLength={64} list="location-zones" value={zone} onChange={event => setZone(event.target.value)}/></label>
    <datalist id="location-zones">{['UTC', ...Intl.supportedValuesOf('timeZone')].map(item => <option key={item} value={item}/>)}</datalist>
    <button className="btn primary" disabled={busy}>{resourceId ? 'Save location' : 'Add location'}</button>
  </form>;
  const list = (items: Location[], empty: string) => items.length ? <ul className="location-records">
    {items.map(item => <li key={item.id}><a href={directory + '/' + item.id}>{item.name}</a><span>{item.time_zone}</span></li>)}
  </ul> : <p className="pad">{empty}</p>;

  if (!resourceId) return <>
    <Notice message={error}/>
    <div className="two-col">
      <div className="location-stack">
        <section className="panel"><div className="panel-title"><h2>Active locations</h2><span>{locations.length}</span></div>{list(locations, 'No active locations available.')}</section>
        {editable && <section className="panel"><div className="panel-title"><h2>Archived locations</h2></div>
          {loading ? <p className="pad" role="status">Loading archived locations…</p> : list(archived, 'No archived locations.')}</section>}
      </div>
      {editable && <section className="panel"><div className="panel-title"><h2>Add a location</h2></div>{editor}</section>}
    </div>
  </>;

  return <>
    <a className="btn outline" href={directory}>All locations</a>
    <Notice message={error}/><Notice message={message} success/>
    {loading ? <p role="status">Loading location…</p> : location && <div className="two-col">
      <section className="panel"><div className="panel-title"><h2>{location.name}</h2><span>{location.archived_at ? 'Archived' : 'Active'}</span></div>
        {editable && !location.archived_at ? editor : <p className="pad">{location.time_zone}</p>}
        {editable && <div className="pad location-lifecycle">
          <p className="form-hint">{location.archived_at ? 'Restore this location to make it available for scheduling again.' : 'Archiving keeps the location history and stops new scheduling. Resolve upcoming shifts before archiving.'}</p>
          <button className="btn outline" disabled={busy} onClick={() => void perform(async () => {
            await write(endpoint + (location.archived_at ? '/restore' : '/archive'), {});
            await onLocationsChanged(); refresh();
          }, location.archived_at ? 'Location restored.' : 'Location archived.')}>{location.archived_at ? 'Restore location' : 'Archive location'}</button>
        </div>}
      </section>
      {editable && !location.archived_at && <section className="panel">
        <div className="panel-title"><h2>Branch managers</h2></div>
        <div className="form-stack pad">
          {assignments.length === 0 && <p>No managers assigned to this location.</p>}
          {assignments.map(item => <div key={item.user_id} className="location-assignment">
            <strong>{managers.find(person => person.user_id === item.user_id)?.display_name}</strong>
            <button className="btn outline" disabled={busy} onClick={() => void perform(async () => {
              await write(base + '/location-access/' + resourceId + '/' + item.user_id, {}, 'DELETE');
              refresh();
            }, 'Manager access revoked.')}>Revoke access</button>
          </div>)}
          <form className="form-stack" onSubmit={event => {
            event.preventDefault();
            void perform(async () => {
              await write(base + '/location-access', { locationId: resourceId, userId: manager });
              setManager(''); refresh();
            }, 'Manager assigned.');
          }}>
            <label className="field">Assign manager<select required value={manager} onChange={event => setManager(event.target.value)}>
              <option value="">Select an active manager</option>
              {managers.filter(person => !assignments.some(item => item.user_id === person.user_id)).map(person => <option key={person.user_id} value={person.user_id}>{person.display_name}</option>)}
            </select></label>
            <button className="btn primary" disabled={busy || !manager}>Grant branch access</button>
          </form>
        </div>
      </section>}
    </div>}
  </>;
}
