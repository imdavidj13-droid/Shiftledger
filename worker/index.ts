import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = { DB: D1Database };
const app = new Hono<{ Bindings: Bindings }>();
app.use('/api/*', cors({ origin: (origin) => {
  const permitted = ['http://localhost:5173','http://127.0.0.1:5173'];
  return permitted.includes(origin) ? origin : '';
} }));
app.get('/api/health', c => c.json({ ok: true, service: 'shiftledger-api', version: '0.1.0' }));
app.notFound(c => c.json({ error: 'Not found' },404));

export default app;
