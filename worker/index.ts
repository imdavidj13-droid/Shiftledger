import { Hono } from 'hono';
import { registerShifts } from './shifts';
import { registerShiftBatch } from './shift-batch';
import { registerLeave } from './leave';
import { registerTimekeeping } from './timekeeping';
import { registerSwaps } from './swaps';
import { registerStaff } from './staff';
import { registerShiftTemplates } from './shift-templates';
import { registerInvitations } from './invitations';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

import { audit, body, days, fail, isEmail, isoNow, orgAdmin, orgRoute, rnd, safeStr, sha, type ApiContext, type Bindings, type Env, type Role } from './http';
const app = new Hono<Env>({ strict: false });
async function derivePassword(password: string,salt: string) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const derived=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},key,256);
  return hex(new Uint8Array(derived));
}
const hex = (bytes: Uint8Array) => [...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');
function equalHash(actual: string, expected: string) {
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index++) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}
function validZone(zone: string) {
  if (!/^[A-Za-z][A-Za-z0-9_+/-]*$/.test(zone)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; }
}
const activeShift = "status IN ('draft','published')";
const upcomingShift = `SELECT 1 FROM shifts WHERE organisation_id=? AND location_id=? AND ${activeShift} AND ends_at_utc>?`;
function passValid(s: string) {return s.length>=12&&s.length<=128;}
function cookieOptions(c: ApiContext) {return {httpOnly:true,secure:new URL(c.req.url).protocol==='https:',sameSite:'Lax' as const,path:'/',maxAge:60*60*24*14};}
async function createSession(c: ApiContext, userId: string, passwordHash: string) {
  const token = rnd();
  const result = await c.env.DB.prepare(`INSERT INTO sessions(token_hash,user_id,expires_at)
    SELECT ?,id,? FROM users WHERE id=? AND password_hash=?`)
    .bind(await sha(token), days(14), userId, passwordHash).run();
  if (!result.meta.changes) return false;
  setCookie(c, 'sl_session', token, cookieOptions(c));
  return true;
}
async function currentUser(c: ApiContext):Promise<{id:string;display_name:string;email_normalized:string}|null>{
  const token=getCookie(c,'sl_session');if(!token||!/^([a-f0-9]{64})$/.test(token))return null;
  return await c.env.DB.prepare('SELECT users.id,users.display_name,users.email_normalized FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>? AND users.email_verified_at IS NOT NULL').bind(await sha(token),isoNow()).first<{id:string;display_name:string;email_normalized:string}>();
}
function testRecipientAllowed(env: Bindings, email: string) {
  // The shared Resend testing sender must never enable public signups.
  if (!env.MAIL_FROM?.toLowerCase().includes('onboarding@resend.dev')) return true;
  const permitted = env.TEST_REGISTRATION_EMAIL?.trim().toLowerCase();
  return Boolean(permitted && isEmail(permitted) && email === permitted);
}
function appBaseUrl(env: Bindings): string {
  if (!env.APP_URL) throw new Error('APP_URL is required for email links');
  return env.APP_URL.replace(/\/$/, '');
}
function mailReady(env: Bindings) {
  const senderReady = Boolean(env.APP_URL && env.MAIL_FROM && (env.EMAIL || env.RESEND_API_KEY));
  if (!senderReady) return false;
  if (env.MAIL_FROM?.toLowerCase().includes('onboarding@resend.dev')) {
    return Boolean(env.RESEND_API_KEY && env.TEST_REGISTRATION_EMAIL && isEmail(env.TEST_REGISTRATION_EMAIL.trim()));
  }
  return true;
}
async function sendMail(c: ApiContext,email:string,subject:string,text:string) {
  const from = c.env.MAIL_FROM;
  if(!from || !mailReady(c.env)) return false;
  // Primary: Cloudflare Email Sending binding, when attached to this Worker.
  if(c.env.EMAIL) {
    try {
      await c.env.EMAIL.send({to:email,from,subject,text});
      return true;
    } catch {
      console.error('Cloudflare Email Service failed', c.get('requestId'));
      // The optional fallback is intended for transient provider failures.
    }
  }
  if(!c.env.RESEND_API_KEY) return false;
  try {
    const result=await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{Authorization:'Bearer '+c.env.RESEND_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({from,to:[email],subject,text})
    });
    if(!result.ok) console.error('Email fallback returned HTTP',result.status);
    return result.ok;
  } catch {
    console.error('Email fallback request failed', c.get('requestId'));
    return false;
  }
}
async function tokenFor(c: ApiContext, userId: string, purpose: 'verify_email' | 'reset_password') {
  const raw = rnd();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM auth_tokens WHERE user_id=? AND purpose=?').bind(userId,purpose),
    c.env.DB.prepare('INSERT INTO auth_tokens(token_hash,user_id,purpose,expires_at) VALUES(?,?,?,?)')
      .bind(await sha(raw),userId,purpose,days(1))
  ]);
  return raw;
}
async function rateLimit(c: ApiContext, key: string, max = 7) {
  const now = isoNow();
  const row = await c.env.DB.prepare(`INSERT INTO auth_rate_limits(key_hash,attempts,window_end)
    VALUES (?1,1,?2) ON CONFLICT(key_hash) DO UPDATE SET
    attempts=CASE WHEN window_end<=?3 THEN 1 ELSE attempts+1 END,
    window_end=CASE WHEN window_end<=?3 THEN excluded.window_end ELSE window_end END
    WHERE window_end<=?3 OR attempts<?4 RETURNING attempts`)
    .bind(await sha(key),new Date(Date.now()+15*60000).toISOString(),now,max).first();
  return Boolean(row);
}
app.use('/api/*',async(c,next)=>{
  const requestId = crypto.randomUUID();
  c.set('requestId', requestId);
  c.header('X-Request-ID', requestId);
  c.header('Cache-Control','no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  const origin = c.req.header('Origin');
  const safeMethod = ['GET','HEAD','OPTIONS'].includes(c.req.method);
  if (!safeMethod && (c.req.header('Sec-Fetch-Site') === 'cross-site' ||
      (origin && origin !== new URL(c.req.url).origin))) {
    return fail(c,'Untrusted origin',403);
  }
  await next();
});
app.get('/api/health',c=>c.json({ok:true,service:'shiftledger',api:'v1'}));
app.get('/api/v1/health',c=>{
  const version = c.env.CF_VERSION_METADATA;
  const commit = version?.tag && /^[a-f0-9]{40}$/.test(version.tag) ? version.tag : null;
  return c.json({ok:true,service:'shiftledger',api:'v1',commit,versionId:version?.id || null});
});
app.get('/api/v1/ready',async c=>{
  try {
    await c.env.DB.prepare(`SELECT o.week_start, u.email_verified_at, shifts.revision
      FROM organisations o, users u, sessions, auth_tokens, auth_rate_limits,
      locations, employees, employee_locations, location_access, memberships, shifts, audit_events, invitations, invitation_locations LIMIT 0`).all();
    const tables = (await c.env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table'
      AND name IN ('shift_claims','leave_requests','time_entries','shift_swaps','employee_profiles','shift_templates')`).all<{name:string}>()).results;
    const names = new Set(tables.map(table=>table.name));
    return c.json({ok:true,features:{
      openShifts:names.has('shift_claims'),leave:names.has('leave_requests'),timekeeping:names.has('time_entries'),
      shiftSwaps:names.has('shift_swaps'),staffProfiles:names.has('employee_profiles'),shiftTemplates:names.has('shift_templates')
    }});
  } catch {
    console.error(JSON.stringify({event:'database_not_ready',requestId:c.get('requestId')}));
    return fail(c,'Database is temporarily unavailable or needs a migration.',503);
  }
});
app.post('/api/v1/auth/register',async c=>{
  // Fail with an actionable diagnostic if a deployment points to an unmigrated D1 DB.
  try {
    const required = ['users','auth_tokens','sessions','auth_rate_limits'];
    const rows = await c.env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','auth_tokens','sessions','auth_rate_limits')").all() as {results: {name:string}[]};
    if (required.some(name => !rows.results.some(row => row.name === name))) {
      console.error('Registration preflight failed: missing authentication tables');
      return fail(c,'Registration database is not ready. The administrator must apply the D1 migrations.',503);
    }
    const columns = await c.env.DB.prepare('PRAGMA table_info(users)').all() as {results: {name:string}[]};
    if (['password_hash','password_salt','email_verified_at'].some(name => !columns.results.some(row => row.name === name))) {
      console.error('Registration preflight failed: users schema missing authentication columns');
      return fail(c,'Registration database needs the authentication migration.',503);
    }
  } catch {
    console.error('Registration preflight database failure', c.get('requestId'));
    return fail(c,'Registration database is temporarily unavailable.',503);
  }
  if(!mailReady(c.env))return fail(c,'Email delivery has not been configured by the administrator.',503);
  const x=await body(c);if(!x)return fail(c,'Invalid JSON');
  const email=safeStr(x.email,254).toLowerCase(),password=x.password;
  if(!isEmail(email)||typeof password!=='string'||!passValid(password))return fail(c,'Enter a valid email and a password of 12–128 characters.',422);
  if(!testRecipientAllowed(c.env,email))return fail(c,'Registration is temporarily restricted to the configured development test account.',403);
  if(!await rateLimit(c,'register:'+email))return fail(c,'Too many attempts. Try again later.',429);
  const id=crypto.randomUUID(),salt=rnd(16),hash=await derivePassword(password,salt);
  const created = await c.env.DB.prepare(`INSERT INTO users(id,email_normalized,display_name,password_hash,password_salt)
    VALUES(?,?,?,?,?) ON CONFLICT(email_normalized) DO NOTHING`).bind(id,email,email,hash,salt).run();
  if (!created.meta.changes) return c.json({ok:true,message:'If registration is available for this email, instructions will be sent.'});
  const token=await tokenFor(c,id,'verify_email');
  const link=appBaseUrl(c.env)+'/?verify='+encodeURIComponent(token);
  const sent=await sendMail(c,email,'Verify your ShiftLedger email','Verify your account by visiting: '+link+'\nThis link expires in 24 hours.');
  if(!sent)return fail(c,'Account created, but email delivery failed. Contact support or retry verification.',503);
  return c.json({ok:true,message:'Check your email for a verification link.'},201);
});
app.post('/api/v1/auth/resend-verification',async c=>{
  if(!mailReady(c.env))return fail(c,'Email delivery is not configured.',503);
  const x=await body(c),email=safeStr(x?.email,254).toLowerCase();
  if(!isEmail(email))return fail(c,'Enter a valid email address',422);
  if(!testRecipientAllowed(c.env,email))return fail(c,'Verification email delivery is restricted during development.',403);
  const ip=c.req.header('CF-Connecting-IP')||'unknown';
  if(!await rateLimit(c,'resend:'+ip+':'+email,3))return fail(c,'Too many requests. Try again in 15 minutes.',429);
  const row=await c.env.DB.prepare('SELECT id,email_verified_at FROM users WHERE email_normalized=?').bind(email).first() as {id:string;email_verified_at:string|null}|null;
  if(row&&!row.email_verified_at){
    const token=await tokenFor(c,row.id,'verify_email');
    const link=appBaseUrl(c.env)+'/?verify='+encodeURIComponent(token);
    const sent=await sendMail(c,email,'Verify your ShiftLedger email','Verify your email using this link: '+link+'\nThis link expires in 24 hours.');
    if(!sent)return fail(c,'Could not deliver verification email. Please try again.',503);
  }
  return c.json({ok:true,message:'If this email needs verification, a new link has been sent.'});
});
app.post('/api/v1/auth/verify',async c=>{
  const x=await body(c);const token=safeStr(x?.token,128);
  if(!/^[a-f0-9]{64}$/.test(token))return fail(c,'Invalid verification token',422);
  const hash = await sha(token), now = isoNow();
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET email_verified_at=?
      WHERE id=(SELECT user_id FROM auth_tokens WHERE token_hash=? AND purpose='verify_email' AND expires_at>?)
      AND email_verified_at IS NULL`).bind(now,hash,now),
    c.env.DB.prepare("DELETE FROM auth_tokens WHERE token_hash=? AND purpose='verify_email'").bind(hash)
  ]);
  if (!results[0].meta.changes) return fail(c,'This verification link is invalid or expired.',400);
  return c.json({ok:true});
});
app.post('/api/v1/auth/login',async c=>{
  const x=await body(c);const email=safeStr(x?.email,254).toLowerCase(),password=x?.password;
  if(!isEmail(email)||typeof password!=='string'||password.length>128)return fail(c,'Invalid credentials',401);
  const ip=c.req.header('CF-Connecting-IP')||'unknown';
  if(!await rateLimit(c,'login-ip:'+ip,40)||!await rateLimit(c,'login-email:'+email,8))return fail(c,'Too many attempts. Try again later.',429);
  const row=await c.env.DB.prepare('SELECT id,password_hash,password_salt,email_verified_at FROM users WHERE email_normalized=?').bind(email).first<{id:string;password_hash:string|null;password_salt:string|null;email_verified_at:string|null}>();
  const salt=row?.password_salt||'invalid-salt';
  const actual=await derivePassword(password,salt);
  if(!row||!row.password_hash||!equalHash(actual,row.password_hash))return fail(c,'Invalid credentials',401);
  if(!row.email_verified_at)return fail(c,'Verify your email before signing in.',403);
  if (!await createSession(c,row.id,row.password_hash)) return fail(c,'Invalid credentials',401);
  return c.json({ok:true});
});
app.post('/api/v1/auth/logout',async c=>{
  const token=getCookie(c,'sl_session');if(token)await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha(token)).run();
  deleteCookie(c,'sl_session',cookieOptions(c));return c.json({ok:true});
});
app.get('/api/v1/auth/me',async c=>{
  const u=await currentUser(c);if(!u)return fail(c,'Sign in required',401);
  return c.json({user:{id:u.id,name:u.display_name,email:u.email_normalized}});
});
app.patch('/api/v1/auth/me', async c => {
  const user = await currentUser(c);
  if (!user) return fail(c,'Sign in required',401);
  const input = await body(c), name = safeStr(input?.name,101);
  if (name.length<2 || name.length>100 || /[\u0000-\u001f\u007f]/.test(name)) {
    return fail(c,'Enter a display name from 2 to 100 characters.',422);
  }
  await c.env.DB.prepare('UPDATE users SET display_name=? WHERE id=?').bind(name,user.id).run();
  return c.json({user:{id:user.id,name,email:user.email_normalized}});
});
app.post('/api/v1/auth/forgot-password',async c=>{
  const x=await body(c),email=safeStr(x?.email,254).toLowerCase();
  if(!isEmail(email))return fail(c,'Invalid email',422);
  if(!testRecipientAllowed(c.env,email))return c.json({ok:true,message:'If this email is registered, reset instructions will be sent.'});
  if(!await rateLimit(c,'reset:'+email,4))return fail(c,'Too many requests',429);
  const row=await c.env.DB.prepare('SELECT id FROM users WHERE email_normalized=?').bind(email).first() as {id:string}|null;
  if(row&&mailReady(c.env)){
    const token=await tokenFor(c,row.id,'reset_password');
    await sendMail(c,email,'Reset your ShiftLedger password','Reset your password: '+appBaseUrl(c.env)+'/?reset='+token);
  }
  return c.json({ok:true,message:'If this email is registered, reset instructions will be sent.'});
});
app.post('/api/v1/auth/reset-password',async c=>{
  const x=await body(c),token=safeStr(x?.token,128),password=x?.password;
  if(!/^[a-f0-9]{64}$/.test(token)||typeof password!=='string'||!passValid(password))return fail(c,'Invalid token or password',422);
  const hash=await sha(token);
  const eligible = "SELECT user_id FROM auth_tokens WHERE token_hash=? AND purpose='reset_password' AND expires_at>?";
  if (!await c.env.DB.prepare(eligible).bind(hash,isoNow()).first()) return fail(c,'Reset link invalid or expired',400);
  const salt=rnd(16),newHash=await derivePassword(password,salt),now=isoNow();
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET password_hash=?,password_salt=? WHERE id=(${eligible})`).bind(newHash,salt,hash,now),
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id=(${eligible})`).bind(hash,now),
    c.env.DB.prepare("DELETE FROM auth_tokens WHERE token_hash=? AND purpose='reset_password'").bind(hash)
  ]);
  if (!results[0].meta.changes) return fail(c,'Reset link invalid or expired',400);
  return c.json({ok:true});
});
app.use('/api/v1/organisations/*',async(c,next)=>{
  const u=await currentUser(c);if(!u)return fail(c,'Sign in required',401);
  c.set('userId',u.id);
  // Wildcard Hono middleware does not reliably expose :orgId as a named param.
  // Parse the organisation ID from the URL and require an active membership
  // before any nested organisation route is executed.
  const path=new URL(c.req.url).pathname;
  // Collection routes (/organisations and /organisations/) have no orgId.
  // They perform their own authentication and must not be treated as a member route.
  if(/^\/api\/v1\/organisations\/?$/.test(path))return next();
  const match=path.match(/^\/api\/v1\/organisations\/([^/]+)(?:\/|$)/);
  if(!match)return fail(c,'Organisation not found',404);
  let orgId: string;
  try { orgId = decodeURIComponent(match[1]); } catch { return fail(c,'Organisation not found',404); }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(orgId)) return fail(c,'Organisation not found',404);
  const membership=await c.env.DB.prepare("SELECT role FROM memberships WHERE organisation_id=? AND user_id=? AND status='active'").bind(orgId,u.id).first() as {role:Role}|null;
  if(!membership)return fail(c,'Organisation not found',404);
  c.set('organisationId',orgId);
  c.set('role',membership.role);
  await next();
});
app.get('/api/v1/organisations',async c=>{
  const rows=await c.env.DB.prepare("SELECT o.id,o.name,o.slug,o.country_code,o.currency_code,o.time_zone,o.week_start,o.time_format,m.role FROM organisations o JOIN memberships m ON m.organisation_id=o.id WHERE m.user_id=? AND m.status='active' ORDER BY o.created_at DESC").bind(c.get('userId')).all();
  return c.json({organisations:rows.results});
});
app.post('/api/v1/organisations',async c=>{
  const columns=await c.env.DB.prepare('PRAGMA table_info(organisations)').all() as {results:{name:string}[]};
  if(['industry','team_size_band','week_start','time_format'].some(col=>!columns.results.some(row=>row.name===col))){
    console.error('Organisation onboarding blocked: D1 migration 0003_multilocation.sql not yet applied');
    return fail(c,'Business setup needs a database update. The administrator must apply the latest D1 migration.',503);
  }
  const x=await body(c),name=safeStr(x?.name,100),country=safeStr(x?.countryCode,2).toUpperCase(),currency=safeStr(x?.currencyCode,3).toUpperCase(),zone=safeStr(x?.timeZone,64);
  const industry=safeStr(x?.industry,60)||null,teamSize=safeStr(x?.teamSize,20)||null;
  const weekStart=x?.weekStart??1,timeFormat=x?.timeFormat??'24h';
  const firstLocation=safeStr(x?.firstLocation,100);
  if(![0,1,6].includes(weekStart)||!['12h','24h'].includes(timeFormat))return fail(c,'Invalid scheduling preferences',422);
  if(x?.firstLocation!==undefined&&firstLocation.length<2)return fail(c,'First location must have at least two characters',422);
  if(x?.locations!==undefined&&!Array.isArray(x.locations))return fail(c,'Locations must be a list',422);
  const supplied: unknown[] = Array.isArray(x?.locations) ? x.locations : firstLocation ? [firstLocation] : [];
  if (supplied.length>20) return fail(c,'Provide up to 20 locations during setup.',422);
  const branches = supplied.map(item => {
    if (typeof item === 'string') return { name: safeStr(item,100), zone };
    const branch = item as {name?: unknown; timeZone?: unknown} | null;
    return { name: safeStr(branch?.name,100), zone: safeStr(branch?.timeZone,64) || zone };
  });
  if (branches.some(branch=>branch.name.length<2||!validZone(branch.zone)) ||
      new Set(branches.map(branch=>branch.name.toLowerCase())).size!==branches.length) {
    return fail(c,'Provide distinct location names and valid IANA time zones.',422);
  }
  if(name.length<2||!/^[A-Z]{2}$/.test(country)||!/^[A-Z]{3}$/.test(currency)||!validZone(zone))return fail(c,'Provide an organisation name, ISO country/currency codes and a valid IANA time zone.',422);
  const id=crypto.randomUUID(),slug=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,42)+'-'+id.slice(0,8);
  const writes=[
    c.env.DB.prepare('INSERT INTO organisations(id,name,slug,country_code,currency_code,time_zone,industry,team_size_band,week_start,time_format) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,name,slug,country,currency,zone,industry,teamSize,weekStart,timeFormat),
    c.env.DB.prepare("INSERT INTO memberships(organisation_id,user_id,role,status) VALUES(?,?,'owner','active')").bind(id,c.get('userId')),
    c.env.DB.prepare('INSERT INTO audit_events(id,organisation_id,actor_user_id,action,resource_type,resource_id) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),id,c.get('userId'),'create','organisation',id)
  ];
  for(const branch of branches)writes.push(c.env.DB.prepare('INSERT INTO locations(id,organisation_id,name,time_zone) VALUES(?,?,?,?)').bind(crypto.randomUUID(),id,branch.name,branch.zone));
  await c.env.DB.batch(writes);
  return c.json({organisation:{id,name,slug,country_code:country,currency_code:currency,time_zone:zone,week_start:weekStart,time_format:timeFormat,role:'owner'}},201);
});
app.get('/api/v1/organisations/:orgId',async c=>{
  const row=await c.env.DB.prepare('SELECT id,name,slug,country_code,currency_code,time_zone,week_start,time_format FROM organisations WHERE id=?').bind(c.get('organisationId')).first();
  return c.json({organisation:{...row,role:c.get('role')}});
});
app.patch(orgRoute, async c => {
  if (!orgAdmin(c)) return fail(c,'Only owners and administrators can edit organisation settings.',403);
  const input = await body(c), name = safeStr(input?.name,100), zone = safeStr(input?.timeZone,64);
  const weekStart = input?.weekStart, timeFormat = input?.timeFormat;
  if (name.length < 2 || !validZone(zone) || ![0,1,6].includes(weekStart) || !['12h','24h'].includes(timeFormat)) {
    return fail(c,'Enter a name, valid time zone, week start and time format.',422);
  }
  const org = c.get('organisationId');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE organisations SET name=?,time_zone=?,week_start=?,time_format=? WHERE id=?').bind(name,zone,weekStart,timeFormat,org),
    audit(c,'update','organisation',org)
  ]);
  return c.json({ok:true});
});
app.get('/api/v1/organisations/:orgId/members',async c=>{
  if(!['owner','admin'].includes(c.get('role')))return fail(c,'Only organisation owners and administrators can view all memberships',403);
  const rows=await c.env.DB.prepare('SELECT m.user_id,u.display_name,u.email_normalized,m.role,m.status FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organisation_id=? ORDER BY u.display_name').bind(c.get('organisationId')).all();
  return c.json({members:rows.results});
});
function locationReadScope(c: ApiContext) {
  if (orgAdmin(c)) return { clause: '', values: [] };
  if (c.get('role') === 'manager') return {
    clause: ' AND EXISTS (SELECT 1 FROM location_access a WHERE a.organisation_id=l.organisation_id AND a.location_id=l.id AND a.user_id=?)',
    values: [c.get('userId')]
  };
  return {
    clause: ` AND EXISTS (SELECT 1 FROM employee_locations el JOIN employees e ON e.organisation_id=el.organisation_id AND e.id=el.employee_id
      WHERE el.organisation_id=l.organisation_id AND el.location_id=l.id AND e.user_id=? AND e.employment_status='active')`,
    values: [c.get('userId')]
  };
}
app.get(orgRoute+'/locations',async c=>{
  const {clause,values} = locationReadScope(c);
  const archived = orgAdmin(c) && c.req.query('archived') === '1';
  const rows=await c.env.DB.prepare(`SELECT l.id,l.name,l.time_zone,l.archived_at FROM locations l
    WHERE l.organisation_id=? ${archived ? 'AND l.archived_at IS NOT NULL' : 'AND l.archived_at IS NULL'} ${clause}
    ORDER BY l.name,l.id`).bind(c.get('organisationId'),...values).all();
  return c.json({locations:rows.results});
});
app.get(orgRoute+'/locations/:locationId',async c=>{
  const {clause,values} = locationReadScope(c);
  const location = await c.env.DB.prepare(`SELECT l.id,l.name,l.time_zone,l.archived_at FROM locations l
    WHERE l.organisation_id=? AND l.id=? ${orgAdmin(c) ? '' : 'AND l.archived_at IS NULL'} ${clause}`)
    .bind(c.get('organisationId'),c.req.param('locationId'),...values).first();
  if (!location) return fail(c,'Location not found',404);
  return c.json({location});
});
app.patch(orgRoute+'/locations/:locationId',async c=>{
  if (!orgAdmin(c)) return fail(c,'Only owners and administrators can edit locations.',403);
  const id = c.req.param('locationId'), org = c.get('organisationId');
  const input = await body(c), name = safeStr(input?.name,100), zone = safeStr(input?.timeZone,64);
  if (name.length < 2 || !validZone(zone)) return fail(c,'Enter a location name and valid IANA time zone.',422);
  const updated = await c.env.DB.batch([
    c.env.DB.prepare('UPDATE locations SET name=?,time_zone=? WHERE organisation_id=? AND id=? AND archived_at IS NULL').bind(name,zone,org,id),
    c.env.DB.prepare(`INSERT INTO audit_events(id,organisation_id,actor_user_id,action,resource_type,resource_id)
      SELECT ?,?,?, 'update','location',? WHERE changes()>0`).bind(crypto.randomUUID(),org,c.get('userId'),id)
  ]);
  if (!updated[0].meta.changes) return fail(c,'Active location not found',404);
  return c.json({ok:true});
});
app.post(orgRoute+'/locations/:locationId/:operation{archive|restore}', async c => {
  if (!orgAdmin(c)) return fail(c,'Only owners and administrators can archive or restore locations.',403);
  const id = c.req.param('locationId'), org = c.get('organisationId'), now = isoNow();
  const archive = c.req.param('operation') === 'archive';
  const location = await c.env.DB.prepare('SELECT archived_at FROM locations WHERE organisation_id=? AND id=?').bind(org,id).first<{archived_at:string|null}>();
  if (!location) return fail(c,'Location not found',404);
  if (Boolean(location.archived_at) !== archive) {
    const writes = await c.env.DB.batch([
      archive ? c.env.DB.prepare(`UPDATE locations SET archived_at=? WHERE organisation_id=? AND id=? AND archived_at IS NULL
        AND NOT EXISTS (${upcomingShift})`).bind(now,org,id,org,id,now)
        : c.env.DB.prepare('UPDATE locations SET archived_at=NULL WHERE organisation_id=? AND id=? AND archived_at IS NOT NULL').bind(org,id),
      c.env.DB.prepare(`INSERT INTO audit_events(id,organisation_id,actor_user_id,action,resource_type,resource_id)
        SELECT ?,?,?,?,'location',? WHERE changes()>0`).bind(crypto.randomUUID(),org,c.get('userId'),archive?'archive':'restore',id)
    ]);
    if (archive && !writes[0].meta.changes) {
      const current = await c.env.DB.prepare('SELECT archived_at FROM locations WHERE organisation_id=? AND id=?').bind(org,id).first<{archived_at:string|null}>();
      if (!current?.archived_at) return fail(c,'Resolve upcoming shifts at this location before archiving it.',409);
    }
  }
  return c.json({ok:true});
});
// Assignment APIs keep staff and manager scope within a single organisation.
app.get('/api/v1/organisations/:orgId/location-access',async c=>{
  if(!['owner','admin'].includes(c.get('role')))return fail(c,'Not permitted',403);
  const rows=await c.env.DB.prepare(`SELECT a.location_id,a.user_id,u.email_normalized FROM location_access a JOIN users u ON u.id=a.user_id JOIN memberships m ON m.organisation_id=a.organisation_id AND m.user_id=a.user_id AND m.role='manager' AND m.status='active' WHERE a.organisation_id=? ORDER BY a.location_id`).bind(c.get('organisationId')).all();
  return c.json({assignments:rows.results});
});
app.post('/api/v1/organisations/:orgId/location-access',async c=>{
  if(!['owner','admin'].includes(c.get('role')))return fail(c,'Not permitted',403);
  const x=await body(c),org=c.get('organisationId'),location=safeStr(x?.locationId,64),user=safeStr(x?.userId,64);
  if(!location||!user)return fail(c,'Location and manager are required',422);
  const member=await c.env.DB.prepare("SELECT role FROM memberships WHERE organisation_id=? AND user_id=? AND status='active'").bind(org,user).first() as {role:Role}|null;
  if(!member||member.role!=='manager')return fail(c,'An active manager membership is required',422);
  const existing=await c.env.DB.prepare('SELECT id FROM locations WHERE organisation_id=? AND id=? AND archived_at IS NULL').bind(org,location).first();
  if(!existing)return fail(c,'Location not found',404);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT OR IGNORE INTO location_access(organisation_id,location_id,user_id) VALUES(?,?,?)').bind(org,location,user),
    c.env.DB.prepare('INSERT INTO audit_events(id,organisation_id,actor_user_id,action,resource_type,resource_id) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),org,c.get('userId'),'assign_manager','location',location)
  ]);
  return c.json({ok:true},201);
});
app.get('/api/v1/organisations/:orgId/employee-locations',async c=>{
  if(!['owner','admin','manager'].includes(c.get('role')))return fail(c,'Not permitted',403);
  const org=c.get('organisationId'),user=c.get('userId');
  const rows=c.get('role')==='manager'
    ?await c.env.DB.prepare('SELECT el.employee_id,el.location_id FROM employee_locations el JOIN locations l ON l.organisation_id=el.organisation_id AND l.id=el.location_id AND l.archived_at IS NULL JOIN location_access a ON a.organisation_id=el.organisation_id AND a.location_id=el.location_id WHERE el.organisation_id=? AND a.user_id=?').bind(org,user).all()
    :await c.env.DB.prepare('SELECT employee_id,location_id FROM employee_locations WHERE organisation_id=?').bind(org).all();
  return c.json({assignments:rows.results});
});
app.post('/api/v1/organisations/:orgId/employee-locations',async c=>{
  if(!['owner','admin'].includes(c.get('role')))return fail(c,'Not permitted',403);
  const x=await body(c),org=c.get('organisationId'),employee=safeStr(x?.employeeId,64),location=safeStr(x?.locationId,64);
  if(!employee||!location)return fail(c,'Employee and location are required',422);
  const employeeRow=await c.env.DB.prepare("SELECT id FROM employees WHERE organisation_id=? AND id=? AND employment_status='active'").bind(org,employee).first();
  const locationRow=await c.env.DB.prepare('SELECT id FROM locations WHERE organisation_id=? AND id=? AND archived_at IS NULL').bind(org,location).first();
  if(!employeeRow||!locationRow)return fail(c,'Employee or location not found',404);
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO employee_locations(organisation_id,employee_id,location_id)
      SELECT ?1,?2,?3 WHERE EXISTS (SELECT 1 FROM locations WHERE organisation_id=?1 AND id=?3 AND archived_at IS NULL)
      AND EXISTS (SELECT 1 FROM employees WHERE organisation_id=?1 AND id=?2 AND employment_status='active')
      ON CONFLICT DO NOTHING`).bind(org,employee,location),
    c.env.DB.prepare(`INSERT INTO audit_events(id,organisation_id,actor_user_id,action,resource_type,resource_id,details_json)
      SELECT ?,?,?, 'assign_employee','location',?,? WHERE changes()>0`).bind(crypto.randomUUID(),org,c.get('userId'),location,JSON.stringify({employeeId:employee}))
  ]);
  return c.json({ok:true},201);
});
app.delete(orgRoute+'/employee-locations/:employeeId/:locationId',async c=>{
  if (!orgAdmin(c)) return fail(c,'Not permitted',403);
  const org=c.get('organisationId'),employee=c.req.param('employeeId'),location=c.req.param('locationId');
  const results=await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM employee_locations WHERE organisation_id=? AND employee_id=? AND location_id=?
      AND NOT EXISTS (${upcomingShift} AND employee_id=?)`).bind(org,employee,location,org,location,isoNow(),employee),
    c.env.DB.prepare(`INSERT INTO audit_events(id,organisation_id,actor_user_id,action,resource_type,resource_id,details_json)
      SELECT ?,?,?, 'unassign_employee','location',?,? WHERE changes()>0`).bind(crypto.randomUUID(),org,c.get('userId'),location,JSON.stringify({employeeId:employee}))
  ]);
  if (!results[0].meta.changes && await c.env.DB.prepare('SELECT 1 FROM employee_locations WHERE organisation_id=? AND employee_id=? AND location_id=?').bind(org,employee,location).first()) {
    return fail(c,'Resolve upcoming shifts for this employee before removing the assignment.',409);
  }
  return c.json({ok:true});
});
app.delete(orgRoute+'/location-access/:locationId/:userId',async c=>{
  if (!orgAdmin(c)) return fail(c,'Not permitted',403);
  const org=c.get('organisationId'),location=c.req.param('locationId'),user=c.req.param('userId');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM location_access WHERE organisation_id=? AND location_id=? AND user_id=?').bind(org,location,user),
    c.env.DB.prepare(`INSERT INTO audit_events(id,organisation_id,actor_user_id,action,resource_type,resource_id,details_json)
      SELECT ?,?,?, 'unassign_manager','location',?,? WHERE changes()>0`).bind(crypto.randomUUID(),org,c.get('userId'),location,JSON.stringify({userId:user}))
  ]);
  return c.json({ok:true});
});
app.post('/api/v1/organisations/:orgId/locations',async c=>{
  if(!['owner','admin'].includes(c.get('role')))return fail(c,'Only organisation owners and admins may create locations.',403);
  const x=await body(c),name=safeStr(x?.name,100),zone=safeStr(x?.timeZone,64);
  if(name.length<2||!validZone(zone))return fail(c,'Location name and valid time zone required',422);
  const id=crypto.randomUUID(),org=c.get('organisationId');
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO locations(id,organisation_id,name,time_zone) VALUES(?,?,?,?)').bind(id,org,name,zone),
    audit(c,'create','location',id)
  ]);
  return c.json({location:{id,name,time_zone:zone}},201);
});
app.get('/api/v1/organisations/:orgId/employees',async c=>{
  if(!['owner','admin','manager'].includes(c.get('role')))return fail(c,'Not permitted',403);
  const rows=c.get('role')==='manager'
    ?await c.env.DB.prepare('SELECT DISTINCT e.id,e.display_name,e.employment_status FROM employees e JOIN employee_locations el ON el.organisation_id=e.organisation_id AND el.employee_id=e.id JOIN locations l ON l.organisation_id=el.organisation_id AND l.id=el.location_id AND l.archived_at IS NULL JOIN location_access a ON a.organisation_id=el.organisation_id AND a.location_id=el.location_id WHERE e.organisation_id=? AND a.user_id=? ORDER BY e.display_name').bind(c.get('organisationId'),c.get('userId')).all()
    :await c.env.DB.prepare('SELECT id,display_name,employment_status,user_id FROM employees WHERE organisation_id=? ORDER BY display_name').bind(c.get('organisationId')).all();
  return c.json({employees:rows.results});
});
app.post('/api/v1/organisations/:orgId/employees',async c=>{
  if(!['owner','admin'].includes(c.get('role')))return fail(c,'Only organisation owners and administrators can add staff.',403);
  const x=await body(c),name=safeStr(x?.name,100);if(name.length<2)return fail(c,'Employee name required',422);
  const id=crypto.randomUUID(),org=c.get('organisationId');
  const locationId = safeStr(x?.locationId,64);
  const writes = [
    c.env.DB.prepare(`INSERT INTO employees(id,organisation_id,display_name)
      SELECT ?,?,? WHERE ?='' OR EXISTS (SELECT 1 FROM locations WHERE organisation_id=? AND id=? AND archived_at IS NULL)`).bind(id,org,name,locationId,org,locationId)
  ];
  if (locationId) writes.push(c.env.DB.prepare(`INSERT INTO employee_locations(organisation_id,employee_id,location_id)
    SELECT organisation_id,id,? FROM employees WHERE organisation_id=? AND id=?`).bind(locationId,org,id));
  writes.push(c.env.DB.prepare(`INSERT INTO audit_events(id,organisation_id,actor_user_id,action,resource_type,resource_id)
    SELECT ?,organisation_id,?,'create','employee',id FROM employees WHERE organisation_id=? AND id=?`)
    .bind(crypto.randomUUID(),c.get('userId'),org,id));
  const results = await c.env.DB.batch(writes);
  if (!results[0].meta.changes) return fail(c,'Location not found',404);
  return c.json({employee:{id,display_name:name,employment_status:'active'}},201);
});
registerShifts(app);
registerShiftBatch(app);
registerLeave(app);
registerTimekeeping(app);
registerSwaps(app);
registerStaff(app);
registerShiftTemplates(app);
registerInvitations(app, currentUser);
app.onError((_error,c)=>{
  console.error(JSON.stringify({event:'unexpected_api_error',requestId:c.get('requestId'),method:c.req.method,versionId:c.env.CF_VERSION_METADATA?.id}));
  return fail(c,'Server error',500);
});
app.notFound(c=>fail(c,'Not found',404));
export default app;
