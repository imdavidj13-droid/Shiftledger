import { expect, test, type APIRequestContext } from '@playwright/test';
import { employeeEmail, expiredToken, managerEmail, ownerEmail, password, resetToken, verifyToken } from './fixtures.mjs';

const org = '/api/v1/organisations/shop';
const auth = '/api/v1/auth';
async function login(request: APIRequestContext, email: string, secret = password) {
  const response = await request.post(auth + '/login', { data: { email, password: secret } });
  expect(response.status()).toBe(200);
  expect(response.headers()['set-cookie']).toMatch(/sl_session=[a-f0-9]{64}.*HttpOnly.*SameSite=Lax/);
}

test('deployed asset routing, health and API error envelope', async ({ request }) => {
  expect((await request.get('/api/health')).ok()).toBe(true);
  expect((await request.get('/api/v1/ready')).ok()).toBe(true);
  const navigation = { headers: { 'Sec-Fetch-Mode': 'navigate' } };
  expect((await request.get('/app/shop/settings', navigation)).headers()['content-type']).toContain('text/html');
  const missing = await request.get('/api/v1/unknown', navigation);
  expect(missing.status()).toBe(404);
  expect(await missing.json()).toMatchObject({ status: 404, code: 'NOT_FOUND', requestId: missing.headers()['x-request-id'] });
  expect(missing.headers()['cache-control']).toBe('no-store');
});

test('legacy passwords, session persistence, both collection paths and logout', async ({ request }) => {
  expect((await request.get(auth + '/me')).status()).toBe(401);
  expect((await request.get('/api/v1/organisations/')).status()).toBe(401);
  expect((await request.post(auth + '/login', { data: { email: ownerEmail, password: 'wrong' } })).status()).toBe(401);
  expect((await request.post(auth + '/login', { data: { email: ownerEmail, password }, headers: { Origin: 'https://untrusted.example' } })).status()).toBe(403);
  await login(request, ownerEmail);
  expect((await (await request.get(auth + '/me')).json()).user.email).toBe(ownerEmail);
  for (const path of ['/api/v1/organisations', '/api/v1/organisations/']) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect((await response.json()).organisations).toHaveLength(2);
  }
  expect((await request.get(org + '/members')).status()).toBe(200);
  await request.post(auth + '/logout', { data: {} });
  expect((await request.get(auth + '/me')).status()).toBe(401);
});

test('tenant, role and branch scope are enforced by D1-backed API requests', async ({ request, playwright, baseURL }) => {
  await login(request, managerEmail);
  expect((await request.get(org + '/members')).status()).toBe(403);
  expect((await request.get('/api/v1/organisations/other/locations')).status()).toBe(404);
  expect((await request.get('/api/v1/organisations/%E0%A4%A/locations')).status()).toBe(404);
  expect((await (await request.get(org + '/locations')).json()).locations.map(({ id }) => id)).toEqual(['north']);
  expect((await (await request.get(org + '/employees')).json()).employees.map(({ id }) => id)).toEqual(['shared']);
  expect((await (await request.get(org + '/employee-locations')).json()).assignments).toEqual([{ employee_id: 'shared', location_id: 'north' }]);
  const shift = { locationId: 'south', employeeId: 'shared', startsAt: '2032-03-08T09:00:00Z', endsAt: '2032-03-08T17:00:00Z' };
  expect((await request.post(org + '/shifts', { data: shift })).status()).toBe(403);
  expect((await request.post(org + '/shifts', { data: { ...shift, locationId: 'north', employeeId: 'south-only' } })).status()).toBe(422);
  expect((await request.post(org + '/shifts', { data: { ...shift, locationId: 'north' } })).status()).toBe(201);
  const employee = await playwright.request.newContext({ baseURL });
  try {
    await login(employee, employeeEmail);
    expect((await employee.get(org + '/employees')).status()).toBe(403);
    expect((await employee.get(org + '/shifts')).status()).toBe(403);
    expect((await employee.post(org + '/locations', { data: { name: 'Unauthorized', timeZone: 'UTC' } })).status()).toBe(403);
  } finally { await employee.dispose(); }
});

test('verification tokens expire and can only be redeemed once', async ({ request }) => {
  expect((await request.post(auth + '/register', { data: { email: 'new@example.test', password } })).status()).toBe(503);
  expect((await request.post(auth + '/login', { data: { email: 'verify@example.test', password } })).status()).toBe(403);
  expect((await request.post(auth + '/verify', { data: { token: expiredToken } })).status()).toBe(400);
  const responses = await Promise.all(Array.from({ length: 2 }, () => request.post(auth + '/verify', { data: { token: verifyToken } })));
  expect(responses.map(response => response.status()).sort()).toEqual([200, 400]);
  await login(request, 'verify@example.test');
});

test('concurrent password reset consumes the token once and revokes existing sessions', async ({ request }) => {
  await login(request, 'reset@example.test');
  const nextPassword = 'fixture-password-updated';
  const responses = await Promise.all(Array.from({ length: 2 }, () =>
    request.post(auth + '/reset-password', { data: { token: resetToken, password: nextPassword } })));
  expect(responses.map(response => response.status()).sort()).toEqual([200, 400]);
  expect((await request.get(auth + '/me')).status()).toBe(401);
  expect((await request.post(auth + '/login', { data: { email: 'reset@example.test', password } })).status()).toBe(401);
  await login(request, 'reset@example.test', nextPassword);
});

async function signIn(page: import('@playwright/test').Page, email = ownerEmail) {
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('signed-out return URL, refresh, branch filter, history and workspace denial', async ({ page }) => {
  await page.goto('/app/shop/settings?location=north');
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Organisation settings' })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/shop\/settings\?location=north$/);
  await page.reload();
  await expect(page.getByLabel('Filter workspace by location')).toHaveValue('north');
  await page.getByRole('link', { name: 'Team', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/shop\/team\?location=north$/);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Organisation settings' })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Employee directory' })).toBeVisible();
  await page.goto('/app/unknown/settings');
  await expect(page.getByRole('heading', { name: 'Workspace page unavailable' })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/unknown\/settings$/);
  await page.goto('/app/shop/settings?location=unknown');
  await expect(page.getByText('This location is unavailable or you do not have access.')).toBeVisible();
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

test('workspace API failure preserves the authenticated session and offers retry', async ({ page }) => {
  await page.route('**/api/v1/organisations', route => route.fulfill({ status: 503, json: { error: 'Database unavailable' } }));
  await page.goto('/sign-in');
  await signIn(page);
  await expect(page.getByText('Could not load your workspace. Database unavailable')).toBeVisible();
  expect((await page.request.get(auth + '/me')).status()).toBe(200);
  await page.unroute('**/api/v1/organisations');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: 'Your workforce, organised.' })).toBeVisible();
});

test('check-email route remains usable when opened directly', async ({ page }) => {
  await page.goto('/check-email');
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resend verification email' })).toBeVisible();
});
