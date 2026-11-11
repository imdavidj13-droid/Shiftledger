import { expect, test } from '@playwright/test';
import { employeeEmail, fixtureSessions, managerEmail, ownerEmail } from './fixtures.mjs';

const root = '/api/v1/organisations/shop', path = root + '/shift-templates';
const auth = (email: keyof typeof fixtureSessions) => ({ headers: { Cookie:'sl_session=' + fixtureSessions[email] } });
const owner = auth(ownerEmail), manager = auth(managerEmail), employee = auth(employeeEmail);
const preset = { name:'Weekend close', locationId:'south', startTime:'20:00', endTime:'04:00', endDayOffset:1, breakMinutes:30 };

test('template mutations check both branches, revisions and active names', async ({ request }) => {
  expect((await request.post(path,{...employee,data:preset})).status()).toBe(403);
  expect((await request.post(path,{...manager,data:preset})).status()).toBe(409);
  expect((await request.post(path,{...owner,data:{...preset,endDayOffset:0}})).status()).toBe(422);
  const created = await request.post(path,{...owner,data:preset});
  expect(created.status()).toBe(201);
  const { template } = await created.json();
  const detail = path + '/' + template.id;
  expect((await request.get(detail,manager)).status()).toBe(404);
  expect((await request.get('/api/v1/organisations/other/shift-templates/' + template.id,owner)).status()).toBe(404);
  expect((await request.post(path,{...owner,data:{...preset,name:'weekend close'}})).status()).toBe(409);
  expect((await request.patch(detail,{...manager,data:{...preset,locationId:'north',revision:1}})).status()).toBe(409);
  const changes = await Promise.all([1,2].map(() => request.patch(detail,{...owner,data:{...preset,revision:1,breakMinutes:40}})));
  expect(changes.map(response=>response.status()).sort()).toEqual([200,409]);
  expect((await request.post(detail + '/archive',{...owner,data:{revision:2}})).status()).toBe(200);
  expect((await request.get(detail,owner)).status()).toBe(404);
  expect((await request.post(path,{...owner,data:preset})).status()).toBe(201);
});

test('manager creates and reuses a persisted overnight template from the rota', async ({ page, baseURL }) => {
  await page.context().addCookies([{ name:'sl_session', value:fixtureSessions[managerEmail], url:baseURL! }]);
  await page.goto('/app/shop/schedule?view=day&date=2045-01-09&location=north');
  await page.getByRole('link',{name:'Shift templates',exact:true}).click();
  await page.getByRole('link',{name:'New template'}).click();
  await page.getByLabel('Template name').fill('Night cover');
  await page.getByLabel('Local start time').fill('22:00');
  await page.getByLabel('Local end time').fill('06:00');
  await page.getByLabel('Ends the following day').check();
  await page.getByLabel('Unpaid break (minutes)',{exact:true}).fill('45');
  await page.getByRole('button',{name:'Save template'}).click();
  await expect(page.getByRole('heading',{name:'Edit shift template'})).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Template name')).toHaveValue('Night cover');
  await page.getByRole('link',{name:'Use template in a draft'}).click();
  await expect(page.getByLabel('Start',{exact:true})).toHaveValue(/2045-01-09T22:00/);
  await expect(page.getByLabel('End',{exact:true})).toHaveValue(/2045-01-10T06:00/);
  await expect(page.getByLabel('Unpaid break (minutes)',{exact:true})).toHaveValue('45');
  await page.getByRole('combobox',{name:'Employee',exact:true}).selectOption('shared');
  await page.getByLabel('Save without publishing').check();
  await page.getByRole('button',{name:'Save shift without publishing'}).click();
  await expect(page.getByRole('dialog',{name:'Add shift'})).toHaveCount(0);
  await expect(page).toHaveURL(/inspect=/);
  await page.getByRole('link',{name:'Edit / details'}).click();
  await expect(page.getByRole('heading',{name:'Shared employee',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Publish shift'})).toBeVisible();
});
