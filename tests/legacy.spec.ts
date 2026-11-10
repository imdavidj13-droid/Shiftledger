import { expect, test } from '@playwright/test';
import { fixtureSessions, ownerEmail } from './fixtures.mjs';

test('current Worker keeps core workflows working against pre-feature D1', async ({ request }) => {
  const headers = { Cookie:'sl_session=' + fixtureSessions[ownerEmail] };
  const org = '/api/v1/organisations/shop';
  const ready = await request.get('/api/v1/ready');
  expect(ready.status()).toBe(200);
  expect((await ready.json()).features).toEqual({
    openShifts:false, leave:false, timekeeping:false, shiftSwaps:false, staffProfiles:false, shiftTemplates:false
  });
  expect((await request.get('/api/v1/auth/me',{headers})).status()).toBe(200);
  const staff = await request.get(org + '/employees/shared',{headers});
  expect(staff.status()).toBe(200);
  expect((await staff.json()).profiles).toBe(false);

  const data = { locationId:'north', startsAt:'2044-02-04T09:00:00Z', endsAt:'2044-02-04T17:00:00Z' };
  expect((await request.post(org + '/shifts',{headers,data:{...data,isOpen:true}})).status()).toBe(503);
  const created = await request.post(org + '/shifts',{headers,data});
  expect(created.status()).toBe(201);
  const { shift } = await created.json();
  expect((await request.post(org + '/shifts/' + shift.id + '/publish',{headers,data:{revision:1}})).status()).toBe(200);
  const rota = await request.get(org + '/shifts?from=2044-02-04T00:00:00Z&to=2044-02-05T00:00:00Z',{headers});
  expect((await rota.json()).shifts).toMatchObject([{id:shift.id,status:'published',is_open:0}]);
  for (const module of ['leave','timesheets','shift-swaps','shift-templates']) {
    expect((await request.get(org + '/' + module,{headers})).status()).toBe(503);
  }
});
