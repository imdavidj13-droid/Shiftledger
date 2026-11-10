import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { LayoutDashboard, CalendarDays, UsersRound, Clock3, CalendarCheck2, ArrowLeftRight, BarChart3, Settings2, Plus, LogOut, Building2, MapPin, ShieldCheck, ArrowRight, CheckCircle2, AlertCircle, RefreshCcw } from 'lucide-react';

type User = {id:string;name:string;email:string};
type Org = {id:string;name:string;slug:string;country_code:string;currency_code:string;time_zone:string;role:string};
type Location = {id:string;name:string;time_zone:string};
type Employee = {id:string;display_name:string;employment_status:string};
type Shift = {id:string;location_id:string;employee_id:string|null;starts_at_utc:string;ends_at_utc:string;status:string};
type AuthMode='login'|'register'|'forgot'|'reset'|'pending';
type Page='Overview'|'Schedule'|'Team'|'Timesheets'|'Leave'|'Shift swaps'|'Reports'|'Settings';

const PAGE_SLUGS: Record<Page,string> = {
 Overview:'overview',Schedule:'schedule',Team:'team',Timesheets:'timesheets',Leave:'leave','Shift swaps':'shift-swaps',Reports:'reports',Settings:'settings'
};
function appPath(organisationId:string,page:Page):string {
 return '/app/'+encodeURIComponent(organisationId)+'/'+PAGE_SLUGS[page];
}
function pathOrganisation():string|null {
 const match=window.location.pathname.match(/^\/app\/([^/]+)(?:\/[^/]+)?\/?$/);
 if(!match)return null;
 try{return decodeURIComponent(match[1]);}catch{return null;}
}
function pageForPath(organisationId:string):Page {
 const match=window.location.pathname.match(/^\/app\/([^/]+)\/([^/]+)\/?$/);
 if(!match||decodeURIComponent(match[1])!==organisationId)return 'Overview';
 return (Object.keys(PAGE_SLUGS) as Page[]).find(p=>PAGE_SLUGS[p]===match[2])||'Overview';
}

const nav: {name:Page;icon:typeof LayoutDashboard}[]=[
 {name:'Overview',icon:LayoutDashboard},{name:'Schedule',icon:CalendarDays},{name:'Team',icon:UsersRound},{name:'Timesheets',icon:Clock3},{name:'Leave',icon:CalendarCheck2},{name:'Shift swaps',icon:ArrowLeftRight},{name:'Reports',icon:BarChart3},{name:'Settings',icon:Settings2}
];
async function api<T>(path:string,options:RequestInit={}):Promise<T>{
 const res=await fetch('/api/v1'+path,{...options,credentials:'include',headers:{'Content-Type':'application/json',...options.headers}});
 const data: unknown = await res.json().catch(()=>({error:'Unexpected response from the server'}));
 if(!res.ok){
  const message = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string' ? data.error : 'Request failed';
  throw new Error(message);
 }
 return data as T;
}
const post=(path:string,value:unknown)=>api<any>(path,{method:'POST',body:JSON.stringify(value)});
const initialZone=Intl.DateTimeFormat().resolvedOptions().timeZone||'Europe/London';
function Alert({message,kind='error'}:{message:string;kind?:'error'|'success'}){return <div className={'alert '+kind} role="status">{kind==='error'?<AlertCircle size={19}/>:<CheckCircle2 size={19}/>}<span>{message}</span></div>}
function Field({label,children}:{label:string;children:ReactNode}){return <label className="field"><span>{label}</span>{children}</label>}
function Brand(){return <div className="brand"><div className="brand-mark"><CalendarCheck2 size={23}/></div><span>Shift<strong>Ledger</strong></span></div>}
/**
 * Verification must be visually distinct from sign-in. It only claims success
 * after the API confirms token redemption. Never redirect automatically.
 */
