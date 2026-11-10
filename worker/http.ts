import type { Context } from 'hono';

export type Bindings = { DB: D1Database; EMAIL?: { send(message: {to:string;from:string;subject:string;text:string}):Promise<{messageId:string}> }; RESEND_API_KEY?: string; MAIL_FROM?: string; APP_URL?: string; TEST_REGISTRATION_EMAIL?: string };
export type Role = 'owner' | 'admin' | 'manager' | 'employee';
type Vars = { userId: string; organisationId: string; role: Role; requestId: string };
export type Env = { Bindings: Bindings; Variables: Vars };
export type ApiContext = Context<Env>;
type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503;
const errorCodes: Record<ErrorStatus, string> = {
  400: 'BAD_REQUEST', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND',
  409: 'CONFLICT', 422: 'VALIDATION_ERROR', 429: 'RATE_LIMITED',
  500: 'UNEXPECTED_ERROR', 503: 'UNAVAILABLE'
};
export const isoNow = () => new Date().toISOString();
export const days = (n: number) => new Date(Date.now()+n*86400000).toISOString();
const hex = (a: Uint8Array) => [...a].map(b=>b.toString(16).padStart(2,'0')).join('');
export const rnd = (bytes=32) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
export async function sha(s: string) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))); }
export function orgAdmin(c: ApiContext) {
  return c.get('role') === 'owner' || c.get('role') === 'admin';
}
export function audit(c: ApiContext, action: string, type: string, resourceId: string, details = {}) {
  return c.env.DB.prepare(`INSERT INTO audit_events(id,organisation_id,actor_user_id,action,resource_type,resource_id,details_json)
    VALUES(?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),c.get('organisationId'),c.get('userId'),action,type,resourceId,JSON.stringify(details));
}
export const orgRoute = '/api/v1/organisations/:orgId';
export function isEmail(s: string) {return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)&&s.length<=254;}
export async function body(c: ApiContext) { try {const b=await c.req.json(); return b&&typeof b==='object'&&!Array.isArray(b)?b:null;}catch{return null;} }
export function fail(c: ApiContext, error: string, status: ErrorStatus = 400) {
  return c.json({ error, status, code: errorCodes[status], requestId: c.get('requestId') }, status);
}
export function safeStr(v: unknown,limit=120){return typeof v==='string'?v.trim().slice(0,limit):'';}
