import { useEffect, useState, type FormEvent } from 'react';
import { Building2, MapPinned, BriefcaseBusiness, UsersRound, CalendarDays, ArrowLeft, ArrowRight, Check, Plus } from 'lucide-react';
import { api, write } from './api';
import { appPath, go, useRoute } from './routes';
import type { Org, Location } from './Locations';
import './BusinessSetup.css';

/**
 * Business setup workspace, deliberately separate from account registration.
 * This component reuses an existing organisation and never creates another one.
 *
 * Uses an existing authorised owner/admin org and canonical D1 records.
 * The positions stage remains clearly gated until persisted catalogue support exists.
 */
export type SetupEmployee = { id: string; display_name: string; employment_status: string };
export type BusinessSetupProps = {
  org: Org;
  locations: Location[];
  employees: SetupEmployee[];
  onRefresh: () => Promise<void>;
  onOrganisationChange: (next: Org) => void;
  onExit: () => void;
};
const steps = [
  { title: 'Your business', subtitle: 'Make this workspace yours.', icon: Building2 },
  { title: 'Your workplaces', subtitle: 'Bring every site into one place.', icon: MapPinned },
  { title: 'How your team works', subtitle: 'Define the work, not just access permissions.', icon: BriefcaseBusiness },
  { title: 'Bring your team together', subtitle: 'People first. Invitations can come later.', icon: UsersRound },
  { title: 'Your first schedule', subtitle: 'Turn your setup into a real rota.', icon: CalendarDays }
] as const;