function VerificationPage({token}:{token:string}){
 const [state,setState]=useState<'checking'|'success'|'failed'>('checking');
 const [error,setError]=useState('');
 const started=useRef(false);
 useEffect(()=>{
  if(started.current)return;
  started.current=true;
  void post('/auth/verify',{token}).then(()=>{
   setState('success');
   window.history.replaceState({},'', '/email-verified');
  }).catch((reason:Error)=>{
   setError(reason.message);
   setState('failed');
   window.history.replaceState({},'', '/email-verification-failed');
  });
 },[token]);
 return <main className="confirmation-page">
  <header className="confirmation-header"><Brand/></header>
  <div className="confirmation-content">
   <section className="confirmation-card" aria-live="polite">
    <div className="confirmation-icon">{state==='success'?<CheckCircle2 size={48}/>:state==='failed'?<AlertCircle size={48}/>:<RefreshCcw size={44}/>}</div>
    <div className="overline">SHIFTLEDGER / ACCOUNT VERIFICATION</div>
    <h1>{state==='checking'?'Verifying your email…':state==='success'?'Email verified!':'Verification unsuccessful'}</h1>
    <p>{state==='checking'?'Checking your secure verification link.':state==='success'?'Your email address has been confirmed successfully. You can now sign in and set up your organisation.':error||'This verification link may have expired or already been used.'}</p>
    {state==='success'&&<div className="confirmation-success"><CheckCircle2 size={21}/> Your account is ready for sign in.</div>}
    {state!=='checking'&&<a className="btn primary confirmation-action" href="/">Continue to sign in <ArrowRight size={18}/></a>}
    {state==='failed'&&<p className="confirmation-help">If your link has expired, return to sign in and request a new verification email.</p>}
   </section>
  </div>
  <footer className="confirmation-footer">ShiftLedger · Secure account verification</footer>
 </main>;
}
// Visual-only routes let existing users review the confirmation layout without re-verifying.
function VerificationPreview({failed}:{failed:boolean}){
 return <main className="confirmation-page">
  <header className="confirmation-header"><Brand/></header>
  <div className="confirmation-content">
   <section className="confirmation-card" aria-label="Verification design preview">
    <div className="confirmation-preview-label">DESIGN PREVIEW — NO ACCOUNT CHANGES</div>
    <div className="confirmation-icon">{failed?<AlertCircle size={48}/>:<CheckCircle2 size={48}/>}</div>
    <div className="overline">SHIFTLEDGER / ACCOUNT VERIFICATION</div>
    <h1>{failed?'Verification unsuccessful':'Email verified!'}</h1>
    <p>{failed?'This verification link is invalid or has expired. Return to sign in and request a new link.':'Your email address has been confirmed successfully. You can now sign in and set up your organisation.'}</p>
    {!failed&&<div className="confirmation-success"><CheckCircle2 size={21}/> Your account is ready for sign in.</div>}
    <a className="btn primary confirmation-action" href="/">Continue to sign in <ArrowRight size={18}/></a>
    {failed&&<p className="confirmation-help">If your link has expired, return to sign in and request a new verification email.</p>}
   </section>
  </div>
  <footer className="confirmation-footer">ShiftLedger · Preview only — no verification request was made</footer>
 </main>;
}
function Auth({onSuccess}:{onSuccess:()=>void}){
 const params=new URLSearchParams(window.location.search);
 const reset=params.get('reset');
 const [mode,setMode]=useState<AuthMode>(reset?'reset':window.location.pathname==='/register'?'register':window.location.pathname==='/forgot-password'?'forgot':'login');
 const [email,setEmail]=useState(''),[password,setPassword]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{
  const sync=()=>{
   const next=window.location.pathname;
   setMode(next==='/register'?'register':next==='/forgot-password'?'forgot':next==='/check-email'?'pending':reset?'reset':'login');
  };
  window.addEventListener('popstate',sync);
  return()=>window.removeEventListener('popstate',sync);
 },[reset]);
 const selectMode=(next:AuthMode)=>{
  setMode(next);setError('');setMessage('');
  const path=next==='register'?'/register':next==='forgot'?'/forgot-password':next==='reset'?'/reset-password':next==='pending'?'/check-email':'/sign-in';
  window.history.pushState({},'',path);
 };
 async function submit(e:FormEvent){e.preventDefault();setError('');setMessage('');setBusy(true);
  try{
   if(mode==='register'){const r=await post('/auth/register',{email,password});selectMode('pending');setMessage(r.message);setPassword('')}
   else if(mode==='login'){await post('/auth/login',{email,password});onSuccess()}
   else if(mode==='pending'){const r=await post('/auth/resend-verification',{email});setMessage(r.message)}
   else if(mode==='forgot'){const r=await post('/auth/forgot-password',{email});setMessage(r.message)}
   else{await post('/auth/reset-password',{token:reset,password});window.history.replaceState({},'',window.location.pathname);selectMode('login');setMessage('Password updated. Sign in now.');setPassword('')}
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <div className="auth-layout"><div className="auth-art"><Brand/><div><span className="overline">THE WORKFORCE PLATFORM</span><h1>Run your team.<br/>Own your time.</h1><p>Scheduling, time tracking and team management. One secure home for your organisation.</p><div className="auth-points"><span>01 / Plan smarter</span><span>02 / Stay organised</span><span>03 / Grow together</span></div></div><small>SHIFTLEDGER — BUILT FOR REAL TEAMS</small></div>
 <div className="auth-side"><div className="auth-mobile-brand"><Brand/></div><div className="auth-card"><div className="overline">YOUR WORKSPACE STARTS HERE</div><h2>{mode==='login'?'Welcome back':mode==='register'?'Register your business':mode==='forgot'?'Reset your password':mode==='pending'?'Check your email':'Choose a new password'}</h2><p>{mode==='login'?'Sign in to manage your workforce.':mode==='register'?'Start with an email and password. We’ll set up your organisation after email verification.':mode==='forgot'?'We’ll email you a password-reset link.':mode==='pending'?'We sent a verification link to your email. Open it to activate your account.':'Enter a new password for your account.'}</p>
 {error&&<Alert message={error}/ >}{message&&<Alert message={message} kind="success"/>}
 <form onSubmit={submit} className="form-stack">
 {mode!=='reset'&&<Field label={mode==='register'?'Work email address':'Email address'}><input type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></Field>}
 {!['forgot','pending'].includes(mode)&&<Field label="Password"><input type="password" required minLength={mode==='login'?1:12} maxLength={128} autoComplete={mode==='login'?'current-password':'new-password'} value={password} onChange={e=>setPassword(e.target.value)}/></Field>}
 <button className="btn primary full" disabled={busy}>{busy?'Working…':mode==='login'?'Sign in':mode==='register'?'Create account':mode==='forgot'?'Send reset link':mode==='pending'?'Resend verification email':'Update password'} <ArrowRight size={18}/></button></form>
 <div className="auth-links">{mode==='login'?<><button onClick={()=>selectMode('register')}>Create an account</button><button onClick={()=>selectMode('forgot')}>Forgot password?</button></>:<button onClick={()=>selectMode('login')}>Back to sign in</button>}</div>
 </div><div className="auth-copyright">Secure accounts · Organisation-level data separation</div></div></div>
}
const countries=[
 {code:'GB',name:'United Kingdom',currency:'GBP',zone:'Europe/London'},
 {code:'IE',name:'Ireland',currency:'EUR',zone:'Europe/Dublin'},
 {code:'US',name:'United States',currency:'USD',zone:'America/New_York'},
 {code:'CA',name:'Canada',currency:'CAD',zone:'America/Toronto'},
 {code:'AU',name:'Australia',currency:'AUD',zone:'Australia/Sydney'},
 {code:'NZ',name:'New Zealand',currency:'NZD',zone:'Pacific/Auckland'},
 {code:'DE',name:'Germany',currency:'EUR',zone:'Europe/Berlin'},
 {code:'FR',name:'France',currency:'EUR',zone:'Europe/Paris'},
 {code:'IN',name:'India',currency:'INR',zone:'Asia/Kolkata'},
 {code:'ZA',name:'South Africa',currency:'ZAR',zone:'Africa/Johannesburg'},
 {code:'AE',name:'United Arab Emirates',currency:'AED',zone:'Asia/Dubai'},
 {code:'SG',name:'Singapore',currency:'SGD',zone:'Asia/Singapore'}
];
function Onboard({refresh}:{refresh:()=>void}){
 const [step,setStep]=useState(1);
 const [orgName,setOrgName]=useState(''),[industry,setIndustry]=useState(''),[teamSize,setTeamSize]=useState('');
 const [country,setCountry]=useState('GB'),[currency,setCurrency]=useState('GBP'),[zone,setZone]=useState(initialZone);
 const [weekStart,setWeekStart]=useState(1),[timeFormat,setTimeFormat]=useState('24h');
 const [multiLocation,setMultiLocation]=useState(false),[firstLocation,setFirstLocation]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const goNext=(e:FormEvent)=>{e.preventDefault();setError('');setStep(previous=>Math.min(3,previous+1));};
 function selectCountry(next:string){setCountry(next);const preset=countries.find(c=>c.code===next);if(preset){setCurrency(preset.currency);setZone(preset.zone);}}
 async function create(e:FormEvent){
   e.preventDefault();setBusy(true);setError('');
   try {
    await post('/organisations',{name:orgName,countryCode:country,currencyCode:currency,timeZone:zone,industry:industry||null,teamSize:teamSize||null,weekStart,timeFormat,...(firstLocation.trim()?{firstLocation:firstLocation.trim()}:{})});
    refresh();
   }catch(err){setError((err as Error).message)}finally{setBusy(false)}
 }
 return <div className="onboard"><div className="onboard-top"><Brand/><span>BUSINESS SETUP / {step} OF 3</span></div>
 <div className="onboard-body">
  <div className="overline">BUILD YOUR BUSINESS WORKSPACE</div>
  <h1>{step===1?'Tell us about your organisation.':step===2?'Set your scheduling preferences.':'Choose how to begin.'}</h1>
  <p className="onboard-description">{step===1?'One organisation can contain multiple sites, branches and teams.':step===2?'We’ll use these defaults across the organisation. Individual locations can have their own time zones.':'Create your organisation and optionally set up its first location. You can add more branches later.'}</p>
  <div className="onboard-progress" aria-label={'Onboarding step '+step+' of 3}>{[1,2,3].map(n=><span key={n} className={n<=step?'active':''}/>)}</div>
  <section className="form-panel"><div className="section-title"><Building2 size={24}/><div><h2>{step===1?'Business details':step===2?'How your business operates':'Your first workspace'}</h2><p>{step===1?'Start with the essentials.':step===2?'These settings can be updated later.':'All locations belong to this same organisation account.'}</p></div></div>
   {error&&<Alert message={error}/>}
   {step===1&&<form className="form-stack" onSubmit={goNext}>
    <Field label="Organisation name"><input required minLength={2} maxLength={100} value={orgName} onChange={e=>setOrgName(e.target.value)} placeholder="e.g. Cornerstone Coffee"/></Field>
    <Field label="Industry (optional)"><select value={industry} onChange={e=>setIndustry(e.target.value)}><option value="">Select an industry</option>{['Hospitality','Retail','Healthcare','Care services','Cleaning and facilities','Logistics','Education','Professional services','Manufacturing','Other'].map(t=><option key={t} value={t}>{t}</option>)}</select></Field>
    <Field label="Country"><select required value={country} onChange={e=>selectCountry(e.target.value)}>{countries.map(c=><option key={c.code} value={c.code}>{c.name}</option>)}</select></Field>
    <p className="onboard-hint">More countries will be available as we expand international presets.</p>
    <Field label="Approximate team size (optional)"><select value={teamSize} onChange={e=>setTeamSize(e.target.value)}><option value="">Select team size</option>{['1–5','6–20','21–50','51–100','101–250','251+'].map(t=><option key={t} value={t}>{t}</option>)}</select></Field>
    <button className="btn primary full">Continue <ArrowRight size={18}/></button>
   </form>}
   {step===2&&<form className="form-stack" onSubmit={goNext}>
    <div className="form-grid"><Field label="Currency"><input value={currency} required maxLength={3} pattern="[A-Za-z]{3}" onChange={e=>setCurrency(e.target.value.toUpperCase())}/></Field><Field label="First day of the week"><select value={weekStart} onChange={e=>setWeekStart(Number(e.target.value))}><option value={1}>Monday</option><option value={0}>Sunday</option><option value={6}>Saturday</option></select></Field></div>
    <Field label="Default time zone"><input required value={zone} onChange={e=>setZone(e.target.value)} placeholder="Europe/London"/></Field>
    <p className="onboard-hint">Use an IANA time zone, such as Europe/London. Location-specific time zones are supported.</p>
    <Field label="Time display"><select value={timeFormat} onChange={e=>setTimeFormat(e.target.value)}><option value="24h">24-hour</option><option value="12h">12-hour (AM/PM)</option></select></Field>
    <div className="onboard-actions"><button type="button" className="btn outline" onClick={()=>setStep(1)}>Back</button><button className="btn primary">Continue <ArrowRight size={18}/></button></div>
   </form>}
   {step===3&&<form className="form-stack" onSubmit={create}>
    <div className="workspace-choice"><Building2 size={23}/><div><strong>{orgName}</strong><span>{country} · {currency} · {zone}</span></div></div>
    <Field label="Location setup"><select value={multiLocation?'multiple':'single'} onChange={e=>setMultiLocation(e.target.value==='multiple')}><option value="single">One location for now</option><option value="multiple">Multiple locations / branches</option></select></Field>
    <p className="onboard-hint">{multiLocation?'Your branches will all use this same account. Start with one location, then add the others from Settings.':'You can add more locations later without creating another organisation.'}</p>
    <Field label="First location name (optional)"><input value={firstLocation} onChange={e=>setFirstLocation(e.target.value)} maxLength={100} placeholder="e.g. City Centre Branch"/></Field>
    <div className="onboard-actions"><button type="button" className="btn outline" onClick={()=>setStep(2)}>Back</button><button className="btn primary" disabled={busy}>{busy?'Creating…':'Create organisation'} <ArrowRight size={18}/></button></div>
   </form>}
  </section>
 </div></div>;
}
function Stat({title,value,note}:{title:string;value:string|number;note:string}){return <div className="stat-card"><div className="stat-label">{title}</div><strong>{value}</strong><span>{note}</span></div>}
function Empty({icon,heading,description}:{icon:ReactNode;heading:string;description:string}){return <div className="empty">{icon}<h3>{heading}</h3><p>{description}</p></div>}
function Dashboard({user,org,organisations,onLogout,onSwitch}:{user:User;org:Org;organisations:Org[];onLogout:()=>void;onSwitch:(id:string)=>void}){
 const [page,setPage]=useState<Page>(()=>pageForPath(org.id)),[error,setError]=useState(''),[success,setSuccess]=useState('');
 const navigate=(next:Page)=>{
  window.history.pushState({},'',appPath(org.id,next));
  setPage(next);setError('');setSuccess('');
 };
 useEffect(()=>{
  const sync=()=>setPage(pageForPath(org.id));
  window.addEventListener('popstate',sync);
  if(pathOrganisation()!==org.id||window.location.pathname!==appPath(org.id,pageForPath(org.id))){
   window.history.replaceState({},'',appPath(org.id,pageForPath(org.id)));
  }
  return()=>window.removeEventListener('popstate',sync);
 },[org.id]);
 const [locations,setLocations]=useState<Location[]>([]),[employees,setEmployees]=useState<Employee[]>([]),[shifts,setShifts]=useState<Shift[]>([]);
 const [locationName,setLocationName]=useState(''),[employeeName,setEmployeeName]=useState(''),[zone,setZone]=useState(org.time_zone);
 const [newLocation,setNewLocation]=useState(''),[newEmployee,setNewEmployee]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState('');
 const [busy,setBusy]=useState(false);
 const canManage=['owner','admin','manager'].includes(org.role);
 async function reload(){setError('');try{
  const base='/organisations/'+org.id;
  const responses=await Promise.all([api<{locations:Location[]}>(base+'/locations'),canManage?api<{employees:Employee[]}>(base+'/employees'):Promise.resolve({employees:[]}),canManage?api<{shifts:Shift[]}>(base+'/shifts'):Promise.resolve({shifts:[]})]);
  setLocations(responses[0].locations);setEmployees(responses[1].employees);setShifts(responses[2].shifts);
 }catch(e){setError((e as Error).message)}}
 useEffect(()=>{void reload()},[org.id]);
 async function action(fn:()=>Promise<any>,done:string){setBusy(true);setError('');setSuccess('');try{await fn();setSuccess(done);await reload()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 const base='/organisations/'+org.id;
 return <div className="app"><aside className="sidebar"><Brand/><div className="workspace"><div className="workspace-icon">{org.name.charAt(0).toUpperCase()}</div><div><strong>{org.name}</strong><small>{org.role}</small></div></div>{organisations.length>1&&<select className="org-picker" aria-label="Switch organisation" value={org.id} onChange={e=>onSwitch(e.target.value)}>{organisations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select>}<div className="nav-label">WORKSPACE</div><nav>{nav.map(({name,icon:Icon})=><a key={name} href={appPath(org.id,name)} aria-current={page===name?'page':undefined} className={'nav-item '+(page===name?'selected':'')} onClick={event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();navigate(name);}}><Icon size={19}/><span>{name}</span></a>)}</nav><div className="sidebar-bottom"><div className="sidebar-callout"><ShieldCheck size={23}/><strong>Your data, your organisation.</strong><span>All workspace requests are checked on the server.</span></div><button className="profile" onClick={onLogout}><span className="profile-icon">{user.name.charAt(0).toUpperCase()}</span><span><strong>{user.name}</strong><small>Sign out</small></span><LogOut size={18}/></button></div></aside>
 <div className="main"><header className="topbar"><div className="breadcrumb"><span>{org.name}</span><b>/</b><strong>{page}</strong></div><div className="top-right"><span className="role-tag">{org.role}</span><span className="profile-icon">{user.name.charAt(0).toUpperCase()}</span></div></header>
 <main className="page"><div className="overline">SHIFTLEDGER / {page.toUpperCase()}</div><div className="page-heading"><div><h1>{page==='Overview'?'Your workforce, organised.':page}</h1><p>{page==='Overview'?'Your live organisation overview.':'Manage '+page.toLowerCase()+' for '+org.name+'.'}</p></div><button className="btn outline" onClick={()=>void reload()}><RefreshCcw size={17}/> Refresh</button></div>
 {error&&<Alert message={error}/ >}{success&&<Alert message={success} kind="success"/>}
 {page==='Overview'&&<><div className="hero-strip"><div><span>YOUR ORGANISATION</span><h2>{org.name}</h2><p>{org.country_code} · {org.time_zone} · {org.currency_code}</p></div><span className="hero-role">{org.role.toUpperCase()}</span></div><div className="stats"><Stat title="Team members" value={canManage?employees.length:'—'} note="Active directory records"/><Stat title="Locations" value={locations.length} note="Operating sites"/><Stat title="Shifts" value={canManage?shifts.length:'—'} note="Created records"/><Stat title="Published shifts" value={canManage?shifts.filter(s=>s.status==='published').length:'—'} note="Awaiting publication workflow"/></div><div className="two-col"><section className="panel"><div className="panel-title"><h2>Upcoming shifts</h2><span>From your live database</span></div>{shifts.length? <div className="records">{shifts.slice(0,6).map(s=><div className="record" key={s.id}><CalendarDays size={19}/><div><strong>{new Date(s.starts_at_utc).toLocaleString()}</strong><small>{s.status} · {locations.find(l=>l.id===s.location_id)?.name||'Location'}</small></div></div>)}</div>:<Empty icon={<CalendarDays size={32}/>} heading="No shifts created" description="Add a location and employee, then create your first draft shift."/>}</section><section className="panel"><div className="panel-title"><h2>Getting started</h2><span>Organisation setup</span></div><div className="steps"><div><b>01</b><span><strong>Organisation created</strong><small>Your workspace is ready.</small></span><CheckCircle2 size={18}/></div><div><b>02</b><span><strong>Add locations</strong><small>Set up the places you operate.</small></span></div><div><b>03</b><span><strong>Add your team</strong><small>Create employee directory records.</small></span></div><div><b>04</b><span><strong>Plan shifts</strong><small>Draft a schedule for your team.</small></span></div></div></section></div></>}
 {page==='Settings'&&<div className="two-col"><section className="panel"><div className="panel-title"><h2>Organisation settings</h2></div><div className="details"><div><span>Name</span><strong>{org.name}</strong></div><div><span>Country</span><strong>{org.country_code}</strong></div><div><span>Time zone</span><strong>{org.time_zone}</strong></div><div><span>Currency</span><strong>{org.currency_code}</strong></div><div><span>Your role</span><strong>{org.role}</strong></div></div></section>{canManage&&<section className="panel"><div className="panel-title"><h2>Add a location</h2></div><form className="form-stack pad" onSubmit={e=>{e.preventDefault();void action(()=>post(base+'/locations',{name:locationName,timeZone:zone}),'Location created.');setLocationName('')}}><Field label="Location name"><input required minLength={2} value={locationName} onChange={e=>setLocationName(e.target.value)}/></Field><Field label="Time zone"><input required value={zone} onChange={e=>setZone(e.target.value)}/></Field><button className="btn primary" disabled={busy}><Plus size={17}/> Add location</button></form></section>}</div>}
 {page==='Team'&&<div className="two-col"><section className="panel"><div className="panel-title"><h2>Employee directory</h2><span>{employees.length} records</span></div>{employees.length?<div className="records">{employees.map(e=><div className="record" key={e.id}><UsersRound size={20}/><div><strong>{e.display_name}</strong><small>{e.employment_status}</small></div></div>)}</div>:<Empty icon={<UsersRound size={33}/>} heading="No employees yet" description="Create your first employee directory record."/>}</section>{canManage&&<section className="panel"><div className="panel-title"><h2>Add employee</h2></div><form className="form-stack pad" onSubmit={e=>{e.preventDefault();void action(()=>post(base+'/employees',{name:employeeName}),'Employee added.');setEmployeeName('')}}><Field label="Full name"><input required minLength={2} value={employeeName} onChange={e=>setEmployeeName(e.target.value)}/></Field><div className="form-hint">Directory records aren't login accounts. Invitations are a separate workflow.</div><button disabled={busy} className="btn primary"><Plus size={17}/> Add employee</button></form></section>}</div>}
 {page==='Schedule'&&<div className="two-col"><section className="panel"><div className="panel-title"><h2>Shift planner</h2><span>{shifts.length} records</span></div>{shifts.length?<div className="records">{shifts.map(s=><div className="record" key={s.id}><CalendarDays size={20}/><div><strong>{new Date(s.starts_at_utc).toLocaleString()} – {new Date(s.ends_at_utc).toLocaleString()}</strong><small>{s.status} · {employees.find(e=>e.id===s.employee_id)?.display_name||'Unassigned'} · {locations.find(l=>l.id===s.location_id)?.name||'Location'}</small></div></div>)}</div>:<Empty icon={<CalendarDays size={33}/>} heading="Your schedule is empty" description="Add a location and team member before creating a shift."/>}</section>{canManage&&<section className="panel"><div className="panel-title"><h2>Create draft shift</h2></div><form className="form-stack pad" onSubmit={e=>{e.preventDefault();void action(()=>post(base+'/shifts',{locationId:newLocation,employeeId:newEmployee||null,startsAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString(),breakMinutes:0}),'Draft shift created.')}}><Field label="Location"><select required value={newLocation} onChange={e=>setNewLocation(e.target.value)}><option value="">Select a location</option>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></Field><Field label="Employee"><select value={newEmployee} onChange={e=>setNewEmployee(e.target.value)}><option value="">Unassigned</option>{employees.map(x=><option key={x.id} value={x.id}>{x.display_name}</option>)}</select></Field><Field label="Start (local browser time)"><input type="datetime-local" required value={start} onChange={e=>setStart(e.target.value)}/></Field><Field label="End (local browser time)"><input type="datetime-local" required value={end} onChange={e=>setEnd(e.target.value)}/></Field><div className="form-hint">Draft only. Shift publication and staff notifications are not enabled yet.</div><button className="btn primary" disabled={busy||!locations.length}><Plus size={17}/> Create draft shift</button></form></section>}</div>}
 {(['Timesheets','Leave','Shift swaps','Reports'] as Page[]).includes(page)&&<section className="panel"><div className="panel-title"><h2>{page} module</h2><span>Not enabled</span></div><Empty icon={<ShieldCheck size={33}/>} heading="Not yet available" description="This module will not accept or simulate employee data until its API, permissions and approval flow are implemented."/></section>}
 <footer>© ShiftLedger · Real organisation data · No simulated statistics</footer></main></div></div>;
}
function App(){
 const verificationToken=new URLSearchParams(window.location.search).get('verify');
 const [user,setUser]=useState<User|null>(null),[orgs,setOrgs]=useState<Org[]>([]),[org,setOrg]=useState<Org|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 async function refresh(){try{const x=await api<{user:User}>('/auth/me');setUser(x.user);const y=await api<{organisations:Org[]}>('/organisations');setOrgs(y.organisations);setOrg(current=>y.organisations.find(o=>o.id===pathOrganisation())||y.organisations.find(o=>o.id===current?.id)||y.organisations[0]||null);setError('')}catch(e){setUser(null);setOrgs([]);setOrg(null);const msg=(e as Error).message;if(msg!=='Sign in required')setError(msg)}finally{setLoading(false)}}
 useEffect(()=>{void refresh()},[]);
 async function logout(){try{await post('/auth/logout',{})}finally{setUser(null);setOrg(null);setOrgs([])}}
 if(verificationToken)return <VerificationPage token={verificationToken}/>;
 if(window.location.pathname==='/preview/email-verified')return <VerificationPreview failed={false}/>;
 if(window.location.pathname==='/preview/email-verification-failed')return <VerificationPreview failed={true}/>;
 if(loading)return <div className="loading"><Brand/><p>Connecting to your workspace…</p></div>;
 if(!user)return <>{error&&<div className="floating-error"><Alert message={error}/></div>}<Auth onSuccess={()=>void refresh()}/></>;
 if(!org)return <Onboard refresh={()=>void refresh()}/>;
 return <Dashboard key={org.id} user={user} org={org} organisations={orgs} onLogout={()=>void logout()} onSwitch={id=>{const next=orgs.find(o=>o.id===id);if(next){window.history.pushState({},'',appPath(id,'Overview'));setOrg(next);}}}/>;
}
export default App;
