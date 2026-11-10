import { expect, test } from '@playwright/test';
import { employeeEmail, fixtureSessions, managerEmail, ownerEmail, password } from './fixtures.mjs';

const path = '/api/v1/organisations/shop/shifts';
const session = (email: keyof typeof fixtureSessions) => ({ headers: { Cookie: 'sl_session=' + fixtureSessions[email] } });
const owner = session(ownerEmail), manager = session(managerEmail), employee = session(employeeEmail);
const shiftData = { locationId: 'north', employeeId: 'shared', startsAt: '2034-10-30T22:00:00Z', endsAt: '2034-10-31T05:00:00Z', breakMinutes: 20 };

test('draft edits check revisions and both branch permissions; employee sees only their published shifts', async ({ request }) => {
  expect((await request.post(path, { ...employee, data: shiftData })).status()).toBe(403);
  const create = await request.post(path, { ...manager, data: shiftData });
  expect(create.status()).toBe(201);
  const { shift } = await create.json();
  const detail = path + '/' + shift.id;
  expect((await request.get(detail, employee)).status()).toBe(404);
  expect((await request.patch(detail, { ...manager, data: { ...shiftData, locationId: 'south', revision: 1 } })).status()).toBe(403);
  const edits = await Promise.all([1, 2].map(() =>
    request.patch(detail, { ...manager, data: { ...shiftData, breakMinutes: 30, revision: 1 } })));
  expect(edits.map(response => response.status()).sort()).toEqual([200, 409]);
  expect((await request.patch(detail, { ...owner, data: { ...shiftData, revision: 1 } })).status()).toBe(409);
  const publish = await request.post(detail + '/publish', { ...manager, data: { revision: 2 } });
  expect(publish.status()).toBe(200);
  expect((await (await request.get(detail, employee)).json()).shift).toMatchObject({
    status: 'published', revision: 3, unpaid_break_minutes: 30, location_name: 'North'
  });
  expect((await request.get(detail, session('join@example.test'))).status()).toBe(404);
  expect((await request.post(detail + '/publish', { ...manager, data: { revision: 2 } })).status()).toBe(409);
  expect((await request.post(detail + '/discard', { ...owner, data: { revision: 3 } })).status()).toBe(409);
  expect((await request.post(detail + '/cancel', { ...manager, data: { revision: 3 } })).status()).toBe(200);
  expect((await request.get(detail, employee)).status()).toBe(404);
  expect((await (await request.get(detail, owner)).json()).shift).toMatchObject({ status: 'cancelled', revision: 4 });
});

test('range queries include shifts crossing midnight and enforce branch and tenant scope', async ({ request }) => {
  const data = { ...shiftData, employeeId: null, locationId: 'south', startsAt: '2035-01-02T23:30:00Z', endsAt: '2035-01-03T01:00:00Z' };
  const create = await request.post(path, { ...owner, data });
  expect(create.status()).toBe(201);
  const { shift } = await create.json();
  const detail = path + '/' + shift.id;
  const ranged = path + '?from=2035-01-03T00:00:00Z&to=2035-01-04T00:00:00Z&location=south';
  expect((await (await request.get(ranged, owner)).json()).shifts.map(({ id }) => id)).toEqual([shift.id]);
  expect((await (await request.get(ranged, manager)).json()).shifts).toEqual([]);
  expect((await request.get(detail, manager)).status()).toBe(404);
  expect((await request.get('/api/v1/organisations/other/shifts/' + shift.id, owner)).status()).toBe(404);
  expect((await request.get(path + '?from=2035-02-29T00:00:00Z&to=2035-03-04T00:00:00Z', owner)).status()).toBe(422);
  expect((await request.post(detail + '/discard', { ...owner, data: { revision: 1 } })).status()).toBe(200);
  expect((await request.get(detail, owner)).status()).toBe(404);
});

test('mobile week and shift URLs support direct entry, publishing and refresh', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/shop/schedule?week=2031-11-03&location=north');
  await page.getByLabel('Email address').fill(ownerEmail);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Weekly rota' })).toBeVisible();
  await page.getByRole('link', { name: 'Create draft shift' }).click();
  await expect(page).toHaveURL(/\/schedule\/new\?week=2031-11-03&location=north$/);
  await expect(page.getByRole('combobox', { name: 'Location', exact: true })).toHaveValue('north');
  await page.getByRole('combobox', { name: 'Employee', exact: true }).selectOption('shared');
  await page.getByLabel('Start', { exact: true }).fill('2031-11-05T09:00');
  await page.getByLabel('End', { exact: true }).fill('2031-11-05T17:00');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Shared employee' })).toBeVisible();
  await page.getByRole('button', { name: 'Publish shift' }).click();
  await expect(page.getByRole('button', { name: 'Cancel shift' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Cancel shift' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to rota' }).click();
  await expect(page.getByRole('link', { name: /Shared employee/ })).toBeVisible();
  await expect(page).toHaveURL(/\/schedule\?week=2031-11-03&location=north$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
