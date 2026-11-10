import { useState, type FormEvent } from 'react';
import { write } from './api';
import type { Org } from './Locations';
import type { Shift } from './Rota';
import { formatShiftTime, moveShiftTime } from './time';

const limit = 50;

export function RotaBatch({ records, org, from, to, base, back, targetWeek }: {
  records: Shift[]; org: Org; from: string; to: string; base: string; back: string;
  targetWeek: (weeks: number) => string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [weeks, setWeeks] = useState(1);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ message: string; href: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const source = records.filter(shift => shift.status !== 'cancelled' && shift.starts_at_utc >= from && shift.starts_at_utc < to);
  const choices = source.filter(shift => selected.includes(shift.id));
  const canPublish = choices.length > 0 && choices.every(shift => shift.status === 'draft');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const copy = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'copy';
    setBusy(true); setError(''); setNotice(null);
    try {
      if (copy) {
        await write(base + '/bulk-create', { operationId, shifts: choices.map(shift => ({
          locationId: shift.location_id, employeeId: shift.employee_id, breakMinutes: shift.unpaid_break_minutes,
          isOpen: Boolean(shift.is_open), startsAt: moveShiftTime(shift.starts_at_utc, shift.time_zone, weeks * 7),
          endsAt: moveShiftTime(shift.ends_at_utc, shift.time_zone, weeks * 7)
        })) });
        setNotice({ message: 'Copied ' + choices.length + (choices.length === 1 ? ' shift as a draft.' : ' shifts as drafts.'), href: targetWeek(weeks) });
      } else {
        await write(base + '/bulk-publish', { shifts: choices.map(({id,revision}) => ({id,revision})) });
        setNotice({ message: 'Published ' + choices.length + (choices.length === 1 ? ' shift.' : ' shifts.'), href: back });
      }
      setOperationId(crypto.randomUUID());
      setSelected([]);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="panel rota-detail">
    <div className="panel-title"><h2>Copy or publish shifts</h2></div>
    <form className="form-stack pad" onSubmit={submit}>
      <p className="form-hint">Choose up to 50 shifts that start within this week. Copying creates drafts at the same branch-local times in the target week. Publishing requires draft shifts.</p>
      {error && <p className="alert error" role="alert">{error}</p>}
      {notice && <p className="alert success" role="status">{notice.message} <a href={notice.href}>View rota</a></p>}
      {!source.length && <p>No shifts start this week for the selected branches.</p>}
      {source.length > 0 && <div className="rota-controls">
        <button className="btn outline" type="button" disabled={busy || source.length > limit} onClick={() => setSelected(source.map(shift => shift.id))}>Select all</button>
        <button className="btn outline" type="button" disabled={busy || !choices.length} onClick={() => setSelected([])}>Clear selection</button>
        <strong>{choices.length} selected</strong>
      </div>}
      {source.map(shift => <label className="record rota-checkbox" key={shift.id}>
        <input type="checkbox" checked={selected.includes(shift.id)}
          disabled={busy || (!selected.includes(shift.id) && selected.length >= limit)}
          onChange={event => {
            const checked = event.target.checked;
            setSelected(previous => checked ? [...previous,shift.id] : previous.filter(id => id !== shift.id));
          }}/>
        <div><strong>{shift.employee_name || (shift.is_open ? 'Open shift' : 'Unassigned')}</strong>
          <small>{shift.location_name} · {formatShiftTime(shift.starts_at_utc, shift.time_zone, org.time_format)} · {shift.status}</small></div>
      </label>)}
      <label className="field">Copy how many weeks ahead?<select value={weeks} onChange={event => setWeeks(Number(event.target.value))}>
        {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
      </select></label>
      <div className="rota-controls">
        <button className="btn outline" value="copy" disabled={busy || !choices.length || Boolean(notice)}>Copy selected shifts</button>
        <button className="btn primary" value="publish" disabled={busy || !canPublish || Boolean(notice)}>Publish selected drafts</button>
      </div>
    </form>
  </section>;
}
