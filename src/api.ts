export class ApiError extends Error {
 constructor(message: string, readonly status: number) { super(message); }
}
export async function api<T>(path:string,options:RequestInit={}):Promise<T>{
 const res=await fetch('/api/v1'+path,{...options,credentials:'include',headers:{'Content-Type':'application/json',...options.headers}});
 const data: unknown = await res.json().catch(()=>({error:'Unexpected response from the server'}));
 if(!res.ok){
  const message = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string' ? data.error : 'Request failed';
  const id = res.status >= 500 ? res.headers.get('X-Request-ID') : null;
  throw new ApiError(id ? message + ' (request ' + id + ')' : message, res.status);
 }
 if (!res.headers.get('Content-Type')?.includes('application/json')) {
  throw new ApiError('Unexpected response from the server', 502);
 }
 return data as T;
}
export function write<T>(path: string, value: unknown, method = 'POST') {
 return api<T>(path, { method, body: JSON.stringify(value) });
}
export const post = (path: string, value: unknown) => write<{message:string}>(path, value);
