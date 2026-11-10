import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { LayoutDashboard, CalendarDays, UsersRound, Clock3, CalendarCheck2, ArrowLeftRight, BarChart3, Settings2, UserRound, Plus, LogOut, Building2, MapPin, ShieldCheck, ArrowRight, CheckCircle2, AlertCircle, RefreshCcw } from 'lucide-react';
import { appPath, go, parseWorkspace, signInDestination, useRoute, type Page } from './routes';
import { api, ApiError, post, write } from './api';
import { Locations, OrganisationSettings, type Location, type Org } from './Locations';
import { formatShiftTime } from './time';
import { Rota, type Shift } from './Rota';
import { Leave } from './Leave';
import { Profile, type User } from './Profile';
import { Invitations, JoinInvitation } from './Invitations';

type Employee = {id:string;display_name:string;employment_status:string;user_id?:string|null};
type EmployeeLocation = {employee_id:string;location_id:string};
type AuthMode='login'|'register'|'forgot'|'reset'|'pending';
const nav: {name:Page;icon:typeof LayoutDashboard}[]=[
 {name:'Overview',icon:LayoutDashboard},{name:'Schedule',icon:CalendarDays},{name:'Team',icon:UsersRound},{name:'Locations',icon:MapPin},{name:'Access',icon:ShieldCheck},{name:'Timesheets',icon:Clock3},{name:'Leave',icon:CalendarCheck2},{name:'Shift swaps',icon:ArrowLeftRight},{name:'Reports',icon:BarChart3},{name:'Settings',icon:Settings2}
];
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
    {state!=='checking'&&<a className="btn primary confirmation-action" href="/sign-in">Continue to sign in <ArrowRight size={18}/></a>}
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
    <a className="btn primary confirmation-action" href="/sign-in">Continue to sign in <ArrowRight size={18}/></a>
    {failed&&<p className="confirmation-help">If your link has expired, return to sign in and request a new verification email.</p>}
   </section>
  </div>
  <footer className="confirmation-footer">ShiftLedger · Preview only — no verification request was made</footer>
 </main>;
}
function Auth({onSuccess}:{onSuccess:()=>void}){
 const route = useRoute();
 const reset = route.searchParams.get('reset');
 const mode: AuthMode = reset?'reset':route.pathname==='/register'?'register':route.pathname==='/forgot-password'?'forgot':route.pathname==='/check-email'?'pending':'login';
 const [email,setEmail]=useState(''),[password,setPassword]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [previousRoute,setPreviousRoute]=useState(route.href);
 if (previousRoute !== route.href) {
  setPreviousRoute(route.href);
  setError('');
  setMessage('');
  setPassword('');
 }
 const returnPath = signInDestination(route.search);
 const authPath=(path:string)=>path+(returnPath?'?next='+encodeURIComponent(returnPath):'');
 const selectMode=(next:AuthMode)=>{
  const path=next==='register'?'/register':next==='forgot'?'/forgot-password':next==='pending'?'/check-email':'/sign-in';
  go(authPath(path));
 };
 async function submit(e:FormEvent){e.preventDefault();setError('');setMessage('');setBusy(true);
  try{
   if(mode==='register'){const r=await post('/auth/register',{email,password});setPreviousRoute(new URL(authPath('/check-email'),route).href);selectMode('pending');setMessage(r.message);setPassword('')}
   else if(mode==='login'){
    await post('/auth/login',{email,password});
    const next = signInDestination(route.search);
    if (next) go(next, true);
    onSuccess();
   }
   else if(mode==='pending'){const r=await post('/auth/resend-verification',{email});setMessage(r.message)}
   else if(mode==='forgot'){const r=await post('/auth/forgot-password',{email});setMessage(r.message)}
   else{await post('/auth/reset-password',{token:reset,password});setPreviousRoute(new URL('/sign-in',route).href);go('/sign-in',true);setMessage('Password updated. Sign in now.');setPassword('')}
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <div className="auth-layout"><div className="auth-art"><Brand/><div><span className="overline">THE WORKFORCE PLATFORM</span><h1>Run your team.<br/>Own your time.</h1><p>Scheduling, time tracking and team management. One secure home for your organisation.</p><div className="auth-points"><span>01 / Plan smarter</span><span>02 / Stay organised</span><span>03 / Grow together</span></div></div><small>SHIFTLEDGER — BUILT FOR REAL TEAMS</small></div>
 <div className="auth-side"><div className="auth-mobile-brand"><Brand/></div><div className="auth-card"><div className="overline">YOUR WORKSPACE STARTS HERE</div><h2>{mode==='login'?'Welcome back':mode==='register'?'Register your business':mode==='forgot'?'Reset your password':mode==='pending'?'Check your email':'Choose a new password'}</h2><p>{mode==='login'?'Sign in to manage your workforce.':mode==='register'?'Start with an email and password. We’ll set up your organisation after email verification.':mode==='forgot'?'We’ll email you a password-reset link.':mode==='pending'?'We sent a verification link to your email. Open it to activate your account.':'Enter a new password for your account.'}</p>
 {returnPath?.startsWith('/join?')&&<p className="form-hint">Use the same email address as your invitation. If you need to register, verify your email and then return to this invitation.</p>}
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
const countryCodes = 'AF AX AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW'.split(' ');
const countryNames = new Intl.DisplayNames(['en'],{type:'region'});
const allCountries=countryCodes.map(code=>({code,name:countryNames.of(code)||code})).sort((a,b)=>a.name.localeCompare(b.name));
const timeZoneOptions = Array.from(new Set([
 'UTC',
 ...Intl.supportedValuesOf('timeZone'),
 ...countries.map(country=>country.zone),
 initialZone
])).sort((a,b)=>a.localeCompare(b));
type SetupDraft = {
 orgName:string; industry:string; teamSize:string; country:string; currency:string; zone:string;
 weekStart:number; timeFormat:string; multiLocation:boolean; branches:{name:string;timeZone:string}[];
};
function Onboard({refresh}:{refresh:()=>void}){
 const route=useRoute();
 const [initial]=useState<SetupDraft|undefined>(()=>window.history.state?.setupDraft);
 const [orgName,setOrgName]=useState(initial?.orgName??''),[industry,setIndustry]=useState(initial?.industry??''),[teamSize,setTeamSize]=useState(initial?.teamSize??'');
 const [country,setCountry]=useState(initial?.country??'GB'),[currency,setCurrency]=useState(initial?.currency??'GBP'),[zone,setZone]=useState(initial?.zone??'Europe/London');
 const [weekStart,setWeekStart]=useState(initial?.weekStart??1),[timeFormat,setTimeFormat]=useState(initial?.timeFormat??'24h');
 const [multiLocation,setMultiLocation]=useState(initial?.multiLocation??false),[branches,setBranches]=useState(initial?.branches??[{name:'',timeZone:''}]);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const requestedStep=Number(route.searchParams.get('step'));
 const step=requestedStep===3&&orgName.trim().length>=2&&/^[A-Z]{3}$/.test(currency)&&zone?3:
  requestedStep===2&&orgName.trim().length>=2?2:1;
 const setupDraft:SetupDraft={orgName,industry,teamSize,country,currency,zone,weekStart,timeFormat,multiLocation,branches};
 useEffect(()=>{
  const path=step===1?'/onboarding':'/onboarding?step='+step;
  if(route.pathname+route.search!==path)go(path,true,{setupDraft});
  else {
   const persist=window.setTimeout(()=>window.history.replaceState({setupDraft},'',path),200);
   return ()=>window.clearTimeout(persist);
  }
 },[route.href,step,orgName,industry,teamSize,country,currency,zone,weekStart,timeFormat,multiLocation,branches]);
 const setStep=(next:number)=>{setError('');go(next===1?'/onboarding':'/onboarding?step='+next,false,{setupDraft});};
 const goNext=(event:FormEvent)=>{event.preventDefault();setStep(Math.min(3,step+1));};
 function selectCountry(next:string){
  setCountry(next);
  const preset=countries.find(item=>item.code===next);
  setCurrency(preset?.currency??'');setZone(preset?.zone??initialZone);
 }
 async function create(e:FormEvent){
   e.preventDefault();setBusy(true);setError('');
   try {
    await post('/organisations',{name:orgName,countryCode:country,currencyCode:currency,timeZone:zone,industry:industry||null,teamSize:teamSize||null,weekStart,timeFormat,locations:multiLocation?branches:branches[0]?.name.trim()?[branches[0]]:[]});
    refresh();
   }catch(err){setError((err as Error).message)}finally{setBusy(false)}
 }
 return <div className="onboard"><div className="onboard-top"><Brand/><span>BUSINESS SETUP / {step} OF 3</span></div>
 <div className="onboard-body">
  <div className="overline">BUILD YOUR BUSINESS WORKSPACE</div>
  <h1>{step===1?'Tell us about your organisation.':step===2?'Set your scheduling preferences.':'Choose how to begin.'}</h1>
  <p className="onboard-description">{step===1?'One organisation can contain multiple sites, branches and teams.':step===2?'We’ll use these defaults across the organisation. Individual locations can have their own time zones.':'Create your organisation and optionally set up its first location. You can add more branches later.'}</p>
  <div className="onboard-progress" aria-label={'Onboarding step '+step+' of 3'}>{[1,2,3].map(n => <span key={n} className={step >= n ? 'active' : ''} />)}</div>
  <section className="form-panel"><div className="section-title"><Building2 size={24}/><div><h2>{step===1?'Business details':step===2?'How your business operates':'Your first workspace'}</h2><p>{step===1?'Start with the essentials.':step===2?'These settings can be updated later.':'All locations belong to this same organisation account.'}</p></div></div>
   {error&&<Alert message={error}/>}
   {step===1&&<form className="form-stack" onSubmit={goNext}>
    <Field label="Organisation name"><input required minLength={2} maxLength={100} value={orgName} onChange={e=>setOrgName(e.target.value)} placeholder="e.g. Cornerstone Coffee"/></Field>
    <Field label="Industry (optional)"><select value={industry} onChange={e=>setIndustry(e.target.value)}><option value="">Select an industry</option>{['Hospitality','Retail','Healthcare','Care services','Cleaning and facilities','Logistics','Education','Professional services','Manufacturing','Other'].map(t=><option key={t} value={t}>{t}</option>)}</select></Field>
    <Field label="Country"><select required value={country} onChange={e=>selectCountry(e.target.value)}>{allCountries.map(c=><option key={c.code} value={c.code}>{c.name}</option>)}</select></Field>
    <p className="onboard-hint">Country names are international. Currency and time zone defaults are suggested for common regions and can be customised in the next step.</p>
    <Field label="Approximate team size (optional)"><select value={teamSize} onChange={e=>setTeamSize(e.target.value)}><option value="">Select team size</option>{['1–5','6–20','21–50','51–100','101–250','251+'].map(t=><option key={t} value={t}>{t}</option>)}</select></Field>
    <button className="btn primary full">Continue <ArrowRight size={18}/></button>
   </form>}
   {step===2&&<form className="form-stack" onSubmit={goNext}>
    <div className="form-grid"><Field label="Currency"><input value={currency} required maxLength={3} pattern="[A-Za-z]{3}" onChange={e=>setCurrency(e.target.value.toUpperCase())}/></Field><Field label="First day of the week"><select value={weekStart} onChange={e=>setWeekStart(Number(e.target.value))}><option value={1}>Monday</option><option value={0}>Sunday</option><option value={6}>Saturday</option></select></Field></div>
    <Field label="Default time zone">
     <input required list="shiftledger-time-zone-options" value={zone} onChange={e=>setZone(e.target.value)} placeholder="Search by city or region, e.g. London"/>
     <datalist id="shiftledger-time-zone-options">{timeZoneOptions.map(timeZone=><option key={timeZone} value={timeZone}/>)}</datalist>
    </Field>
    <p className="onboard-hint">Start typing a city or region to find a time zone. We suggest a default based on your country. Each branch can use its own time zone.</p>
    <Field label="Time display"><select value={timeFormat} onChange={e=>setTimeFormat(e.target.value)}><option value="24h">24-hour</option><option value="12h">12-hour (AM/PM)</option></select></Field>
    <div className="onboard-actions"><button type="button" className="btn outline" onClick={()=>setStep(1)}>Back</button><button className="btn primary">Continue <ArrowRight size={18}/></button></div>
   </form>}
   {step===3&&<form className="form-stack" onSubmit={create}>
    <div className="workspace-choice"><Building2 size={23}/><div><strong>{orgName}</strong><span>{country} · {currency} · {zone}</span></div></div>
    <Field label="Location setup"><select value={multiLocation?'multiple':'single'} onChange={e=>{const multiple=e.target.value==='multiple';setMultiLocation(multiple);setBranches(previous=>multiple&&previous.length===1?[previous[0],{name:'',timeZone:''}]:previous);}}><option value="single">One location for now</option><option value="multiple">Multiple locations / branches</option></select></Field>
    <p className="onboard-hint">{multiLocation?'Add up to 20 branches now. They will all share your organisation account, staff directory and subscription.':'You can add more locations later without creating another organisation.'}</p>
    {(multiLocation?branches:branches.slice(0,1)).map((branch,index)=><div className="branch-setup" key={index}>
      <Field label={multiLocation?'Branch '+(index+1):'First location name (optional)'}><input required={multiLocation} minLength={2} maxLength={100} value={branch.name} onChange={e=>setBranches(prev=>prev.map((item,i)=>i===index?{...item,name:e.target.value}:item))} placeholder="e.g. City Centre Branch"/></Field>
      {(multiLocation||branch.name.trim())&&<Field label={multiLocation?'Branch '+(index+1)+' time zone (optional)':'Branch time zone (optional)'}><input list="branch-time-zones" placeholder={zone} value={branch.timeZone} onChange={e=>setBranches(prev=>prev.map((item,i)=>i===index?{...item,timeZone:e.target.value}:item))}/></Field>}
      {multiLocation&&branches.length>1&&<button type="button" className="btn outline" onClick={()=>setBranches(prev=>prev.filter((_,i)=>i!==index))}>Remove branch {index+1}</button>}
    </div>)}
    <datalist id="branch-time-zones">{timeZoneOptions.map(timeZone=><option key={timeZone} value={timeZone}/>)}</datalist>
    {multiLocation&&branches.length<20&&<button type="button" className="btn outline" onClick={()=>setBranches(prev=>[...prev,{name:'',timeZone:''}])}><Plus size={17}/> Add another branch</button>}
    <div className="onboard-actions"><button type="button" className="btn outline" onClick={()=>setStep(2)}>Back</button><button className="btn primary" disabled={busy}>{busy?'Creating…':'Create organisation'} <ArrowRight size={18}/></button></div>
   </form>}
  </section>
 </div></div>;
}
function Stat({title,value,note}:{title:string;value:string|number;note:string}){return <div className="stat-card"><div className="stat-label">{title}</div><strong>{value}</strong><span>{note}</span></div>}
function Empty({icon,heading,description}:{icon:ReactNode;heading:string;description:string}){return <div className="empty">{icon}<h3>{heading}</h3><p>{description}</p></div>}
function Dashboard({user,org,organisations,page,resourceId,locationFilter,onLogout,logoutError,onOrganisationChange}:{user:User;org:Org;organisations:Org[];page:Page;resourceId?:string;locationFilter:string;onLogout:()=>void;logoutError:string;onOrganisationChange:(org:Org)=>void}){
 const [error,setError]=useState(''),[success,setSuccess]=useState('');
 const [loading,setLoading]=useState(true);
 const [loadFailed,setLoadFailed]=useState(false);
 const filterSuffix=(location:string)=>location?'?location='+encodeURIComponent(location):'';
 const navPath=(next:Page)=>appPath(org.id,next)+(['Locations','Access'].includes(next)?'':filterSuffix(locationFilter));
 const changeLocation=(location:string)=>{
  const query=new URLSearchParams(window.location.search);
  if(location)query.set('location',location);
  else query.delete('location');
  query.delete('cursor');
  go(appPath(org.id,page)+(query.size?'?'+query:''));
 };
 const [locations,setLocations]=useState<Location[]>([]),[employees,setEmployees]=useState<Employee[]>([]),[shifts,setShifts]=useState<Shift[]>([]);
 const [openShifts,setOpenShifts]=useState(false);
 const [employeeLocations,setEmployeeLocations]=useState<EmployeeLocation[]>([]);
 const [employeeName,setEmployeeName]=useState('');
 const [busy,setBusy]=useState(false);
 const canManage=['owner','admin','manager'].includes(org.role);
 const canAdminister=['owner','admin'].includes(org.role);
 async function reload(){setError('');setLoadFailed(false);setLoading(true);try{
  const base='/organisations/'+org.id;
  const responses=await Promise.all([api<{locations:Location[]}>(base+'/locations'),canManage?api<{employees:Employee[]}>(base+'/employees'):Promise.resolve({employees:[]}),api<{shifts:Shift[];openShifts?:boolean}>(base+'/shifts'),canManage?api<{assignments:EmployeeLocation[]}>(base+'/employee-locations'):Promise.resolve({assignments:[]})]);
  setLocations(responses[0].locations);setEmployees(responses[1].employees);setShifts(responses[2].shifts);setOpenShifts(Boolean(responses[2].openShifts));setEmployeeLocations(responses[3].assignments);
 }catch(e){setLoadFailed(true);setError((e as Error).message)}finally{setLoading(false)}}
 useEffect(()=>{void reload()},[org.id]);
 const filteredShifts=locationFilter?shifts.filter(s=>s.location_id===locationFilter):shifts;
 const upcomingShifts=filteredShifts.filter(shift=>shift.status!=='cancelled'&&Date.parse(shift.ends_at_utc)>Date.now())
  .sort((a,b)=>a.starts_at_utc.localeCompare(b.starts_at_utc));
 const filteredEmployees=locationFilter?employees.filter(e=>employeeLocations.some(a=>a.employee_id===e.id&&a.location_id===locationFilter)):employees;
 async function action(fn:()=>Promise<unknown>,done:string){
  setBusy(true);setError('');setSuccess('');
  try{await fn();setSuccess(done);await reload();return true}
  catch(e){setError((e as Error).message);return false}
  finally{setBusy(false)}
 }
 const base='/organisations/'+org.id;
 return <div className="app"><aside className="sidebar"><Brand/><div className="workspace"><div className="workspace-icon">{org.name.charAt(0).toUpperCase()}</div><div><strong>{org.name}</strong><small>{org.role}</small></div></div>{organisations.length>1&&<select className="org-picker" aria-label="Switch organisation" value={org.id} onChange={e=>go(appPath(e.target.value,'Overview'))}>{organisations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select>}<div className="nav-label">LOCATIONS</div><select className="org-picker" aria-label="Filter workspace by location" value={locationFilter} onChange={e=>changeLocation(e.target.value)}><option value="">All locations</option>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select><div className="nav-label">WORKSPACE</div><nav>{nav.filter(item=>item.name!=='Access'||canAdminister).map(({name,icon:Icon})=><a key={name} href={navPath(name)} aria-label={name} aria-current={page===name?'page':undefined} className={'nav-item '+(page===name?'selected':'')} onClick={event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();setError('');setSuccess('');go(navPath(name));}}><Icon size={19}/><span>{name}</span></a>)}</nav><div className="sidebar-bottom"><div className="sidebar-callout"><ShieldCheck size={23}/><strong>Your data, your organisation.</strong><span>All workspace requests are checked on the server.</span></div><a className="workspace-profile" href="/profile"><span className="profile-icon">{user.name.charAt(0).toUpperCase()}</span><span>{user.name}<small>Personal profile</small></span></a><button className="profile" onClick={onLogout} aria-label="Sign out"><span><strong>Sign out</strong></span><LogOut size={18}/></button></div></aside>
 <div className="main"><header className="topbar"><div className="breadcrumb"><span>{org.name}</span><b>/</b><strong>{page}</strong></div><div className="top-right"><select className="top-location-picker" aria-label="Filter by location" value={locationFilter} onChange={e=>changeLocation(e.target.value)}><option value="">All locations</option>{locations.map(l=><option value={l.id} key={l.id}>{l.name}</option>)}</select><span className="role-tag">{org.role}</span><a className="mobile-profile" href="/profile" aria-label="Personal profile"><UserRound size={18}/></a><button className="mobile-sign-out" aria-label="Sign out" onClick={onLogout}><LogOut size={18}/></button></div></header>
 <main className="page"><div className="overline">SHIFTLEDGER / {page.toUpperCase()}</div><div className="page-heading"><div><h1>{page==='Overview'?'Your workforce, organised.':page}</h1><p>{page==='Overview'?'Your live organisation overview.':'Manage '+page.toLowerCase()+' for '+org.name+'.'}</p></div><button className="btn outline" onClick={()=>void reload()} disabled={loading}><RefreshCcw size={17}/> Refresh</button></div>
 {(error||logoutError)&&<Alert message={error||logoutError}/>}
 {success&&<Alert message={success} kind="success"/>}
 {loading?<p role="status">Loading workspace data…</p>:loadFailed?null:
 locationFilter&&!locations.some(l=>l.id===locationFilter)?<Alert message="This location is unavailable or you do not have access."/>:<>
 {page==='Overview'&&<><div className="hero-strip"><div><span>YOUR ORGANISATION</span><h2>{org.name}</h2><p>{org.country_code} · {org.time_zone} · {org.currency_code}</p></div><span className="hero-role">{locationFilter?locations.find(l=>l.id===locationFilter)?.name||'BRANCH':org.role.toUpperCase()}</span></div><div className="stats"><Stat title="Team members" value={canManage?filteredEmployees.length:'—'} note={locationFilter?'Assigned to selected branch':'Organisation directory records'}/><Stat title="Locations" value={locationFilter?1:locations.length} note={locationFilter?'Selected branch':'Operating sites'}/><Stat title="Recent shift records" value={canManage?filteredShifts.length:'—'} note="Up to 200 latest records"/><Stat title="Published in recent records" value={canManage?filteredShifts.filter(s=>s.status==='published').length:'—'} note="Based on the same records"/></div><div className="two-col"><section className="panel"><div className="panel-title"><h2>Upcoming shifts</h2><span>From your live database</span></div>{upcomingShifts.length? <div className="records">{upcomingShifts.slice(0,6).map(s=><div className="record" key={s.id}><CalendarDays size={19}/><div><strong>{formatShiftTime(s.starts_at_utc,s.time_zone,org.time_format)}</strong><small>{s.status} · {s.location_name}</small></div></div>)}</div>:<Empty icon={<CalendarDays size={32}/>} heading="No upcoming shifts" description="Upcoming shifts for this workspace appear here."/>}</section><section className="panel"><div className="panel-title"><h2>Getting started</h2><span>Organisation setup</span></div><div className="steps"><div><b>01</b><span><strong>Organisation created</strong><small>Your workspace is ready.</small></span><CheckCircle2 size={18}/></div><div><b>02</b><span><strong>Add locations</strong><small>Set up the places you operate.</small></span></div><div><b>03</b><span><strong>Add your team</strong><small>Create employee directory records.</small></span></div><div><b>04</b><span><strong>Plan shifts</strong><small>Draft a schedule for your team.</small></span></div></div></section></div></>}
 {page==='Settings'&&<OrganisationSettings org={org} onSave={onOrganisationChange}/>}
 {page==='Access'&&(canAdminister?<Invitations org={org} locations={locations} employees={employees}/>:<Alert message="Only owners and administrators can manage access."/>)}
 {page==='Locations'&&<Locations key={resourceId??'directory'} org={org} resourceId={resourceId} locations={locations} onLocationsChanged={reload}/>}
 {page==='Team'&&<div className="two-col"><section className="panel"><div className="panel-title"><h2>Employee directory</h2><span>{filteredEmployees.length} records</span></div>{filteredEmployees.length?<div className="records">{filteredEmployees.map(e=><div className="record" key={e.id}><UsersRound size={20}/><div className="employee-row"><strong>{e.display_name}</strong><small>{e.employment_status} · {employeeLocations.filter(x=>x.employee_id===e.id).map(x=>locations.find(l=>l.id===x.location_id)?.name).filter(Boolean).join(', ')||'No location assigned'}</small>{['owner','admin'].includes(org.role)&&<><div className="assignment-actions">{employeeLocations.filter(a=>a.employee_id===e.id).map(a=>{
  const location=locations.find(l=>l.id===a.location_id);
  return location&&<button type="button" className="btn outline" key={location.id} disabled={busy} onClick={()=>void action(()=>write(base+'/employee-locations/'+e.id+'/'+location.id,{},'DELETE'),'Location assignment removed.')}>Remove {location.name}</button>;
 })}</div><select aria-label={'Assign location to '+e.display_name} value="" disabled={busy||!locations.length} onChange={event=>{const locationId=event.target.value;if(locationId)void action(()=>post(base+'/employee-locations',{employeeId:e.id,locationId}),'Location assigned to employee.')}}><option value="">Assign to a location…</option>{locations.filter(l=>!employeeLocations.some(x=>x.employee_id===e.id&&x.location_id===l.id)).map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></>}</div></div>)}</div>:<Empty icon={<UsersRound size={33}/>} heading="No employees yet" description="Create your first employee directory record."/>}</section>{['owner','admin'].includes(org.role)&&<section className="panel"><div className="panel-title"><h2>Add employee</h2></div><form className="form-stack pad" onSubmit={e=>{e.preventDefault();void action(()=>post(base+'/employees',{name:employeeName,locationId:locationFilter}),'Employee added'+(locationFilter?' to the selected location.':'.')).then(ok=>{if(ok)setEmployeeName('')})}}><Field label="Full name"><input required minLength={2} value={employeeName} onChange={e=>setEmployeeName(e.target.value)}/></Field><div className="form-hint">One employee record can be assigned to several branches. Use Access to invite them to sign in.</div><button disabled={busy} className="btn primary"><Plus size={17}/> Add employee</button></form></section>}</div>}
 {page==='Schedule'&&<Rota org={org} locations={locations} employees={employees} assignments={employeeLocations} locationFilter={locationFilter} resourceId={resourceId} openShifts={openShifts}/>}
 {page==='Leave'&&<Leave org={org} locations={locations} employees={employees} assignments={employeeLocations} locationFilter={locationFilter} resourceId={resourceId}/>}
 {(['Timesheets','Shift swaps','Reports'] as Page[]).includes(page)&&<section className="panel"><div className="panel-title"><h2>{page} module</h2><span>Not enabled</span></div><Empty icon={<ShieldCheck size={33}/>} heading="Not yet available" description="This module will not accept or simulate employee data until its API, permissions and approval flow are implemented."/></section>}
 </>}
 <footer>© ShiftLedger · Real organisation data · No simulated statistics</footer></main></div></div>;
}
function App(){
 const route=useRoute();
 const verificationToken=route.searchParams.get('verify');
 const workspace=parseWorkspace(route.pathname);
 const inviteToken=route.pathname==='/join'?route.searchParams.get('token'):null;
 const [user,setUser]=useState<User|null>(null),[orgs,setOrgs]=useState<Org[]|null>(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[logoutError,setLogoutError]=useState('');
 async function refresh(){
  setLoading(true);setError('');
  try {
   const account=await api<{user:User}>('/auth/me');
   setUser(account.user);
   const result=await api<{organisations:Org[]}>('/organisations');
   setOrgs(result.organisations);
  }catch(reason){
   if(reason instanceof ApiError&&reason.status===401){
    setUser(null);setOrgs(null);
    const requested=window.location.pathname+window.location.search;
    if(parseWorkspace(window.location.pathname)||['/join','/profile'].includes(window.location.pathname))go('/sign-in?next='+encodeURIComponent(requested),true);
   }else{
    setError('Could not load your workspace. '+(reason as Error).message);
   }
  }finally{setLoading(false)}
 }
 useEffect(()=>{if(!verificationToken)void refresh()},[verificationToken]);
 useEffect(()=>{
  if(loading||error||!user||!orgs||verificationToken||route.searchParams.has('reset'))return;
  if(route.pathname==='/'||['/sign-in','/register','/check-email','/forgot-password'].includes(route.pathname)){
   const next=signInDestination(route.search);
   go(next||(orgs.length?appPath(orgs[0].id,'Overview'):'/onboarding'),true);
  }
 },[loading,error,user,orgs,verificationToken,route.href]);
 async function logout(){
  try{
   await post('/auth/logout',{});
   setUser(null);setOrgs(null);setLogoutError('');go('/sign-in',true);
  }catch(reason){setLogoutError('Could not sign out. '+(reason as Error).message)}
 }
 if(verificationToken)return <VerificationPage key={verificationToken} token={verificationToken}/>;
 if(route.pathname==='/preview/email-verified')return <VerificationPreview failed={false}/>;
 if(route.pathname==='/preview/email-verification-failed')return <VerificationPreview failed={true}/>;
 if(loading)return <div className="loading"><Brand/><p role="status">Connecting to your workspace…</p></div>;
 if(error)return <div className="loading"><Brand/><Alert message={error}/><button className="btn primary" onClick={()=>void refresh()}>Retry</button>{user&&<button className="btn outline" onClick={()=>void logout()}>Sign out</button>}{logoutError&&<Alert message={logoutError}/>}</div>;
 if(inviteToken&&user)return <JoinInvitation token={inviteToken} email={user.email}
  onJoin={id=>{go(appPath(id,'Overview'),true);void refresh()}}
  onSwitch={async()=>{await post('/auth/logout',{});setUser(null);setOrgs(null);go('/sign-in?next='+encodeURIComponent(route.pathname+route.search),true)}}/>;
 if(!user||route.searchParams.has('reset'))return <Auth onSuccess={()=>void refresh()}/>;
 if(route.pathname==='/profile')return <Profile user={user} onSave={setUser} workspace={orgs?.[0]?appPath(orgs[0].id,'Overview'):'/onboarding'}/>;
 if(route.pathname==='/onboarding'&&!orgs?.length)return <Onboard refresh={()=>{go('/',true);void refresh()}}/>;
 if(!workspace&&['/','/sign-in','/register','/check-email','/forgot-password'].includes(route.pathname))return <div className="loading"><Brand/><p role="status">Opening your workspace…</p></div>;
 const org=orgs?.find(item=>item.id===workspace?.organisationId);
 if(!org||!workspace)return <div className="loading"><Brand/><h1>Workspace page unavailable</h1><p>The page does not exist or you do not have access.</p><a className="btn primary" href={orgs?.[0]?appPath(orgs[0].id,'Overview'):'/onboarding'}>Open your workspace</a><button className="btn outline" onClick={()=>void logout()}>Sign out</button>{logoutError&&<Alert message={logoutError}/>}</div>;
 return <Dashboard key={org.id} user={user} org={org} organisations={orgs??[]} page={workspace.page} resourceId={workspace.resourceId} onOrganisationChange={updated=>setOrgs(items=>items?.map(item=>item.id===updated.id?updated:item)??null)} locationFilter={route.searchParams.get('location')||''} onLogout={()=>void logout()} logoutError={logoutError}/>;
}
export default App;
