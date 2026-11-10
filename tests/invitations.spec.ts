import { expect, test } from '@playwright/test';
import { fixtureSessions, ownerEmail, managerEmail, password } from './fixtures.mjs';

const org = '/api/v1/organisations/shop';
const path = org + '/invitations';
const accept = '/api/v1/invitations/accept';
const auth = (email: keyof typeof fixtureSessions) => ({ headers: { Cookie: 'sl_session=' + fixtureSessions[email] } });
const owner = auth(ownerEmail);
const employee = auth('join@example.test');
const manager = auth('joining-manager@example.test');

test('only the invited verified account can consume an employee link and link the existing record', async ({ request }) => {
  expect((await request.post(path, { ...auth(managerEmail), data: { email: 'join@example.test', role: 'employee' } })).status()).toBe(403);
  expect((await request.post(path, { ...owner, data: { email: 'join@example.test', role: 'employee', employeeId: 'foreign-employee' } })).status()).toBe(409);
  const created = await request.post(path, { ...owner, data: { email: 'join@example.test', role: 'employee', employeeId: 'south-only', locationIds: ['west'] } });
  expect(created.status()).toBe(201);
  const { invitation } = await created.json();
  expect((await request.post(path, { ...owner, data: { email: 'join@example.test', role: 'employee' } })).status()).toBe(409);
  expect(await (await request.get(path, owner)).text()).not.toContain(invitation.token);
  expect((await request.post(accept, { data: { token: invitation.token } })).status()).toBe(401);
  expect((await request.post(accept, { ...manager, data: { token: invitation.token } })).status()).toBe(404);
  const renewed = await request.post(path + '/' + invitation.id + '/renew', { ...owner, data: {} });
  expect(renewed.status()).toBe(200);
  const { invitation: replacement } = await renewed.json();
  expect((await request.post(accept, { ...employee, data: { token: invitation.token } })).status()).toBe(404);
  const results = await Promise.all([1, 2].map(() => request.post(accept, { ...employee, data: { token: replacement.token } })));
  expect(results.map(response => response.status()).sort()).toEqual([200, 404]);
  expect((await (await request.get(org + '/locations', employee)).json()).locations.map(({ id }) => id)).toEqual(['south', 'west']);
  const employees = (await (await request.get(org + '/employees', owner)).json()).employees;
  expect(employees.filter(({ user_id }) => user_id === 'join-user')).toEqual([
    { id: 'south-only', display_name: 'South only', employment_status: 'active', user_id: 'join-user' }
  ]);
});

test('manager invites are branch-scoped, revocable and refresh-safe through the sign-in screen', async ({ request, page }) => {
  const data = { email: 'joining-manager@example.test', role: 'manager', locationIds: ['north', 'west'] };
  expect((await request.post(path, { ...owner, data: { ...data, locationIds: [] } })).status()).toBe(422);
  expect((await request.post(path, { ...owner, data: { ...data, locationIds: ['foreign'] } })).status()).toBe(409);
  const response = await request.post(path, { ...owner, data });
  expect(response.status()).toBe(201);
  const { invitation } = await response.json();
  expect((await request.post(path + '/' + invitation.id + '/revoke', { ...owner, data: {} })).status()).toBe(200);
  expect((await request.post(accept, { ...manager, data: { token: invitation.token } })).status()).toBe(404);
  const fresh = await request.post(path, { ...owner, data });
  expect(fresh.status()).toBe(201);
  const token = (await fresh.json()).invitation.token;

  await page.goto('/join?token=' + token);
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  await page.getByLabel('Email address').fill(data.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Join your organisation' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(page).toHaveURL(/\/app\/shop\/overview$/);
  await expect(page.getByRole('heading', { name: 'Your workforce, organised.' })).toBeVisible();

  const locations = await request.get(org + '/locations', manager);
  expect((await locations.json()).locations.map(({ id }) => id)).toEqual(['north', 'west']);
  expect((await request.get(org + '/locations/south', manager)).status()).toBe(404);
  expect((await request.get('/api/v1/organisations/other', manager)).status()).toBe(404);
  expect((await request.patch(org + '/members/owner', { ...owner, data: { status: 'suspended' } })).status()).toBe(403);
  expect((await request.patch(org + '/members/join-manager', { ...owner, data: { status: 'suspended' } })).status()).toBe(200);
  expect((await request.get(org + '/locations', manager)).status()).toBe(404);
  expect((await request.patch(org + '/members/join-manager', { ...owner, data: { status: 'active' } })).status()).toBe(200);
  expect((await request.get(org + '/locations', manager)).status()).toBe(200);
});
