import { useState } from 'react';
import { LayoutDashboard, CalendarDays, UsersRound, Clock3, CalendarCheck2, ArrowLeftRight, BarChart3, Settings2, Plus, Search, Bell, ChevronDown, ArrowUpRight, ShieldCheck } from 'lucide-react';

const navigation = [
  { name: 'Overview', icon: LayoutDashboard },
  { name: 'Schedule', icon: CalendarDays },
  { name: 'Team', icon: UsersRound },
  { name: 'Timesheets', icon: Clock3 },
  { name: 'Leave', icon: CalendarCheck2 },
  { name: 'Shift swaps', icon: ArrowLeftRight },
  { name: 'Reports', icon: BarChart3 },
  { name: 'Settings', icon: Settings2 },
];

const stats = [
  { label: 'Scheduled shifts', value: '—', detail: 'Connect an organisation to see schedules' },
  { label: 'Team members', value: '—', detail: 'No organisation configured' },
  { label: 'Hours this week', value: '—', detail: 'Time tracking not configured' },
  { label: 'Pending requests', value: '—', detail: 'Approvals not configured' },
];

function App() {
  const [active, setActive] = useState('Overview');
  const [search, setSearch] = useState('');
  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><CalendarCheck2 size={23}/></div><span>Shift<span className="brand-accent">Ledger</span></span></div>
      <div className="workspace"><div className="workspace-icon">S</div><div className="workspace-copy"><strong>My workspace</strong><small>Setup required</small></div><ChevronDown size={16}/></div>
      <div className="nav-label">WORKSPACE</div>
      <nav>{navigation.map(({name,icon: Icon}) => <button className={active===name?'nav-item selected':'nav-item'} key={name} onClick={()=>setActive(name)}><Icon size={19}/><span>{name}</span></button>)}</nav>
      <div className="sidebar-footer"><div className="help-box"><ShieldCheck size={20}/><strong>Built for teams</strong><p>Keep schedules, people and hours in one secure workspace.</p></div><div className="account"><div className="avatar">SL</div><div><strong>Workspace preview</strong><small>Not signed in</small></div></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{active}</strong></div><div className="top-actions"><div className="search"><Search size={17}/><input aria-label="Search" placeholder="Search workspace" value={search} onChange={e=>setSearch(e.target.value)}/></div><button className="icon-button" aria-label="Notifications" title="Notifications will be available after setup"><Bell size={19}/></button><div className="header-avatar">SL</div></div></header>
      <div className="page">
        <div className="eyebrow">SHIFTLEDGER / WORKSPACE</div>
        <div className="heading"><div><h1>{active==='Overview'?'Good morning.':active}</h1><p>{active==='Overview'?'Everything your team needs, in one place.':'This module will become available as we implement the backend.'}</p></div><button className="primary-button" disabled title="Available after organisation setup"><Plus size={18}/> Create shift</button></div>
        <div className="notice"><span className="notice-dot"/><div><strong>Early development preview</strong><p>This is the real application shell, but live workforce data and authentication are not connected. No statistics are fabricated.</p></div></div>
        {active==='Overview'? <><div className="stat-grid">{stats.map(s=><section className="stat-card" key={s.label}><div className="stat-heading">{s.label}<ArrowUpRight size={16}/></div><div className="stat-value">{s.value}</div><p>{s.detail}</p></section>)}</div><div className="content-grid"><section className="panel"><div className="panel-heading"><div><h2>Upcoming shifts</h2><p>Your team's upcoming schedule will appear here.</p></div><span className="quiet-tag">This week</span></div><div className="empty"><CalendarDays size={31}/><h3>No shifts yet</h3><p>Create an organisation and add staff before publishing your first rota.</p></div></section><section className="panel"><div className="panel-heading"><div><h2>Getting started</h2><p>Set up ShiftLedger in the right order.</p></div></div><ol className="steps"><li><span>1</span><div><strong>Create your organisation</strong><p>Choose a name, time zone and country.</p></div></li><li><span>2</span><div><strong>Add locations and team members</strong><p>Invite managers and employees.</p></div></li><li><span>3</span><div><strong>Publish your first schedule</strong><p>Assign shifts and notify your team.</p></div></li></ol></section></div></> : <section className="panel module-placeholder"><div className="empty"><Settings2 size={31}/><h3>{active} is on the roadmap</h3><p>We're building authenticated organisation setup first so this module uses real, isolated data.</p></div></section>}
        <footer className="footer">ShiftLedger · Foundation release · Preview only</footer>
      </div>
    </main>
  </div>;
}
export default App;
