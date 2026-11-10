import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

type Bindings = { DB: D1Database; EMAIL?: { send(message: {to:string;from:string;subject:string;text:string}):Promise<{messageId:string}> }; RESEND_API_KEY?: string; MAIL_FROM?: string; APP_URL?: string; TEST_REGISTRATION_EMAIL?: string };
type Vars = { userId: string; organisationId: string; role: string };
const app = new Hono<{ Bindings: Bindings; Variables: Vars }>();
const jsonError = (message: string, status: 400|401|403|404|409|422|429|500|503 = 400) => ({ error: message, status });
const isoNow = () => new Date().toISOString();
const days = (n: number) => new Date(Date.now()+n*86400000).toISOString();
const hex = (a: Uint8Array) => [...a].map(b=>b.toString(16).padStart(2,'0')).join('');
const rnd = (bytes=32) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
async function sha(s: string) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))); }
async function derivePassword(password: string,salt: string) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const derived=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},key,256);
  return hex(new Uint8Array(derived));
}
function validZone(s: string) { try { new Intl.DateTimeFormat('en-US',{timeZone:s});return true; }catch{return false;} }
function passValid(s: string) {return s.length>=12&&s.length<=128;}
function isEmail(s: string) {return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)&&s.length<=254;}
async function body(c: any) { try {const b=await c.req.json(); return b&&typeof b==='object'&&!Array.isArray(b)?b:null;}catch{return null;} }
function fail(c: any, text: string, status: 400|401|403|404|409|422|429|500|503=400) {return c.json(jsonError(text,status),status);}
function safeStr(v: unknown,limit=120){return typeof v==='string'?v.trim().slice(0,limit):'';}
function cookieOptions(c: any) {return {httpOnly:true,secure:new URL(c.req.url).protocol==='https:',sameSite:'Lax' as const,path:'/',maxAge:60*60*24*14};}
async function createSession(c: any,userId: string){
  const token=rnd();await c.env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await sha(token),userId,days(14)).run();
  setCookie(c,'sl_session',token,cookieOptions(c));
}
async function currentUser(c: any):Promise<{id:string;display_name:string;email_normalized:string}|null>{
  const token=getCookie(c,'sl_session');if(!token||!/^([a-f0-9]{64})$/.test(token))return null;
  return await c.env.DB.prepare('SELECT users.id,users.display_name,users.email_normalized FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>? AND users.email_verified_at IS NOT NULL').bind(await sha(token),isoNow()).first() as any;
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
async function sendMail(c: any,email:string,subject:string,text:string) {
  if(!mailReady(c.env)) return false;
  // Primary: Cloudflare Email Sending binding, when attached to this Worker.
  if(c.env.EMAIL) {
    try {
      await c.env.EMAIL.send({to:email,from:c.env.MAIL_FROM,subject,text});
      return true;
    } catch (error) {
      console.error('Cloudflare Email Service failed',error);
      // The optional fallback is intended for transient provider failures.
    }
  }
  if(!c.env.RESEND_API_KEY) return false;
  try {
    const result=await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{Authorization:'Bearer '+c.env.RESEND_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({from:c.env.MAIL_FROM,to:[email],subject,text})
    });
    if(!result.ok) console.error('Email fallback returned HTTP',result.status);
    return result.ok;
  } catch (error) {
    console.error('Email fallback request failed',error);
    return false;
  }
}
async function tokenFor(c:any,userId:string,purpose:'verify_email'|'reset_password') {
  const raw=rnd();await c.env.DB.prepare('DELETE FROM auth_tokens WHERE user_id=? AND purpose=?').bind(userId,purpose).run();
  await c.env.DB.prepare('INSERT INTO auth_tokens(token_hash,user_id,purpose,expires_at) VALUES(?,?,?,?)').bind(await sha(raw),userId,purpose,days(1)).run();return raw;
}
async function rateLimit(c:any,key:string,max=7) {
  const hash=await sha(key);
  const row=await c.env.DB.prepare('SELECT attempts,window_end FROM auth_rate_limits WHERE key_hash=?').bind(hash).first() as {attempts:number;window_end:string}|null;
  if(!row||row.window_end<isoNow()){
    await c.env.DB.prepare('INSERT INTO auth_rate_limits(key_hash,attempts,window_end) VALUES(?,1,?) ON CONFLICT(key_hash) DO UPDATE SET attempts=1,window_end=excluded.window_end').bind(hash,new Date(Date.now()+15*60000).toISOString()).run();return true;
  }
  await c.env.DB.prepare('UPDATE auth_rate_limits SET attempts=attempts+1 WHERE key_hash=?').bind(hash).run();return row.attempts<max;
}
app.use('/api/*',async(c,next)=>{
  c.header('Cache-Control','no-store');
  const origin=c.req.header('Origin');
  const self=new URL(c.req.url).origin;
  const dev=['http://localhost:5173','http://127.0.0.1:5173'].includes(origin||'');
  const fetchSite=c.req.header('Sec-Fetch-Site');
  if(!['GET','HEAD','OPTIONS'].includes(c.req.method)&&fetchSite==='cross-site')return fail(c,'Cross-site requests are not accepted',403);
  if(origin&&(origin===self||dev)){c.header('Access-Control-Allow-Origin',origin);c.header('Access-Control-Allow-Credentials','true');c.header('Vary','Origin');}
  if(c.req.method==='OPTIONS')return c.body(null,204);
  if(!['GET','HEAD'].includes(c.req.method)&&origin&&origin!==self&&!dev)return fail(c,'Untrusted origin',403);
  await next();
});
app.get('/api/health',c=>c.json({ok:true,service:'shiftledger',api:'v1'}));
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
  } catch (error) {
    console.error('Registration preflight database failure',error);
    return fail(c,'Registration database is temporarily unavailable.',503);
  }
  if(!mailReady(c.env))return fail(c,'Email delivery has not been configured by the administrator.',503);
  const x=await body(c);if(!x)return fail(c,'Invalid JSON');
  const email=safeStr(x.email,254).toLowerCase(),password=x.password;
  if(!isEmail(email)||typeof password!=='string'||!passValid(password))return fail(c,'Enter a valid email and a password of 12–128 characters.',422);
  if(!testRecipientAllowed(c.env,email))return fail(c,'Registration is temporarily restricted to the configured development test account.',403);
  if(!await rateLimit(c,'register:'+email))return fail(c,'Too many attempts. Try again later.',429);
  const found=await c.env.DB.prepare('SELECT id FROM users WHERE email_normalized=?').bind(email).first();
  if(found)return c.json({ok:true,message:'If registration is available for this email, instructions will be sent.'});
  const id=crypto.randomUUID(),salt=rnd(16),hash=await derivePassword(password,salt);
  await c.env.DB.prepare('INSERT INTO users(id,email_normalized,display_name,password_hash,password_salt) VALUES(?,?,?,?,?)').bind(id,email,email,hash,salt).run();
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
  const row=await c.env.DB.prepare("SELECT user_id FROM auth_tokens WHERE token_hash=? AND purpose='verify_email' AND expires_at>?").bind(await sha(token),isoNow()).first() as {user_id:string}|null;
  if(!row)return fail(c,'This verification link is invalid or expired.',400);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET email_verified_at=? WHERE id=?').bind(isoNow(),row.user_id),
    c.env.DB.prepare('DELETE FROM auth_tokens WHERE token_hash=?').bind(await sha(token))
  ]);
  return c.json({ok:true});
});
app.post('/api/v1/auth/login',async c=>{
  const x=await body(c);const email=safeStr(x?.email,254).toLowerCase(),password=x?.password;
  if(!isEmail(email)||typeof password!=='string')return fail(c,'Invalid credentials',401);
  const ip=c.req.header('CF-Connecting-IP')||'unknown';
  if(!await rateLimit(c,'login:'+ip+':'+email,8))return fail(c,'Too many attempts. Try again later.',429);
  const row=await c.env.DB.prepare('SELECT id,password_hash,password_salt,email_verified_at FROM users WHERE email_normalized=?').bind(email).first() as any;
  const salt=row?.password_salt||'invalid-salt';
  const actual=await derivePassword(password,salt);
  if(!row||!row.password_hash||actual!==row.password_hash)return fail(c,'Invalid credentials',401);
  if(!row.email_verified_at)return fail(c,'Verify your email before signing in.',403);
  await createSession(c,row.id);
  return c.json({ok:true});
});
app.post('/api/v1/auth/logout',async c=>{
  const token=getCookie(c,'sl_session');if(token)await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha(token)).run();
  deleteCookie(c,'sl_session',{path:'/'});return c.json({ok:true});
});
app.get('/api/v1/auth/me',async c=>{
  const u=await currentUser(c);if(!u)return fail(c,'Sign in required',401);
  return c.json({user:{id:u.id,name:u.display_name,email:u.email_normalized}});
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
  const row=await c.env.DB.prepare("SELECT user_id FROM auth_tokens WHERE token_hash=? AND purpose='reset_password' AND expires_at>?").bind(hash,isoNow()).first() as {user_id:string}|null;
  if(!row)return fail(c,'Reset link invalid or expired',400);
  const salt=rnd(16),newHash=await derivePassword(password,salt);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash=?,password_salt=? WHERE id=?').bind(newHash,salt,row.user_id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(row.user_id),
    c.env.DB.prepare('DELETE FROM auth_tokens WHERE token_hash=?').bind(hash)
  ]);
  return c.json({ok:true});
});
app.use('/api/v1/organisations/*',async(c,next)=>{
  const u=await currentUser(c);if(!u)return fail(c,'Sign in required',401);
  c.set('userId',u.id);
  const orgId=c.req.param('orgId');
  if(orgId){
    const membership=await c.env.DB.prepare("SELECT role FROM memberships WHERE organisation_id=? AND user_id=? AND status='active'").bind(orgId,u.id).first() as {role:string}|null;
    if(!membership)return fail(c,'Organisation not found',404);
    c.set('organisationId',orgId);c.set('role',membership.role);
  }
  await next();
});
app.get('/api/v1/organisations',async c=>{
  const u=await currentUser(c);if(!u)return fail(c,'Sign in required',401);
  const rows=await c.env.DB.prepare("SELECT o.id,o.name,o.slug,o.country_code,o.currency_code,o.time_zone,m.role FROM organisations o JOIN memberships m ON m.organisation_id=o.id WHERE m.user_id=? AND m.status='active' ORDER BY o.created_at DESC").bind(u.id).all();
  return c.json({organisations:rows.results});
});
app.post('/api/v1/organisations',async c=>{
  const u=await currentUser(c);if(!u)return fail(c,'Sign in required',401);
  const x=await body(c),name=safeStr(x?.name,100),country=safeStr(x?.countryCode,2).toUpperCase(),currency=safeStr(x?.currencyCode,3).toUpperCase(),zone=safeStr(x?.timeZone,64);
  if(name.length<2||!/^[A-Z]{2}$/.test(country)||!/^[A-Z]{3}$/.test(currency)||!validZone(zone))return fail(c,'Provide an organisation name, ISO country/currency codes and a valid IANA time zone.',422);
  const id=crypto.randomUUID(),slug=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,42)+'-'+id.slice(0,8);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO organisations(id,name,slug,country_code,currency_code,time_zone) VALUES(?,?,?,?,?,?)').bind(id,name,slug,country,currency,zone),
    c.env.DB.prepare("INSERT INTO memberships(organisation_id,user_id,role,status) VALUES(?,?,'owner','active')").bind(id,u.id),
    c.env.DB.prepare('INSERT INTO audit_events(id,organisation_id,actor_user_id,action,resource_type,resource_id) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),id,u.id,'create','organisation',id)
  ]);
  return c.json({organisation:{id,name,slug,country_code:country,currency_code:currency,time_zone:zone,role:'owner'}},201);
});
app.get('/api/v1/organisations/:orgId',async c=>{
  const row=await c.env.DB.prepare('SELECT id,name,slug,country_code,currency_code,time_zone FROM organisations WHERE id=?').bind(c.get('organisationId')).first();
  return c.json({organisation:{...row,role:c.get('role')}});
});
app.get('/api/v1/organisations/:orgId/members',async c=>{
  if(!['owner','admin','manager'].includes(c.get('role')))return fail(c,'Not permitted',403);
  const rows=await c.env.DB.prepare('SELECT m.user_id,u.display_name,u.email_normalized,m.role,m.status FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organisation_id=? ORDER BY u.display_name').bind(c.get('organisationId')).all();
  return c.json({members:rows.results});
});
app.get('/api/v1/organisations/:orgId/locations',async c=>{
  const rows=await c.env.DB.prepare('SELECT id,name,time_zone FROM locations WHERE organisation_id=? AND archived_at IS NULL ORDER BY name').bind(c.get('organisationId')).all();return c.json({locations:rows.results});
});
app.post('/api/v1/organisations/:orgId/locations',async c=>{
  if(!['owner','admin','manager'].includes(c.get('role')))return fail(c,'Not permitted',403);
  const x=await body(c),name=safeStr(x?.name,100),zone=safeStr(x?.timeZone,64);
  if(name.length<2||!validZone(zone))return fail(c,'Location name and valid time zone required',422);
  const id=crypto.randomUUID(),org=c.get('organisationId');
  await c.env.DB.prepare('INSERT INTO locations(id,organisation_id,name,time_zone) VALUES(?,?,?,?)').bind(id,org,name,zone).run();
  return c.json({location:{id,name,time_zone:zone}},201);
});
app.get('/api/v1/organisations/:orgId/employees',async c=>{
  if(!['owner','admin','manager'].includes(c.get('role')))return fail(c,'Not permitted',403);
  const rows=await c.env.DB.prepare('SELECT id,display_name,employment_status FROM employees WHERE organisation_id=? ORDER BY display_name').bind(c.get('organisationId')).all();
  return c.json({employees:rows.results});
});
app.post('/api/v1/organisations/:orgId/employees',async c=>{
  if(!['owner','admin','manager'].includes(c.get('role')))return fail(c,'Not permitted',403);
  const x=await body(c),name=safeStr(x?.name,100);if(name.length<2)return fail(c,'Employee name required',422);
  const id=crypto.randomUUID(),org=c.get('organisationId');
  await c.env.DB.prepare('INSERT INTO employees(id,organisation_id,display_name) VALUES(?,?,?)').bind(id,org,name).run();
  return c.json({employee:{id,display_name:name,employment_status:'active'}},201);
});
app.get('/api/v1/organisations/:orgId/shifts',async c=>{
  const org=c.get('organisationId'),role=c.get('role');
  if(!['owner','admin','manager'].includes(role))return fail(c,'Only managers can view the full rota',403);
  const rows=await c.env.DB.prepare('SELECT id,location_id,employee_id,starts_at_utc,ends_at_utc,unpaid_break_minutes,status FROM shifts WHERE organisation_id=? ORDER BY starts_at_utc DESC LIMIT 200').bind(org).all();
  return c.json({shifts:rows.results});
});
app.post('/api/v1/organisations/:orgId/shifts',async c=>{
  if(!['owner','admin','manager'].includes(c.get('role')))return fail(c,'Not permitted',403);
  const x=await body(c),location=safeStr(x?.locationId,64),employee=x?.employeeId? safeStr(x.employeeId,64):null;
  const start=safeStr(x?.startsAt,40),end=safeStr(x?.endsAt,40),breaks=x?.breakMinutes??0;
  if(!location||!/^\d{4}-\d{2}-\d{2}T/.test(start)||!start.endsWith('Z')||!end.endsWith('Z')||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(end)<=Date.parse(start)||!Number.isInteger(breaks)||breaks<0||breaks>1440)return fail(c,'Valid location, UTC start/end and break minutes required',422);
  const id=crypto.randomUUID(),org=c.get('organisationId');
  const loc=await c.env.DB.prepare('SELECT id FROM locations WHERE organisation_id=? AND id=? AND archived_at IS NULL').bind(org,location).first();
  if(!loc)return fail(c,'Location not found',404);
  if(employee){const emp=await c.env.DB.prepare("SELECT id FROM employees WHERE organisation_id=? AND id=? AND employment_status='active'").bind(org,employee).first();if(!emp)return fail(c,'Employee not found',404);}
  await c.env.DB.prepare('INSERT INTO shifts(id,organisation_id,location_id,employee_id,starts_at_utc,ends_at_utc,unpaid_break_minutes) VALUES(?,?,?,?,?,?,?)').bind(id,org,location,employee,new Date(start).toISOString(),new Date(end).toISOString(),breaks).run();
  return c.json({shift:{id,status:'draft'}},201);
});
app.onError((error,c)=>{
  const requestId=crypto.randomUUID();
  console.error('ShiftLedger API error',JSON.stringify({requestId,path:new URL(c.req.url).pathname,method:c.req.method,message:error.message}));
  return c.json({error:'Server error',code:'UNEXPECTED_ERROR',requestId},500);
});
app.notFound(c=>fail(c,'Not found',404));
export default app;
