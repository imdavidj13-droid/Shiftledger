import { expect, test, type APIRequestContext } from '@playwright/test';
import { employeeEmail, fixtureSessions, managerEmail, ownerEmail, password } from './fixtures.mjs';

const org = '/api/v1/organisations/shop';
async function session(request: APIRequestContext, email: keyof typeof fixtureSessions) {
  const response = await request.get('/api/v1/auth/me', { headers: { Cookie: 'sl_session=' + fixtureSessions[email] } });
  expect(response.status()).toBe(200);
  return { headers: { Cookie: 'sl_session=' + fixtureSessions[email] } };
}

test('onboarding saves branch-specific zones and preserves legacy names-only requests', async ({ request }) => {
  const auth = await session(request, 'onboard@example.test');
  const setup = { name: 'Onboarding fixture', countryCode: 'GB', currencyCode: 'GBP', timeZone: 'Europe/London', weekStart: 0, timeFormat: '12h' };
  const response = await request.post('/api/v1/organisations', { ...auth, data: { ...setup, locations: [
    { name: 'Pacific', timeZone: 'America/Los_Angeles' }, 'UK branch'
  ] } });
  expect(response.status()).toBe(201);
  const organisation = (await response.json()).organisation;
  expect(organisation).toMatchObject({ role: 'owner', week_start: 0, time_format: '12h' });
  const branches = await request.get('/api/v1/organisations/' + organisation.id + '/locations', auth);
  expect((await branches.json()).locations).toMatchObject([
    { name: 'Pacific', time_zone: 'America/Los_Angeles' }, { name: 'UK branch', time_zone: 'Europe/London' }
  ]);
  expect((await request.post('/api/v1/organisations', { ...auth, data: { ...setup, locations: [{ name: 'Invalid', timeZone: '+10:00' }] } })).status()).toBe(422);
});

test('owners update, archive and restore locations without exposing foreign or archived sites', async ({ request, playwright, baseURL }) => {
  const auth = await session(request, ownerEmail);
  const created = await request.post(org + '/locations', { ...auth, data: { name: 'Archive test', timeZone: 'Asia/Kolkata' } });
  expect(created.status()).toBe(201);
  const { location } = await created.json();
  const path = org + '/locations/' + location.id;
  expect((await request.patch(path, { ...auth, data: { name: 'Archive test updated', timeZone: 'Asia/Tokyo' } })).status()).toBe(200);
  expect((await request.patch(org + '/locations/foreign', { ...auth, data: { name: 'Forbidden', timeZone: 'UTC' } })).status()).toBe(404);
  expect((await request.post(path + '/archive', { ...auth, data: {} })).status()).toBe(200);
  expect((await (await request.get(path, auth)).json()).location).toMatchObject({ name: 'Archive test updated', time_zone: 'Asia/Tokyo', archived_at: expect.any(String) });
  expect((await (await request.get(org + '/locations', auth)).json()).locations.map(({ id }) => id)).not.toContain(location.id);
  expect((await (await request.get(org + '/locations?archived=1', auth)).json()).locations.map(({ id }) => id)).toContain(location.id);
  const manager = await playwright.request.newContext({ baseURL });
  try {
    const managerAuth = await session(manager, managerEmail);
    expect((await manager.get(path, managerAuth)).status()).toBe(404);
    expect((await manager.get(org + '/locations/south', managerAuth)).status()).toBe(404);
    expect((await manager.post(path + '/restore', { ...managerAuth, data: {} })).status()).toBe(403);
  } finally { await manager.dispose(); }
  expect((await request.post(path + '/restore', { ...auth, data: {} })).status()).toBe(200);
  expect((await (await request.get(path, auth)).json()).location.archived_at).toBeNull();
});

test('manager grants are scoped and revocation takes effect with an existing session', async ({ request, playwright, baseURL }) => {
  const auth = await session(request, ownerEmail);
  const manager = await playwright.request.newContext({ baseURL });
  try {
    const managerAuth = await session(manager, managerEmail);
    expect((await manager.get(org + '/locations/west', managerAuth)).status()).toBe(404);
    expect((await request.post(org + '/location-access', { ...auth, data: { locationId: 'foreign', userId: 'manager' } })).status()).toBe(404);
    expect((await request.post(org + '/location-access', { ...auth, data: { locationId: 'west', userId: 'employee' } })).status()).toBe(422);
    expect((await request.post(org + '/location-access', { ...auth, data: { locationId: 'west', userId: 'manager' } })).status()).toBe(201);
    expect((await manager.get(org + '/locations/west', managerAuth)).status()).toBe(200);
    expect((await request.delete(org + '/location-access/west/manager', auth)).status()).toBe(200);
    expect((await manager.get(org + '/locations/west', managerAuth)).status()).toBe(404);
    expect((await manager.get(org + '/locations/north', managerAuth)).status()).toBe(200);
  } finally { await manager.dispose(); }
});

test('staff creation is atomic and employee accounts see only their own branches', async ({ request, playwright, baseURL }) => {
  const auth = await session(request, ownerEmail);
  expect((await request.post(org + '/employees', { ...auth, data: { name: 'Do not create', locationId: 'foreign' } })).status()).toBe(404);
  expect((await (await request.get(org + '/employees', auth)).json()).employees.map(({ display_name }) => display_name)).not.toContain('Do not create');
  const created = await request.post(org + '/employees', { ...auth, data: { name: 'New staff fixture', locationId: 'west' } });
  expect(created.status()).toBe(201);
  const { employee } = await created.json();
  expect((await (await request.get(org + '/employee-locations', auth)).json()).assignments).toContainEqual({ employee_id: employee.id, location_id: 'west' });
  expect((await request.post(org + '/employee-locations', { ...auth, data: { employeeId: employee.id, locationId: 'south' } })).status()).toBe(201);
  expect((await request.delete(org + '/employee-locations/' + employee.id + '/west', auth)).status()).toBe(200);
  const own = await playwright.request.newContext({ baseURL });
  try {
    const ownAuth = await session(own, employeeEmail);
    expect((await (await own.get(org + '/locations', ownAuth)).json()).locations.map(({ id }) => id)).toEqual(['north', 'south']);
    expect((await own.get(org + '/locations/west', ownAuth)).status()).toBe(404);
  } finally { await own.dispose(); }
});

test('cross-branch overlap is atomic and scheduled records prevent unsafe removal', async ({ request }) => {
  const auth = await session(request, ownerEmail);
  const shift = { employeeId: 'shared', startsAt: '2033-03-08T09:00:00Z', endsAt: '2033-03-08T17:00:00Z' };
  const responses = await Promise.all(['north', 'south'].map(locationId => request.post(org + '/shifts', { ...auth, data: { ...shift, locationId } })));
  expect(responses.map(response => response.status()).sort()).toEqual([201, 409]);
  const booked = responses[0].status() === 201 ? 'north' : 'south';
  expect((await request.post(org + '/locations/' + booked + '/archive', { ...auth, data: {} })).status()).toBe(409);
  expect((await request.delete(org + '/employee-locations/shared/' + booked, auth)).status()).toBe(409);
  expect((await request.post(org + '/shifts', { ...auth, data: { ...shift, locationId: booked, breakMinutes: 480 } })).status()).toBe(422);
});

test('branch detail can be opened directly, edited and refreshed on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/shop/locations/west');
  await page.getByLabel('Email address').fill(ownerEmail);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'West' })).toBeVisible();
  await page.getByLabel('Location name').fill('West branch');
  await page.getByRole('button', { name: 'Save location' }).click();
  await expect(page.getByRole('heading', { name: 'West branch' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Location name')).toHaveValue('West branch');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});
