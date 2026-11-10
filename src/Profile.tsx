import { useState, type FormEvent } from 'react';
import { write } from './api';

export type User = { id: string; name: string; email: string };

export function Profile({ user, onSave, workspace }: { user: User; onSave: (user: User) => void; workspace: string }) {
  const [name, setName] = useState(user.name);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setStatus(''); setError('');
    try {
      const result = await write<{ user: User }>('/auth/me', { name }, 'PATCH');
      onSave(result.user); setName(result.user.name); setStatus('Profile saved.');
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <main className="onboard"><div className="onboard-body">
    <div className="overline">SHIFTLEDGER / YOUR ACCOUNT</div>
    <h1>Personal profile</h1>
    <p>Manage the name displayed on your account.</p>
    <a className="btn outline" href={workspace}>Back to workspace</a>
    <section className="form-panel">
      {error && <p className="alert error" role="alert">{error}</p>}
      {status && <p className="alert success" role="status">{status}</p>}
      <form className="form-stack" onSubmit={save}>
        <label className="field">Display name<input value={name} required minLength={2} maxLength={100} autoComplete="name" onChange={event => setName(event.target.value)}/></label>
        <label className="field">Verified email address<input type="email" value={user.email} readOnly/></label>
        <button className="btn primary" disabled={busy}>Save profile</button>
      </form>
    </section>
  </div></main>;
}
