import { useState, type MouseEvent } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock3, Copy, Layers3, MapPin, MoreHorizontal, Plus, ShieldCheck, UsersRound, X, Zap } from 'lucide-react';
import { appPath, go, useRoute } from './routes';
import { formatShiftClock, rotaMonth, rotaWeek, rotaDay } from './time';
import type { Org, Location } from './Locations';
import type { Shift } from './Rota';
import './ScheduleCalendar.css';

type CalendarView = 'month' | 'week' | 'day' | 'team';
type Day = Omit<ReturnType<typeof rotaDay>, 'previous' | 'next'>;
type Props = {
  org: Org; locations: Location[]; locationFilter: string;
  employees: {id: string; display_name: string; employment_status: string}[];
  assignments: {employee_id: string; location_id: string}[];
  shifts: Shift[]; view: CalendarView;
  days: Day[]; month: ReturnType<typeof rotaMonth>; week: ReturnType<typeof rotaWeek>;
  period: {previous:string; next:string}; date: string; zone: string; coverage: boolean;
  manage: boolean; root: string; openShifts: boolean;
  href: (id?:string,targetView?:CalendarView,targetDate?:string,cursor?:string,onlyCoverage?:boolean)=>string;
  nextCursor: string | null; cursor: string | null;
};

function dateShift(shift: Shift) { return shift.status !== 'cancelled'; }
function vacancy(shift: Shift) { return Boolean(shift.is_open && shift.status === 'published'); }
function label(shift: Shift) { return vacancy(shift) ? 'Open shift' : shift.employee_name || 'Unassigned'; }
function initials(name: string) { return name.split(/\s+/).slice(0,2).map(word=>word[0] || '').join('').toUpperCase(); }
function dayOffset(month: string, offset: number) {
  const day = new Date(month + '-01T12:00:00.000Z');
  day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0,10);
}
function periodMinutes(shift: Shift) {
  return Math.max(0,Math.round((Date.parse(shift.ends_at_utc)-Date.parse(shift.starts_at_utc))/60000)-shift.unpaid_break_minutes);
}

