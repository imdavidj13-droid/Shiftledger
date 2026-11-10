import { expect, test } from '@playwright/test';
import { coverEmail, employeeEmail, fixtureSessions, managerEmail, ownerEmail } from './fixtures.mjs';

const root = '/api/v1/organisations/shop';
const path = root + '/timesheets';
const auth = (email: keyof typeof fixtureSessions) => ({ headers: { Cookie: 'sl_session=' + fixtureSessions[email] } });
const owner = auth(ownerEmail), manager = auth(managerEmail), employee = auth(employeeEmail), cover = auth(coverEmail);

test('staff punches, paid and unpaid breaks, and manager approval enforce ownership and concurrency', async ({ request }) => {
  const now = Date.now();
  const published = await request.post(root + '/shifts', { ...manager, data: {
    locationId:'north', employeeId:'shared', startsAt:new Date(now-30*60_000).toISOString(),
    endsAt:new Date(now+4*3600_000).toISOString(), breakMinutes:30
  } });
  expect(published.status()).toBe(201);
  const { shift } = await published.json();
  expect((await request.post(root + '/shifts/' + shift.id + '/publish', { ...manager, data: { revision: 1 } })).status()).toBe(200);
  expect((await request.post(path + '/clock-in', { ...employee, data: { locationId:'west' } })).status()).toBe(409);
  expect((await request.post(path + '/clock-in', { ...cover, data: { locationId:'south', shiftId:shift.id } })).status()).toBe(409);
  expect((await request.post(path + '/clock-in', { ...manager, data: { locationId:'north', shiftId:shift.id } })).status()).toBe(403);

  const starts = await Promise.all([1,2].map(() => request.post(path + '/clock-in', { ...employee, data: {
    locationId:'north', shiftId:shift.id
  } })));
  expect(starts.map(response => response.status()).sort()).toEqual([201,409]);
  const { entry } = await starts.find(response => response.status() === 201)!.json();
  const detail = path + '/' + entry.id;
  expect((await request.get(detail, cover)).status()).toBe(404);
  expect((await request.get('/api/v1/organisations/other/timesheets/' + entry.id, owner)).status()).toBe(404);
  expect((await request.post(detail + '/break-end', cover)).status()).toBe(404);
  expect((await request.post(detail + '/approve', { ...manager, data: { revision: 1 } })).status()).toBe(409);
  expect((await request.post(detail + '/break-start', { ...employee, data: { kind:'paid' } })).status()).toBe(200);
  expect((await request.post(detail + '/break-start', { ...employee, data: { kind:'unpaid' } })).status()).toBe(409);
  expect((await request.post(detail + '/clock-out', employee)).status()).toBe(409);
  expect((await request.post(detail + '/break-end', employee)).status()).toBe(200);
  expect((await request.post(detail + '/break-start', { ...employee, data: { kind:'unpaid' } })).status()).toBe(200);
  expect((await request.post(detail + '/break-end', employee)).status()).toBe(200);
  expect((await request.post(detail + '/clock-out', employee)).status()).toBe(200);
  expect((await request.post(detail + '/clock-out', employee)).status()).toBe(409);
  const { entry: submitted, breaks, history } = await (await request.get(detail, manager)).json();
  expect(submitted).toMatchObject({ status:'submitted', revision:6, shift_id:shift.id, scheduled_unpaid_minutes:30 });
  expect(breaks.map(({kind}) => kind)).toEqual(['paid','unpaid']);
  expect(history.map(({action}) => action)).toContain('clock_out');
  expect((await (await request.get(detail, employee)).json()).history).toEqual([]);
  expect((await request.post(detail + '/approve', { ...employee, data: { revision: 6 } })).status()).toBe(403);
  const approval = await Promise.all([1,2].map(() => request.post(detail + '/approve', { ...manager, data: { revision: 6 } })));
  expect(approval.map(response => response.status()).sort()).toEqual([200,409]);
  expect((await request.patch(detail, { ...manager, data: {
    clockIn:submitted.clock_in_utc, clockOut:submitted.clock_out_utc, reason:'Locked record', revision:7
  } })).status()).toBe(409);
});

test('manager correction closes an open break with a reason and branch checks', async ({ request }) => {
  const start = await request.post(path + '/clock-in', { ...cover, data: { locationId:'south' } });
  expect(start.status()).toBe(201);
  const { entry } = await start.json();
  const detail = path + '/' + entry.id;
  expect((await request.post(detail + '/break-start', { ...cover, data: { kind:'unpaid' } })).status()).toBe(200);
  const current = await request.get(detail, owner);
  const { breaks } = await current.json();
  const data = { endedAt:new Date().toISOString(), revision:2, reason:'Employee missed the end punch' };
  expect(Date.parse(data.endedAt)).toBeGreaterThan(Date.parse(breaks[0].started_at_utc));
  expect((await request.post(detail + '/close-break', { ...cover, data })).status()).toBe(403);
  expect((await request.post(detail + '/close-break', { ...manager, data })).status()).toBe(404);
  expect((await request.post(detail + '/close-break', { ...owner, data: { ...data, revision:1 } })).status()).toBe(409);
  expect((await request.post(detail + '/close-break', { ...owner, data })).status()).toBe(200);
  expect((await request.post(detail + '/clock-out', cover)).status()).toBe(200);
  const persisted = await (await request.get(detail, owner)).json();
  expect(persisted.breaks[0].ended_at_utc).toBe(data.endedAt);
  expect(persisted.history.map(({action}) => action)).toContain('correct_break_end');
});

test('manager records and corrects missed punches and reopens approved timesheet by its URL', async ({ page, request, baseURL }) => {
  await page.context().addCookies([{ name: 'sl_session', value: fixtureSessions[managerEmail], url: baseURL! }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/shop/timesheets?from=2026-02-01&to=2026-02-07&location=north');
  await page.getByRole('link', { name:'Record missed punches' }).click();
  await page.getByRole('combobox', { name:'Employee', exact:true }).selectOption('shared');
  await page.getByLabel('Clock in', { exact:true }).fill('2026-02-02T09:00');
  await page.getByLabel('Clock out', { exact:true }).fill('2026-02-02T17:00');
  await page.getByLabel('Correction reason').fill('Both punches missed');
  await page.getByRole('button', { name:'Save timesheet' }).click();
  await expect(page.getByRole('heading', { name:'Shared employee timesheet' })).toBeVisible();
  await expect(page.getByText('Actual paid time 8 h')).toBeVisible();
  expect((await request.post(path, { ...owner, data: {
    locationId:'south', employeeId:'shared', clockIn:'2026-02-02T10:00:00Z', clockOut:'2026-02-02T18:00:00Z', reason:'Overlapping'
  } })).status()).toBe(409);
  await page.getByLabel('Clock out', { exact:true }).fill('2026-02-02T16:00');
  await page.getByLabel('Correction reason').fill('Corrected finish time');
  await page.getByRole('button', { name:'Save timesheet' }).click();
  await expect(page.getByText('Actual paid time 7 h')).toBeVisible();
  await expect(page.getByText('Corrected finish time', { exact:true })).toBeVisible();
  await page.getByRole('button', { name:'Approve and lock timesheet' }).click();
  await expect(page.getByText('Approved', { exact:true })).toBeVisible();
  await expect(page.getByRole('heading', { name:'Correct punches' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Approved', { exact:true })).toBeVisible();
  await page.getByRole('link', { name:'Back to timesheets' }).click();
  await expect(page.getByRole('link', { name:/Shared employee.*Approved/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
