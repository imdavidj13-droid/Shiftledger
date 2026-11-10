import { expect, test } from '@playwright/test';
import { employeeEmail, fixtureSessions, managerEmail, ownerEmail } from './fixtures.mjs';

const root = '/api/v1/organisations/shop';
const auth = (email: keyof typeof fixtureSessions) => ({ headers: { Cookie:'sl_session=' + fixtureSessions[email] } });
const owner = auth(ownerEmail), manager = auth(managerEmail), employee = auth(employeeEmail);

test('staff profile edits preserve shared identity and enforce tenant and branch access', async ({ request }) => {
  const created = await request.post(root + '/employees', { ...owner, data:{ name:'Profile fixture', locationId:'west' } });
  expect(created.status()).toBe(201);
  const { employee: record } = await created.json();
  const path = root + '/employees/' + record.id;
  expect((await request.get(path, manager)).status()).toBe(404);
  expect((await request.get(path, employee)).status()).toBe(403);
  expect((await request.get('/api/v1/organisations/other/employees/' + record.id, owner)).status()).toBe(404);
  expect((await request.patch(path, { ...manager, data:{ displayName:'Wrong', employmentStatus:'active' } })).status()).toBe(403);
  const data = { displayName:'Profile edited', employmentStatus:'active', department:'Operations', position:'Team lead', primaryLocationId:'west' };
  expect((await request.patch(path, { ...owner, data:{ ...data, primaryLocationId:'north' } })).status()).toBe(409);
  expect((await request.patch(path, { ...owner, data })).status()).toBe(200);
  expect((await request.post(root + '/employee-locations', { ...owner, data:{ employeeId:record.id, locationId:'north' } })).status()).toBe(201);
  const scoped = await request.get(path, manager);
  expect(scoped.status()).toBe(200);
  expect(await scoped.json()).toMatchObject({ employee:{ id:record.id, primary_location_id:null, department:'Operations' },
    branches:[{ id:'north', name:'North' }] });
  expect((await request.delete(root + '/employee-locations/' + record.id + '/west', owner)).status()).toBe(200);
  expect((await (await request.get(path, owner)).json()).employee.primary_location_id).toBeNull();

  const shift = { employeeId:record.id, locationId:'north', startsAt:'2043-01-03T09:00:00Z', endsAt:'2043-01-03T17:00:00Z' };
  const draft = await request.post(root + '/shifts', { ...owner, data:shift });
  expect(draft.status()).toBe(201);
  const inactive = { ...data, employmentStatus:'inactive', primaryLocationId:null };
  expect((await request.patch(path, { ...owner, data:inactive })).status()).toBe(409);
  const draftPath = root + '/shifts/' + (await draft.json()).shift.id;
  expect((await request.post(draftPath + '/discard', { ...owner, data:{ revision:1 } })).status()).toBe(200);
  expect((await request.patch(path, { ...owner, data:inactive })).status()).toBe(200);
  expect((await request.post(root + '/shifts', { ...owner, data:shift })).status()).toBe(422);
});

test('owner opens a staff profile from Team and edits details on a permanent URL', async ({ page, request, baseURL }) => {
  const created = await request.post(root + '/employees', { ...owner, data:{ name:'Mobile profile fixture', locationId:'north' } });
  expect(created.status()).toBe(201);
  await page.context().addCookies([{ name:'sl_session', value:fixtureSessions[ownerEmail], url:baseURL! }]);
  await page.setViewportSize({ width:390, height:844 });
  await page.goto('/app/shop/team?location=north');
  await page.getByRole('link', { name:'Mobile profile fixture', exact:true }).click();
  await expect(page).toHaveURL(/\/team\/[a-f0-9-]+\?location=north$/);
  await page.getByLabel('Department', { exact:true }).fill('Customer operations');
  await page.getByLabel('Position', { exact:true }).fill('Branch lead');
  await page.getByRole('combobox', { name:'Primary branch', exact:true }).selectOption('north');
  await page.getByRole('button', { name:'Save staff profile' }).click();
  await expect(page.getByRole('status')).toHaveText('Staff profile saved.');
  await page.reload();
  await expect(page.getByLabel('Position', { exact:true })).toHaveValue('Branch lead');
  await expect(page.getByRole('combobox', { name:'Primary branch', exact:true })).toHaveValue('north');
  await page.getByRole('link', { name:'Back to team' }).click();
  await expect(page).toHaveURL(/\/team\?location=north$/);
});
