import { useEffect, useState, type FormEvent } from 'react';
import { api, write } from './api';
import type { Org } from './Locations';
import { appPath } from './routes';

type Record = {
  employee: { id: string; display_name: string; employment_status: 'active' | 'inactive';
    department?: string; position?: string; primary_location_id?: string | null };
  branches: { id: string; name: string }[];
  profiles: boolean;
};

export function TeamProfile({ org, id, locationFilter }: { org: Org; id: string; locationFilter: string }) {
  const endpoint = '/organisations/' + org.id + '/employees/' + id;
  const back = appPath(org.id,'Team') + (locationFilter ? '?location=' + encodeURIComponent(locationFilter) : '');
  const [data, setData] = useState<Record | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void api<Record>(endpoint, { signal }).then(result => { if (!signal.aborted) setData(result); })
      .catch(reason => { if (!signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [endpoint]);

  return <>
    <a className="btn outline" href={back}>Back to team</a>
    {error && <p className="alert error" role="alert">{error}</p>}
    {!data && !error && <p role="status">Loading staff profile…</p>}
    {data && <EmployeeDetails record={data} canEdit={org.role === 'owner' || org.role === 'admin'} endpoint={endpoint}
      reload={async () => setData(await api<Record>(endpoint))}/>}
  </>;
}

function EmployeeDetails({ record, canEdit, endpoint, reload }: {
  record: Record; canEdit: boolean; endpoint: string; reload: () => Promise<void>;
}) {
  const { employee, branches, profiles } = record;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const primaryName = branches.find(branch => branch.id === employee.primary_location_id)?.name;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const data = {
      displayName: values.get('displayName'), employmentStatus: values.get('employmentStatus'),
      ...(profiles ? { department: values.get('department'), position: values.get('position'),
        primaryLocationId: values.get('primaryLocationId') || null } : {})
    };
    setError(''); setNotice(''); setBusy(true);
    try {
      await write(endpoint, data, 'PATCH');
      await reload();
      setNotice('Staff profile saved.');
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel rota-detail">
    <div className="panel-title"><h2>{employee.display_name}</h2><span>{employee.employment_status}</span></div>
    <div className="form-stack pad">
      {error && <p className="alert error" role="alert">{error}</p>}
      {notice && <p className="alert success" role="status">{notice}</p>}
      <div><strong>Assigned branches</strong><p>{branches.length ? branches.map(branch => branch.name).join(', ') : 'None'}</p></div>
      {profiles && !canEdit && <dl>
        <dt>Department</dt><dd>{employee.department || 'Unspecified'}</dd>
        <dt>Position</dt><dd>{employee.position || 'Unspecified'}</dd>
        {primaryName && <><dt>Primary branch</dt><dd>{primaryName}</dd></>}
      </dl>}
      {canEdit && <form className="form-stack" onSubmit={save}>
        <label className="field">Employee name<input name="displayName" defaultValue={employee.display_name} required minLength={2} maxLength={100}/></label>
        <label className="field">Employment status<select name="employmentStatus" defaultValue={employee.employment_status}>
          <option value="active">Active</option><option value="inactive">Inactive</option>
        </select></label>
        {profiles && <>
          <div className="form-grid">
            <label className="field">Department<input name="department" defaultValue={employee.department} maxLength={100}/></label>
            <label className="field">Position<input name="position" defaultValue={employee.position} maxLength={100}/></label>
          </div>
          <label className="field">Primary branch<select name="primaryLocationId" defaultValue={employee.primary_location_id ?? ''}>
            <option value="">No primary branch</option>
            {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select></label>
        </>}
        <div><button className="btn primary" disabled={busy}>Save staff profile</button></div>
      </form>}
    </div>
  </section>;
}