export function BusinessSetup({ org, locations, employees, onRefresh, onOrganisationChange, onExit }: BusinessSetupProps) {
  const route = useRoute();
  const requestedStep = Number(route.searchParams.get('step') || '1');
  const step = Number.isInteger(requestedStep) && requestedStep >= 1 && requestedStep <= 5 ? requestedStep : 1;
  const setupPath = appPath(org.id, 'Setup');
  const [name, setName] = useState(org.name);
  const [zone, setZone] = useState(org.time_zone);
  const [weekStart, setWeekStart] = useState(org.week_start);
  const [timeFormat, setTimeFormat] = useState<Org['time_format']>(org.time_format);
  const [locationName, setLocationName] = useState('');
  const [locationZone, setLocationZone] = useState(org.time_zone);
  const [employeeName, setEmployeeName] = useState('');
  const [employeeLocation, setEmployeeLocation] = useState('');
  const [hasShifts, setHasShifts] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const base = '/organisations/' + org.id;
  const canEdit = org.role === 'owner' || org.role === 'admin';
  const activeLocations = locations.filter(location => !location.archived_at);

  useEffect(() => {
    let active = true;
    setChecking(true);
    void api<{ shifts: unknown[] }>(base + '/shifts').then(result => {
      if (active) setHasShifts(result.shifts.length > 0);
    }).catch(() => {
      if (active) setHasShifts(false);
    }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [base]);

  function navigate(next: number) {
    setError('');
    setNotice('');
    const target = Math.max(1, Math.min(5, next));
    go(setupPath + (target === 1 ? '' : '?step=' + target));
  }

  async function perform(task: () => Promise<void>, message: string, next?: number) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await task();
      setNotice(message);
      if (next) navigate(next);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function saveBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void perform(async () => {
      await write(base, { name: name.trim(), timeZone: zone.trim(), weekStart, timeFormat }, 'PATCH');
      onOrganisationChange({ ...org, name: name.trim(), time_zone: zone.trim(), week_start: weekStart, time_format: timeFormat });
    }, 'Business preferences saved.', 2);
  }

  function addLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void perform(async () => {
      await write(base + '/locations', { name: locationName.trim(), timeZone: locationZone.trim() });
      await onRefresh();
      setLocationName('');
    }, 'Workplace added.');
  }

  function addEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void perform(async () => {
      await write(base + '/employees', { name: employeeName.trim(), locationId: employeeLocation });
      await onRefresh();
      setEmployeeName('');
    }, 'Team member saved. You can send invitations separately from Access.');
  }

  return <div className="sl-setup">
    <aside className="sl-setup-sidebar">
      <div className="sl-setup-logo"><span>SL</span><strong>ShiftLedger</strong></div>
      <div className="sl-setup-kicker">BUSINESS SETUP</div>
      <h1>Build a workspace that fits your team.</h1>
      <p>Five practical stages. Your organisation and everything you save stay in the same workspace.</p>
      <nav aria-label="Business setup steps" className="sl-setup-steps">
        {steps.map((item, index) => {
          const Icon = item.icon;
          const number = index + 1;
          return <button type="button" key={item.title} onClick={() => navigate(number)}
            className={step === number ? 'sl-setup-step current' : 'sl-setup-step'}
            aria-current={step === number ? 'step' : undefined}>
            <span className="sl-setup-num">{number}</span>
            <Icon size={18}/><span>{item.title}</span>
          </button>;
        })}
      </nav>
      <div className="sl-setup-business"><span>SETTING UP</span><strong>{org.name}</strong><small>{org.country_code} · {org.currency_code} · {org.role}</small></div>
    </aside>
    <main className="sl-setup-main">
      <div className="sl-setup-top">
        <span className="sl-setup-kicker">YOUR WORKSPACE / STEP {step} OF 5</span>
        <button type="button" className="btn outline" onClick={onExit}>Return to dashboard</button>
      </div>
      <div className="sl-setup-progress" aria-label={'Step ' + step + ' of 5'}>
        {steps.map((item, index) => <span key={item.title} className={index < step ? 'filled' : ''}/>)}
      </div>
      <header className="sl-setup-heading">
        <span className="sl-setup-kicker">LET'S GET YOUR BUSINESS READY</span>
        <h2>{steps[step - 1].title}</h2>
        <p>{steps[step - 1].subtitle}</p>
      </header>
      {error && <p className="alert error" role="alert">{error}</p>}
      {notice && <p className="alert success" role="status">{notice}</p>}
      {step === 1 && <section className="sl-setup-panel">
        <h3>Start with what you already have</h3>
        <p>These details are already connected to your organisation. Review or adjust them before continuing.</p>
        <form className="form-stack" onSubmit={saveBusiness}>
          <label className="field">Business name<input required minLength={2} maxLength={100} value={name} onChange={event => setName(event.target.value)} disabled={!canEdit}/></label>
          <div className="sl-setup-grid">
            <label className="field">Country<input value={org.country_code} readOnly/></label>
            <label className="field">Currency<input value={org.currency_code} readOnly/></label>
          </div>
          <label className="field">Primary time zone<input required maxLength={64} list="sl-setup-zones" value={zone} onChange={event => setZone(event.target.value)} disabled={!canEdit}/></label>
          <div className="sl-setup-grid">
            <label className="field">Week begins<select value={weekStart} onChange={event => setWeekStart(Number(event.target.value))} disabled={!canEdit}><option value={1}>Monday</option><option value={0}>Sunday</option><option value={6}>Saturday</option></select></label>
            <label className="field">Clock format<select value={timeFormat} onChange={event => setTimeFormat(event.target.value as Org['time_format'])} disabled={!canEdit}><option value="24h">24-hour</option><option value="12h">12-hour</option></select></label>
          </div>
          <datalist id="sl-setup-zones">{['UTC', ...Intl.supportedValuesOf('timeZone')].map(value => <option value={value} key={value}/>)}</datalist>
          <button disabled={busy || !canEdit} className="btn primary">Save and continue <ArrowRight size={17}/></button>
        </form>
      </section>}
      {step === 2 && <section className="sl-setup-panel">
        <h3>One business, all your workplaces</h3>
        <p>Each workplace can have its own time zone. You can add more sites at any time.</p>
        {activeLocations.length ? <ul className="sl-setup-records">{activeLocations.map(location => <li key={location.id}><MapPinned size={19}/><span><strong>{location.name}</strong><small>{location.time_zone}</small></span><Check size={19}/></li>)}</ul> : <p className="sl-setup-empty">No workplaces yet. Add your first site below.</p>}
        <form className="form-stack" onSubmit={addLocation}>
          <label className="field">Workplace name<input required minLength={2} maxLength={100} placeholder="e.g. North Branch" value={locationName} onChange={event => setLocationName(event.target.value)}/></label>
          <label className="field">Workplace time zone<input required list="sl-setup-zones-location" value={locationZone} onChange={event => setLocationZone(event.target.value)}/></label>
          <datalist id="sl-setup-zones-location">{['UTC', ...Intl.supportedValuesOf('timeZone')].map(value => <option value={value} key={value}/>)}</datalist>
          <button className="btn outline" disabled={busy || !canEdit}><Plus size={17}/> Add workplace</button>
        </form>
        <div className="sl-setup-actions"><button className="btn outline" onClick={() => navigate(1)}><ArrowLeft size={17}/> Back</button><button className="btn primary" onClick={() => navigate(3)} disabled={!activeLocations.length}>Continue <ArrowRight size={17}/></button></div>
      </section>}
      {step === 3 && <section className="sl-setup-panel">
        <h3>Describe the work people do</h3>
        <p>A job position such as Chef or Receptionist is different from an account permission such as Admin or Manager. We will keep these separate so a team member's job never grants unintended access.</p>
        <div className="sl-setup-pending"><BriefcaseBusiness size={26}/><div><strong>Job positions are awaiting their database-backed editor</strong><p>This step will become editable when the positions API is available. No sample roles or unsaved job titles will be added to your organisation.</p></div></div>
        <div className="sl-setup-actions"><button className="btn outline" onClick={() => navigate(2)}><ArrowLeft size={17}/> Back</button><button className="btn primary" onClick={() => navigate(4)}>Continue without positions <ArrowRight size={17}/></button></div>
      </section>}
      {step === 4 && <section className="sl-setup-panel">
        <h3>People make the schedule work</h3>
        <p>Add colleagues now, or invite them to sign in later. Nobody is notified just because you create a staff record.</p>
        {employees.length ? <ul className="sl-setup-records">{employees.map(person => <li key={person.id}><UsersRound size={18}/><span><strong>{person.display_name}</strong><small>{person.employment_status}</small></span></li>)}</ul> : <p className="sl-setup-empty">Your employee directory is empty.</p>}
        <form className="form-stack" onSubmit={addEmployee}>
          <label className="field">Employee name<input required minLength={2} maxLength={100} value={employeeName} onChange={event => setEmployeeName(event.target.value)} placeholder="Full name"/></label>
          <label className="field">Primary workplace<select required value={employeeLocation} onChange={event => setEmployeeLocation(event.target.value)}><option value="">Choose a workplace</option>{activeLocations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
          <button className="btn outline" disabled={busy || !canEdit}><Plus size={17}/> Add team member</button>
        </form>
        <div className="sl-setup-actions"><button className="btn outline" onClick={() => navigate(3)}><ArrowLeft size={17}/> Back</button><button className="btn primary" onClick={() => navigate(5)}>Continue <ArrowRight size={17}/></button></div>
      </section>}
      {step === 5 && <section className="sl-setup-panel">
        <h3>Your first real rota starts here</h3>
        <p>The scheduling module uses the staff and workplaces you have just configured. Create a draft, check conflicts and publish it when ready.</p>
        <div className="sl-setup-recap">
          <div><strong>{activeLocations.length}</strong><span>Workplaces</span></div>
          <div><strong>{employees.length}</strong><span>Team members</span></div>
          <div><strong>{checking ? '…' : hasShifts ? 'Yes' : 'Not yet'}</strong><span>Shift records</span></div>
        </div>
        <p>Publishing schedules is always an explicit action. Leaving this setup does not create or notify employees about any shifts.</p>
        <a className="btn primary" href={appPath(org.id, 'Schedule') + '/new'}>Create your first draft shift <ArrowRight size={17}/></a>
        <div className="sl-setup-actions"><button className="btn outline" onClick={() => navigate(4)}><ArrowLeft size={17}/> Back</button><button className="btn outline" onClick={onExit}>Return to dashboard</button></div>
      </section>}
      <footer className="sl-setup-footer">SHIFTLEDGER · ONE WORKSPACE, EVERY WORKPLACE</footer>
    </main>
  </div>;
}