export function ScheduleCalendar({ org, locations, locationFilter, employees, assignments, shifts, view, days, month, week, period, date, zone, coverage, manage, root, openShifts, href, cursor, nextCursor }: Props) {
  const route = useRoute();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const filtered = shifts.filter(dateShift);
  const selectedRequested = route.searchParams.get('selected');
  const selectedDate = selectedRequested && /^\d{4}-\d{2}-\d{2}$/.test(selectedRequested) ? selectedRequested
    : days.some(d=>d.date===month.today) ? month.today : days[0].date;
  const visibleDay = rotaDay(selectedDate,zone);
  const selectedWeekStart = rotaWeek(selectedDate,zone,org.week_start).start;
  const selectedShifts = filtered.filter(s=>s.starts_at_utc < visibleDay.to && s.ends_at_utc > visibleDay.from)
    .sort((a,b)=>a.starts_at_utc.localeCompare(b.starts_at_utc));
  const inspectId = route.searchParams.get('inspect');
  const selectedShift = selectedShifts.find(s=>s.id===inspectId) || selectedShifts[0] || null;
  const selectionHref = (day:string,shiftId?:string) => {
    const url = new URL(href(), 'https://shiftledger.invalid');
    url.searchParams.set('selected',day);
    if(shiftId)url.searchParams.set('inspect',shiftId);
    else url.searchParams.delete('inspect');
    return url.pathname + url.search;
  };
  const adjacentDayHref = (target:string) => days.some(d=>d.date===target) ? selectionHref(target) : href(undefined,'day',target);
  const selectedDayHref = (shift:Shift) => {
    const calendarDay = days.find(d=>shift.starts_at_utc < d.to && shift.ends_at_utc > d.from);
    return selectionHref(calendarDay?.date || selectedDate,shift.id);
  };
  const visibleTeam = employees.filter(e=>e.employment_status==='active'&&(!locationFilter||assignments.some(a=>a.employee_id===e.id&&a.location_id===locationFilter))).length;
  const published = filtered.filter(s=>s.status==='published');
  const staffed = published.filter(s=>s.employee_id!==null).length;
  const coverageLabel = published.length ? Math.round(100*staffed/published.length)+'%' : '—';
  const activeHours = (filtered.reduce((sum,s)=>sum+periodMinutes(s),0)/60);
  const hoursLabel = Number.isInteger(activeHours) ? String(activeHours) : activeHours.toFixed(1);
  const monthLabel = view==='month' || view==='team' ? month.label : view==='week' ? 'Week of '+days[0].label : visibleDay.label;
  const daySlots = view==='month' ? [
    ...Array.from({length:month.leading},(_,i)=>({date:dayOffset(month.month,i-month.leading), inPeriod:false})),
    ...days.map(d=>({date:d.date,inPeriod:true})),
    ...Array.from({length:month.trailing},(_,i)=>({date:dayOffset(month.month,month.days.length+i),inPeriod:false}))
  ] : days.map(d=>({date:d.date,inPeriod:true}));
  const shiftLink = (day:string, id:string) => selectionHref(day,id);
  const addHref = (day:string,open=false) => {
    const url = new URL(href('new',view,date), 'https://shiftledger.invalid');
    url.searchParams.set('selected',day);
    if(open) url.searchParams.set('open','1');
    return url.pathname + url.search;
  };
  const clientNavigate = (event:MouseEvent<HTMLAnchorElement>) => {
    if(event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    go(event.currentTarget.getAttribute('href') || href());
  };
  return <section className="slc" aria-label="Schedule calendar">
    <header className="slc-hero">
      <div className="slc-hero-title">
        <span className="slc-eyebrow">SCHEDULE HUB</span>
        <div className="slc-date-heading"><h1>{monthLabel}</h1><button type="button" className="slc-title-chevron" aria-label="Choose calendar month" aria-expanded={showPicker} onClick={()=>setShowPicker(v=>!v)}><ChevronDown size={22}/></button></div>
        {showPicker&&<div className="slc-month-picker"><label>Go to month <input type="month" defaultValue={month.month} onChange={e=>{if(e.target.value)go(href(undefined,'month',e.target.value));}}/></label></div>}
        <p><MapPin size={15}/>{locationFilter?locations.find(l=>l.id===locationFilter)?.name||'Location':'All locations'}<span className="slc-separator">|</span> {view==='month'?'Full team calendar':view==='week'?'Weekly team calendar':view==='team'?'Team schedule by person':'Day schedule'}</p>
      </div>
      <div className="slc-kpis" aria-label="Schedule statistics for visible dates">
        <div className="slc-kpi"><UsersRound size={21}/><strong>{filtered.length}</strong><span>Shift records</span></div>
        <div className="slc-kpi"><CheckCircle2 size={21}/><strong>{coverageLabel}</strong><span>Published coverage</span></div>
        <div className="slc-kpi"><Clock3 size={21}/><strong>{hoursLabel}h</strong><span>Planned hours</span></div>
        <div className="slc-kpi"><UsersRound size={21}/><strong>{visibleTeam}</strong><span>Team members</span></div>
      </div>
      <nav className="slc-view-toggle" aria-label="Calendar view">
        <a href={href(undefined,'month',month.month)} aria-current={view==='month'?'page':undefined} className={view==='month'?'active':''}>Month</a>
        <a href={href(undefined,'week',selectedWeekStart)} aria-current={view==='week'?'page':undefined} className={view==='week'?'active':''}>Week</a>
        <a href={href(undefined,'team',month.month)} aria-current={view==='team'?'page':undefined} className={view==='team'?'active':''}>Team</a>
      </nav>
    </header>
    <div className="slc-toolbar">
      <div className="slc-toolbar-group">
        <a className="slc-tool" href={href(undefined,view,period.previous)} aria-label={'Previous '+view}><ChevronLeft size={19}/> Previous</a>
        <a className="slc-tool" href={href(undefined,view,view==='month'||view==='team'?month.today.slice(0,7):month.today)}>Today</a>
        <a className="slc-tool" href={href(undefined,view,period.next)} aria-label={'Next '+view}>Next <ChevronRight size={19}/></a>
      </div>
      <div className="slc-toolbar-group slc-toolbar-actions">
        {manage&&<a className="slc-tool" href={href('templates')} aria-label="Shift templates"><Layers3 size={17}/> Templates</a>}
        {manage&&<a className="slc-tool" href={href('bulk','week',selectedWeekStart)}><Copy size={17}/> Copy week</a>}
        {manage&&<a className={'slc-tool '+(coverage?'selected':'')} href={href(undefined,view,date,undefined,!coverage)} aria-label="Needs cover"><ShieldCheck size={17}/> {coverage?'All shifts':'Needs cover'}</a>}
        {manage&&<div className="slc-add-container">
          <button type="button" className="slc-add-main" onClick={()=>setMenuOpen(v=>!v)} aria-expanded={menuOpen} aria-controls="slc-add-menu"><Plus size={20}/> Add shift <ChevronDown size={16}/></button>
          {menuOpen&&<div className="slc-add-menu" id="slc-add-menu">
            <a href={addHref(selectedDate)} onClick={clientNavigate}>Add assigned shift</a>
            {openShifts&&<a href={addHref(selectedDate,true)} onClick={clientNavigate}>Add open shift</a>}
            <a href={appPath(org.id,'Team')}>Add employee</a>
            <a href={appPath(org.id,'Setup')+'?step=3'}>Add job position</a>
          </div>}
        </div>}
      </div>
    </div>
    {coverage&&<div className="slc-filter-note"><Zap size={16}/> Showing published open shifts and leave-related coverage conflicts. <a href={href(undefined,view,date,undefined,false)}>Clear filter</a></div>}
    <div className="slc-workspace">
      <div className="slc-calendar" role="region" aria-label={monthLabel+' calendar'}>
        {view==='team' ? <div className="slc-team-list">
          <div className="slc-team-intro"><div><strong>Team schedule</strong><span>People and their shifts for {month.label.toLowerCase()}.</span></div><a href={appPath(org.id,'Team')}>Manage team <ArrowRight size={15}/></a></div>
          {employees.filter(e=>e.employment_status==='active'&&(!locationFilter||assignments.some(a=>a.employee_id===e.id&&a.location_id===locationFilter))).map(employee=>{
            const personal = filtered.filter(shift=>shift.employee_id===employee.id).sort((a,b)=>a.starts_at_utc.localeCompare(b.starts_at_utc));
            return <div className="slc-team-row" key={employee.id}>
              <div className="slc-team-identity"><span className="slc-avatar large">{initials(employee.display_name)}</span><div><strong>{employee.display_name}</strong><small>{personal.length} shifts · {(personal.reduce((t,s)=>t+periodMinutes(s),0)/60).toFixed(1)} planned hours</small></div></div>
              <div className="slc-team-shifts">{personal.length?personal.slice(0,7).map(s=><a key={s.id} href={selectedDayHref(s)}>{new Intl.DateTimeFormat(undefined,{day:'numeric',month:'short',timeZone:s.time_zone}).format(new Date(s.starts_at_utc))}<span>{formatShiftClock(s.starts_at_utc,s.time_zone,org.time_format)}</span>{s.status==='draft'&&<em>Unpublished</em>}</a>):<span className="slc-team-none">No shifts this month</span>}
                {personal.length>7&&<span className="slc-team-none">+{personal.length-7} more shifts</span>}
              </div>
            </div>;
          })}
          {visibleTeam===0&&<div className="slc-team-none">No active staff assigned to this location. Add team members to see their schedules.</div>}
          {filtered.some(vacancy)&&<div className="slc-team-row slc-open-row"><div className="slc-team-identity"><span className="slc-avatar large">+</span><div><strong>Open shifts</strong><small>Published vacancies awaiting an assignee</small></div></div>
            <div className="slc-team-shifts">{filtered.filter(vacancy).map(s=><a key={s.id} href={selectedDayHref(s)}>{new Intl.DateTimeFormat(undefined,{day:'numeric',month:'short',timeZone:s.time_zone}).format(new Date(s.starts_at_utc))}<span>{formatShiftClock(s.starts_at_utc,s.time_zone,org.time_format)}</span></a>)}</div></div>}
        </div> : <div className={'slc-grid slc-grid-'+view}>
          {view==='month'&&month.weekdays.map((w,i)=><div key={'w'+i} className="slc-weekday">{w}</div>)}
          {daySlots.map(slot=>{
            const activeDay=slot.inPeriod ? days.find(d=>d.date===slot.date) : null;
            const slotDay=activeDay || rotaDay(slot.date,zone);
            const matches=slot.inPeriod?filtered.filter(s=>s.starts_at_utc < slotDay.to && s.ends_at_utc > slotDay.from):[];
            const shown=view==='day'?matches:matches.slice(0,view==='month'?3:8);
            const selected=slot.date===selectedDate;
            return <div className={'slc-day'+(!slot.inPeriod?' outside':'')+(selected?' selected':'')+(slot.date===month.today?' today':'')} key={slot.date}>
              <div className="slc-day-top"><a href={selectionHref(slot.date)} aria-label={'Select '+slotDay.label} aria-current={selected?'date':undefined}>{view==='month'?Number(slot.date.slice(-2)):slotDay.label}</a>
                {manage&&slot.inPeriod&&<a className="slc-cell-add" aria-label={'Add shift on '+slotDay.label} title="Add shift" href={addHref(slot.date)} onClick={clientNavigate}><Plus size={15}/></a>}
              </div>
              <div className="slc-shift-stack">{shown.map(s=><a key={s.id} href={shiftLink(slot.date,s.id)}
                className={'slc-shift '+(vacancy(s)?'open':s.status)+(s.id===selectedShift?.id&&selected?' current':'')}
                aria-label={label(s)+' '+formatShiftClock(s.starts_at_utc,s.time_zone,org.time_format)+' '+s.status}>
                <span className="slc-avatar" aria-hidden="true">{vacancy(s)?'+':initials(label(s))}</span>
                <span className="slc-shift-time">{formatShiftClock(s.starts_at_utc,s.time_zone,org.time_format)}–{formatShiftClock(s.ends_at_utc,s.time_zone,org.time_format)}</span>
                {s.is_open===1&&s.status==='published'?<span className="slc-position-pill">Open</span>:s.status==='draft'?<span className="slc-position-pill draft">Unpublished</span>:<span className="slc-position-pill assigned">Assigned</span>}
              </a>)}</div>
              {matches.length>shown.length&&<a href={selectionHref(slot.date)} className="slc-more">+{matches.length-shown.length} more</a>}
              {view==='month'&&matches.length===0&&slot.inPeriod&&selected&&<span className="slc-empty-selected">No shifts</span>}
            </div>;
          })}
        </div>}
      </div>
      <aside className="slc-inspector" aria-label="Selected date and shift details">
        <div className="slc-inspector-header">
          <button className="slc-inspector-arrow" type="button" onClick={()=>go(adjacentDayHref(rotaDay(selectedDate,zone).previous))} aria-label="Previous day"><ChevronLeft size={19}/></button>
          <h2>{new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(selectedDate+'T12:00:00Z'))}</h2>
          <button className="slc-inspector-arrow" type="button" onClick={()=>go(adjacentDayHref(rotaDay(selectedDate,zone).next))} aria-label="Next day"><ChevronRight size={19}/></button>
          <a href={href()} className="slc-inspector-close" aria-label="Reset selected day"><X size={19}/></a>
        </div>
        {selectedShift ? <div className="slc-inspector-card">
          <div className="slc-inspector-shift-head"><CalendarDays size={18}/><strong>{formatShiftClock(selectedShift.starts_at_utc,selectedShift.time_zone,org.time_format)} – {formatShiftClock(selectedShift.ends_at_utc,selectedShift.time_zone,org.time_format)}</strong><span className="slc-status">{selectedShift.status==='draft'?'Unpublished':selectedShift.status}</span></div>
          <div className="slc-inspector-person"><span className="slc-avatar large">{vacancy(selectedShift)?'+':initials(label(selectedShift))}</span><div><strong>{label(selectedShift)}</strong><small>{selectedShift.location_name}</small></div><CheckCircle2 size={17}/></div>
          <dl className="slc-inspector-fields">
            <div><dt><MapPin size={16}/> Location</dt><dd>{selectedShift.location_name}</dd></div>
            <div><dt><Clock3 size={16}/> Break</dt><dd>{selectedShift.unpaid_break_minutes} minutes unpaid</dd></div>
            <div><dt><UsersRound size={16}/> Assignment</dt><dd>{vacancy(selectedShift)?'Available to claim':selectedShift.employee_name||'Not assigned'}</dd></div>
            {selectedShift.leave_conflict? <div><dt>Coverage</dt><dd>Approved leave conflict</dd></div> : null}
          </dl>
          <div className="slc-inspector-buttons">
            <a className="slc-edit" href={href(selectedShift.id)}>Edit / details <ArrowRight size={16}/></a>
            {manage&&<a className="slc-icon-button" href={href('new')+'&copy='+encodeURIComponent(selectedShift.id)} aria-label="Duplicate shift"><Copy size={18}/></a>}
          </div>
        </div> : <div className="slc-inspector-empty"><CalendarDays size={34}/><strong>No shifts on this day</strong><span>Select another date or add a shift.</span>{manage&&<a className="slc-edit" href={addHref(selectedDate)} onClick={clientNavigate}>Add a shift <Plus size={15}/></a>}</div>}
        {selectedShifts.length>1&&<div className="slc-inspector-others"><h3>Other shifts on this day ({selectedShifts.length-1})</h3>{selectedShifts.filter(s=>s.id!==selectedShift?.id).map(s=><a key={s.id} href={selectedDayHref(s)}><span className="slc-avatar">{initials(label(s))}</span><span><strong>{formatShiftClock(s.starts_at_utc,s.time_zone,org.time_format)} – {formatShiftClock(s.ends_at_utc,s.time_zone,org.time_format)}</strong><small>{label(s)}</small></span><ChevronRight size={17}/></a>)}</div>}
        {manage&&<a className="slc-inspector-add" href={addHref(selectedDate)} onClick={clientNavigate}><Plus size={17}/> Add shift on this day</a>}
      </aside>
    </div>
    {(cursor||nextCursor)&&<div className="slc-pagination">{cursor&&<a href={href()}>First page</a>}{nextCursor&&<a href={href(undefined,'week',week.start,nextCursor)}>More shifts</a>}</div>}
    <div className="slc-footer">ShiftLedger · Calendar reflects actual organisation scheduling records</div>
  </section>;
}
