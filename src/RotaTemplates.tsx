import { useEffect, useState, type FormEvent } from 'react';
import { api, write } from './api';
import type { Location, Org } from './Locations';
import { appPath, go, useRoute } from './routes';

export type ShiftTemplate = {
  id: string; location_id: string; location_name: string; name: string; start_time: string; end_time: string;
  end_day_offset: number; unpaid_break_minutes: number; revision: number;
};

export function RotaTemplates({ org, locations, locationFilter }: { org: Org; locations: Location[]; locationFilter: string }) {
  const route = useRoute();
  const id = route.searchParams.get('template');
  const root = appPath(org.id, 'Schedule');
  const base = '/organisations/' + org.id + '/shift-templates';
  const params = new URLSearchParams(route.searchParams);
  params.delete('template');
  params.delete('cursor');
  const returnQuery = params.size ? '?' + params : '';
  const templateLink = (target: string) => {
    const query = new URLSearchParams(params);
    query.set('template', target);
    return root + '/templates?' + query;
  };
  const apply = (template: ShiftTemplate) => {
    const query = new URLSearchParams(params);
    query.set('template', template.id);
    query.set('location', template.location_id);
    return root + '/new?' + query;
  };
  const [records, setRecords] = useState<ShiftTemplate[] | null>(null);
  const [record, setRecord] = useState<ShiftTemplate | null>(null);
  const [loaded, setLoaded] = useState('');
  const [error, setError] = useState('');
  const endpoint = id ? base + '/' + encodeURIComponent(id) : base + (locationFilter ? '?location=' + encodeURIComponent(locationFilter) : '');

  useEffect(() => {
    if (id === 'new' || org.role === 'employee') return;
    const controller = new AbortController();
    const { signal } = controller;
    setError('');
    const load = id
      ? api<{ template: ShiftTemplate }>(endpoint, { signal }).then(data => { if (!signal.aborted) setRecord(data.template); })
      : api<{ templates: ShiftTemplate[] }>(endpoint, { signal }).then(data => { if (!signal.aborted) setRecords(data.templates); });
    void load.catch(reason => { if (!signal.aborted) setError(reason.message); })
      .finally(() => { if (!signal.aborted) setLoaded(endpoint); });
    return () => controller.abort();
  }, [endpoint, id, org.role]);

  const back = root + '/templates' + returnQuery;
  if (org.role === 'employee') return <p className="alert error" role="alert">Templates are available to schedulers.</p>;
  return <>
    <div className="rota-controls">
      <a className="btn outline" href={root + returnQuery}>Back to rota</a>
      {id && <a className="btn outline" href={back}>All templates</a>}
    </div>
    {id === 'new' ? <TemplateForm key="new" locations={locations} locationFilter={locationFilter} endpoint={base}
      onSaved={saved => go(templateLink(saved), true)} onArchive={() => go(back, true)}/>
      : loaded !== endpoint ? <p role="status">Loading shift templates…</p>
      : error ? <p className="alert error" role="alert">{error}</p>
      : id && record ? <>
        <TemplateForm key={record.id + '/' + record.revision} locations={locations} locationFilter={locationFilter}
          template={record} endpoint={endpoint} onSaved={async () => setRecord((await api<{ template: ShiftTemplate }>(endpoint)).template)}
          onArchive={() => go(back, true)}/>
        <div className="rota-controls"><a className="btn primary" href={apply(record)}>Use template in a draft</a></div>
      </> : <section className="panel rota-detail">
        <div className="panel-title"><h2>Shift templates</h2><a className="btn primary" href={templateLink('new')}>New template</a></div>
        <div className="form-stack pad">
          {!records?.length && <p>No templates for this branch filter.</p>}
          {records?.map(template => <div key={template.id} className="record workforce-record">
            <a className="staff-profile-link" href={templateLink(template.id)}>{template.name}</a>
            <div>{template.location_name}<small>{template.start_time}–{template.end_time}{template.end_day_offset ? ' next day' : ''}</small></div>
          </div>)}
        </div>
      </section>}
  </>;
}

function TemplateForm({ locations, locationFilter, endpoint, template, onSaved, onArchive }: {
  locations: Location[]; locationFilter: string; endpoint: string; template?: ShiftTemplate;
  onSaved: (id: string) => void | Promise<void>; onArchive: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      const result = await write<{ template: ShiftTemplate }>(endpoint, {
        ...Object.fromEntries(fields), breakMinutes:Number(fields.get('breakMinutes')),
        endDayOffset:Number(fields.has('overnight')), revision:template?.revision
      }, template ? 'PATCH' : 'POST');
      await onSaved(result.template.id);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  async function archive() {
    if (!template) return;
    setBusy(true); setError('');
    try {
      await write(endpoint + '/archive', { revision:template.revision });
      onArchive();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel rota-detail">
    <div className="panel-title"><h2>{template ? 'Edit shift template' : 'New shift template'}</h2></div>
    <form className="form-stack pad" onSubmit={save}>
      {error && <p className="alert error" role="alert">{error}</p>}
      <label className="field">Template name<input name="name" required minLength={2} maxLength={80} defaultValue={template?.name}/></label>
      <label className="field">Location<select name="locationId" required defaultValue={template?.location_id || locationFilter}>
        <option value="">Select a location</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
      </select></label>
      <div className="form-grid">
        <label className="field">Local start time<input type="time" required name="startTime" defaultValue={template?.start_time || '09:00'}/></label>
        <label className="field">Local end time<input type="time" required name="endTime" defaultValue={template?.end_time || '17:00'}/></label>
      </div>
      <label className="rota-checkbox"><input type="checkbox" name="overnight" defaultChecked={Boolean(template?.end_day_offset)}/> Ends the following day</label>
      <label className="field">Unpaid break (minutes)<input type="number" required min={0} max={1440} name="breakMinutes" defaultValue={template?.unpaid_break_minutes ?? 0}/></label>
      <p className="form-hint">Choose a date and employee when you apply this template to a draft.</p>
      <div className="rota-controls">
        <button className="btn primary" disabled={busy}>Save template</button>
        {template && <button className="btn outline" type="button" disabled={busy} onClick={() => void archive()}>Archive template</button>}
      </div>
    </form>
  </section>;
}
