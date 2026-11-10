import { useEffect, useState, type FormEvent } from 'react';
import { api, write } from './api';
import type { Location, Org } from './Locations';

type Invitation = { id: string; email_normalized: string; role: string; status: string; expires_at: string };
type Member = { user_id: string; display_name: string; email_normalized: string; role: string; status: string };
type Employee = { id: string; display_name: string; employment_status: string; user_id?: string | null };
type InviteResult = { invitation: { token: string } };

export function Invitations({ org, locations, employees }: { org: Org; locations: Location[]; employees: Employee[] }) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('employee');
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [link, setLink] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const base = '/organisations/' + org.id;

  async function reload() {
    const [newInvitations, newMembers] = await Promise.all([
      api<{ invitations: Invitation[] }>(base + '/invitations'),
      api<{ members: Member[] }>(base + '/members')
    ]);
    setInvitations(newInvitations.invitations); setMembers(newMembers.members);
  }

  useEffect(() => {
    void reload().catch(reason => setError(reason.message)).finally(() => setLoading(false));
  }, [base]);

  async function perform(action: () => Promise<void>, done: string) {
    setBusy(true); setError(''); setMessage(''); setLink('');
    try {
      await action();
      await reload();
      setMessage(done);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  function showLink(result: InviteResult) {
    const url = new URL('/join', window.location.origin);
    url.searchParams.set('token', result.invitation.token);
    setLink(url.href);
  }

  function create(event: FormEvent) {
    event.preventDefault();
    void perform(async () => {
      showLink(await write<InviteResult>(base + '/invitations', {
        email, role, employeeId: role === 'employee' ? employeeId : null,
        locationIds: role === 'admin' ? [] : locationIds
      }));
      setEmail(''); setEmployeeId(''); setLocationIds([]);
    }, 'Invitation link created.');
  }

  return <>
    {error && <p className="alert error" role="alert">{error}</p>}
    {message && <p className="alert success" role="status">{message}</p>}
    {link && <section className="panel invite-link">
      <div className="panel-title"><h2>Private invitation link</h2></div>
      <div className="form-stack pad">
        <p>Send this link directly to the invited person. They’ll need a verified ShiftLedger account with the same email address. The link expires in seven days.</p>
        <label className="field">Invitation link<input readOnly value={link} onFocus={event => event.currentTarget.select()}/></label>
        <button className="btn outline" onClick={() => void navigator.clipboard.writeText(link)
          .then(() => setMessage('Invitation link copied.'))
          .catch(() => setError('Select the link field to copy it manually.'))}>Copy invitation link</button>
      </div>
    </section>}
    <div className="two-col">
      <div className="location-stack">
        <section className="panel"><div className="panel-title"><h2>Recent invitations</h2><span>Latest 100</span></div>
          {loading ? <p className="pad" role="status">Loading invitations…</p> : !invitations.length ? <p className="pad">No invitations to display.</p> :
            <ul className="location-records">{invitations.map(invite => <li key={invite.id}>
              <div><strong>{invite.email_normalized}</strong><p>{invite.role} · {invite.status}</p></div>
              {['pending', 'expired'].includes(invite.status) && (invite.role !== 'admin' || org.role === 'owner') && <div className="assignment-actions">
                <button className="btn outline" disabled={busy} onClick={() => void perform(async () => {
                  showLink(await write<InviteResult>(base + '/invitations/' + invite.id + '/renew', {}));
                }, 'New link created. The previous link has been invalidated.')}>Renew link</button>
                <button className="btn outline" disabled={busy} onClick={() => void perform(async () => {
                  await write(base + '/invitations/' + invite.id + '/revoke', {});
                }, 'Invitation revoked.')}>Revoke invitation</button>
              </div>}
            </li>)}</ul>}
        </section>
        <section className="panel"><div className="panel-title"><h2>Organisation access</h2></div>
          {loading ? <p className="pad" role="status">Loading members…</p> : <ul className="location-records">{members.map(member => <li key={member.user_id}>
            <div><strong>{member.display_name}</strong><p>{member.email_normalized} · {member.role} · {member.status}</p></div>
            {member.role !== 'owner' && member.status !== 'invited' && (member.role !== 'admin' || org.role === 'owner') &&
              <button className="btn outline" disabled={busy} onClick={() => void perform(async () => {
                await write(base + '/members/' + member.user_id, { status: member.status === 'active' ? 'suspended' : 'active' }, 'PATCH');
              }, member.status === 'active' ? 'Organisation access suspended.' : 'Organisation access restored.')}>{member.status === 'active' ? 'Suspend access' : 'Restore access'}</button>}
          </li>)}</ul>}
        </section>
      </div>
      <section className="panel"><div className="panel-title"><h2>Invite a teammate</h2></div>
        <form className="form-stack pad" onSubmit={create}>
          <label className="field">Email address<input type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)}/></label>
          <label className="field">Role<select value={role} onChange={event => { setRole(event.target.value); setLocationIds([]); }}>
            <option value="employee">Employee</option><option value="manager">Branch manager</option>
            {org.role === 'owner' && <option value="admin">Organisation administrator</option>}
          </select></label>
          {role === 'employee' && <label className="field">Staff record<select value={employeeId} onChange={event => setEmployeeId(event.target.value)}>
            <option value="">Create a new record on acceptance</option>
            {employees.filter(person => person.employment_status === 'active' && !person.user_id).map(person => <option key={person.id} value={person.id}>{person.display_name}</option>)}
          </select></label>}
          {role !== 'admin' && <fieldset className="branch-choices">
            <legend>{role === 'manager' ? 'Assigned branches (required)' : 'Additional assigned branches'}</legend>
            {locations.length ? locations.map(location => <label key={location.id}>
              <input type="checkbox" checked={locationIds.includes(location.id)} onChange={event => {
                const checked = event.target.checked;
                setLocationIds(previous => checked ? [...previous, location.id] : previous.filter(id => id !== location.id));
              }}/>{location.name}
            </label>) : <p>Create a location before assigning branch access.</p>}
          </fieldset>}
          <button className="btn primary" disabled={busy || (role === 'manager' && !locationIds.length)}>Create invitation link</button>
        </form>
      </section>
    </div>
  </>;
}

export function JoinInvitation({ token, email, onJoin, onSwitch }: {
  token: string; email: string; onJoin: (organisationId: string) => void; onSwitch: () => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function accept() {
    setBusy(true); setError('');
    try {
      const joined = await write<{ organisationId: string }>('/invitations/accept', { token });
      onJoin(joined.organisationId);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  async function switchAccount() {
    setBusy(true); setError('');
    try { await onSwitch(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <main className="confirmation-page">
    <div className="confirmation-content"><section className="confirmation-card">
      <div className="overline">SHIFTLEDGER / TEAM INVITATION</div>
      <h1>Join your organisation</h1>
      <p>You’re signed in as {email}. Accept the invitation using the account that received it.</p>
      {error && <p className="alert error" role="alert">{error}</p>}
      <div className="form-stack">
        <button className="btn primary" disabled={busy} onClick={() => void accept()}>Accept invitation</button>
        <button className="btn outline" disabled={busy} onClick={() => void switchAccount()}>Use another account</button>
      </div>
    </section></div>
  </main>;
}
