import { expect, test } from '@playwright/test';
import { coverEmail, employeeEmail, fixtureSessions, managerEmail, ownerEmail } from './fixtures.mjs';

const root = '/api/v1/organisations/shop';
const path = root + '/leave';
const auth = (email: keyof typeof fixtureSessions) => ({ headers: { Cookie: 'sl_session=' + fixtureSessions[email] } });
const owner = auth(ownerEmail), manager = auth(managerEmail), employee = auth(employeeEmail), cover = auth(coverEmail);
const requestData = { locationId: 'north', kind: 'holiday', firstDate: '2038-03-28', lastDate: '2038-03-28' };

test('leave enforces branch, tenant and employee ownership, and prevents duplicate requests', async ({ request }) => {
  expect((await request.get(path)).status()).toBe(401);
  expect((await request.post(path, { ...cover, data: requestData })).status()).toBe(404);
  expect((await request.post(path, { ...employee, data: { ...requestData, employeeId: 'cover-staff' } })).status()).toBe(422);
  expect((await request.post(path, { ...manager, data: { ...requestData, locationId: 'south', employeeId: 'shared' } })).status()).toBe(404);
  expect((await request.post(path, { ...employee, data: { ...requestData, firstDate: '2038-02-29' } })).status()).toBe(422);

  const submissions = await Promise.all([1,2].map(() => request.post(path, { ...employee, data: requestData })));
  expect(submissions.map(response => response.status()).sort()).toEqual([201,409]);
  const { request: leave } = await submissions.find(response => response.status() === 201)!.json();
  const detail = path + '/' + leave.id;
  expect((await request.get(detail, cover)).status()).toBe(404);
  expect((await request.get('/api/v1/organisations/other/leave/' + leave.id, owner)).status()).toBe(404);
  expect((await request.post(detail + '/approve', employee)).status()).toBe(403);

  const crossing = { locationId: 'south', employeeId: 'shared', startsAt: '2038-03-28T22:00:00Z', endsAt: '2038-03-29T00:30:00Z' };
  const shift = await request.post(root + '/shifts', { ...owner, data: crossing });
  expect(shift.status()).toBe(201);
  expect((await (await request.get(detail, manager)).json()).request).toMatchObject({ status: 'pending', shift_conflict: 1 });
  expect((await request.post(detail + '/approve', { ...manager, data: {} })).status()).toBe(409);
  const decisions = await Promise.all([1,2].map(() => request.post(detail + '/approve', {
    ...manager, data: { acknowledgeShiftConflict: true }
  })));
  expect(decisions.map(response => response.status()).sort()).toEqual([200,409]);
  expect((await (await request.get(detail, employee)).json()).request.status).toBe('approved');
  expect((await request.post(detail + '/cancel', employee)).status()).toBe(409);
  expect((await request.post(root + '/shifts/' + (await shift.json()).shift.id + '/publish', {
    ...owner, data: { revision: 1 }
  })).status()).toBe(409);

  const within = { locationId: 'north', startsAt: '2038-03-28T08:00:00Z', endsAt: '2038-03-28T17:00:00Z' };
  expect((await request.post(root + '/shifts', { ...manager, data: { ...within, employeeId: 'shared' } })).status()).toBe(409);
  const vacancy = await request.post(root + '/shifts', { ...manager, data: { ...within, isOpen: true } });
  expect(vacancy.status()).toBe(201);
  const open = root + '/shifts/' + (await vacancy.json()).shift.id;
  expect((await request.post(open + '/publish', { ...manager, data: { revision: 1 } })).status()).toBe(200);
  expect((await request.post(open + '/claims', employee)).status()).toBe(409);

  const after = { ...within, employeeId: 'shared', startsAt: '2038-03-29T01:00:00Z', endsAt: '2038-03-29T08:00:00Z' };
  expect((await request.post(root + '/shifts', { ...manager, data: after })).status()).toBe(201);
  expect((await request.post(detail + '/cancel', manager)).status()).toBe(200);
  expect((await request.post(open + '/claims', employee)).status()).toBe(201);
});

test('manager records, opens, approves and filters persisted leave on mobile', async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: 'sl_session', value: fixtureSessions[managerEmail], url: baseURL! }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/shop/leave?location=north');
  await page.getByRole('link', { name: 'Record leave request' }).click();
  await page.getByRole('combobox', { name: 'Employee', exact: true }).selectOption('shared');
  await page.getByLabel('First day', { exact: true }).fill('2039-02-02');
  await page.getByLabel('Last day (inclusive)').fill('2039-02-04');
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(page.getByRole('heading', { name: 'Holiday request' })).toBeVisible();
  await expect(page).toHaveURL(/\/leave\/[a-f0-9-]+\?location=north$/);
  await page.getByRole('button', { name: 'Approve leave' }).click();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to leave' }).click();
  await page.getByLabel('Request status').selectOption('approved');
  await expect(page).toHaveURL(/location=north&status=approved$/);
  await expect(page.getByRole('link', { name: /Shared employee.*Holiday/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
