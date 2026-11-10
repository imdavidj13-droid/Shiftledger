import { expect, test, type APIRequestContext } from '@playwright/test';
import { coverEmail, employeeEmail, fixtureSessions, managerEmail, ownerEmail } from './fixtures.mjs';

const root = '/api/v1/organisations/shop', path = root + '/shift-swaps';
const auth = (email: keyof typeof fixtureSessions) => ({ headers: { Cookie: 'sl_session=' + fixtureSessions[email] } });
const owner = auth(ownerEmail), manager = auth(managerEmail), employee = auth(employeeEmail), cover = auth(coverEmail);

async function publish(request: APIRequestContext, employeeId: string, locationId: string, date: string) {
  const created = await request.post(root + '/shifts', { ...owner, data: {
    employeeId, locationId, startsAt: date + 'T09:00:00Z', endsAt: date + 'T17:00:00Z'
  } });
  expect(created.status()).toBe(201);
  const { shift } = await created.json();
  expect((await request.post(root + '/shifts/' + shift.id + '/publish', { ...owner, data: { revision:1 } })).status()).toBe(200);
  return shift.id as string;
}

test('cross-branch swaps require employee consent and recheck eligibility atomically', async ({ request }) => {
  const offered = await publish(request,'shared','north','2041-02-18');
  const requested = await publish(request,'cover-staff','south','2041-02-19');
  const payload = { offeredShiftId:offered, requestedShiftId:requested };
  expect((await request.post(path,{ ...employee, data:payload })).status()).toBe(409);
  expect((await request.post(root + '/employee-locations',{ ...owner, data:{ employeeId:'cover-staff', locationId:'north' } })).status()).toBe(201);
  expect((await request.post(path,{ ...manager, data:{ ...payload, confirmedConsent:true } })).status()).toBe(409);
  expect((await request.post(path,{ ...manager, data:{
    offeredShiftId:requested, requestedShiftId:offered, confirmedConsent:true
  } })).status()).toBe(409);
  expect((await request.post(path,{ ...cover, data:payload })).status()).toBe(409);

  const proposals = await Promise.all([1,2].map(() => request.post(path,{ ...employee, data:{ ...payload, confirmedConsent:true } })));
  expect(proposals.map(response => response.status()).sort()).toEqual([201,409]);
  const { swap } = await proposals.find(response => response.status() === 201)!.json();
  expect(swap.status).toBe('awaiting_employee');
  const detail = path + '/' + swap.id;
  expect((await request.get(detail,manager)).status()).toBe(404);
  expect((await request.get('/api/v1/organisations/other/shift-swaps/' + swap.id,owner)).status()).toBe(404);
  expect((await request.post(detail + '/approve',owner)).status()).toBe(409);
  expect((await request.post(detail + '/accept',employee)).status()).toBe(409);
  expect((await request.post(detail + '/accept',cover)).status()).toBe(200);
  expect((await request.post(detail + '/approve',manager)).status()).toBe(404);

  const createLeave = await request.post(root + '/leave',{ ...cover,data:{
    kind:'holiday',locationId:'north',firstDate:'2041-02-18',lastDate:'2041-02-18'
  } });
  expect(createLeave.status()).toBe(201);
  const leave = root + '/leave/' + (await createLeave.json()).request.id;
  expect((await request.post(leave + '/approve',{...owner,data:{}})).status()).toBe(200);
  expect((await request.post(detail + '/approve',owner)).status()).toBe(409);
  expect((await (await request.get(root + '/shifts/' + offered,owner)).json()).shift.employee_id).toBe('shared');
  expect((await request.post(leave + '/cancel',owner)).status()).toBe(200);
  const approvals = await Promise.all([1,2].map(() => request.post(detail + '/approve',owner)));
  expect(approvals.map(response => response.status()).sort()).toEqual([200,409]);
  expect((await (await request.get(root + '/shifts/' + offered,cover)).json()).shift).toMatchObject({employee_id:'cover-staff',revision:3});
  expect((await (await request.get(root + '/shifts/' + requested,employee)).json()).shift).toMatchObject({employee_id:'shared',revision:3});
});

test('owner records an agreed swap, approves it and opens both revised shifts', async ({ page, request, baseURL }) => {
  const offered = await publish(request,'shared','south','2042-09-16');
  const requested = await publish(request,'cover-staff','south','2042-09-17');
  await page.context().addCookies([{ name:'sl_session', value:fixtureSessions[ownerEmail], url:baseURL! }]);
  await page.goto('/app/shop/shift-swaps?location=south');
  await page.getByRole('link',{name:'Record agreed swap'}).click();
  await page.getByLabel('Search shifts from').fill('2042-09-15');
  await page.getByRole('combobox',{name:'Offered shift',exact:true}).selectOption(offered);
  await page.getByRole('combobox',{name:'Requested shift',exact:true}).selectOption(requested);
  await page.getByRole('checkbox',{name:/Both employees/}).check();
  await page.getByRole('button',{name:'Record swap for review'}).click();
  await expect(page).toHaveURL(/\/shift-swaps\/[a-f0-9-]+\?location=south$/);
  await page.getByRole('button',{name:'Approve swap'}).click();
  await expect(page.getByText('Approved',{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByText('Approved',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:/Offered by Shared employee/}).click();
  await expect(page.getByRole('heading',{name:'Cover Employee',exact:true})).toBeVisible();
});
