import { expect, test } from '@playwright/test';
import { coverEmail, employeeEmail, fixtureSessions, managerEmail, ownerEmail, password } from './fixtures.mjs';

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
  await page.goto('/app/shop/schedule?view=week&week=2031-11-03&location=north');
  await page.getByLabel('Email address').fill(ownerEmail);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Week of/ })).toBeVisible();
  await page.getByRole('button', { name: /Add shift/ }).click();
  await page.getByRole('link', { name: 'Add assigned shift' }).click();
  await expect(page).toHaveURL(/\/schedule\/new\?view=day&date=2031-11-03&location=north$/);
  await expect(page.getByRole('dialog', { name: 'Add shift' })).toBeVisible();
  await expect(page.locator('.slc-grid-month')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Location', exact: true })).toHaveValue('north');
  await page.getByRole('combobox', { name: 'Employee', exact: true }).selectOption('shared');
  await page.getByLabel('Start', { exact: true }).fill('2031-11-03T09:00');
  await page.getByLabel('End', { exact: true }).fill('2031-11-03T17:00');
  await page.getByLabel('Save without publishing').check();
  await page.getByRole('button', { name: 'Save shift without publishing' }).click();
  await expect(page.getByRole('dialog', { name: 'Add shift' })).toHaveCount(0);
  await expect(page).toHaveURL(/inspect=/);
  await page.getByRole('link', { name: 'Edit / details' }).click();
  await expect(page.getByRole('heading', { name: 'Shared employee' })).toBeVisible();
  await page.getByRole('button', { name: 'Publish shift' }).click();
  await expect(page.getByRole('button', { name: 'Cancel shift' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Cancel shift' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to rota' }).click();
  await expect(page.locator('.slc-shift')).toHaveCount(1);
  await expect(page).toHaveURL(/\/schedule\?view=month&month=2031-11&location=north$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('monthly grid shows real shifts, date inspector and branch filtering', async ({ page, request, baseURL }) => {
  const ids: string[] = [];
  for (let index = 0; index < 3; index++) {
    const response = await request.post(path, { ...owner, data: {
      locationId: 'north', startsAt: '2032-02-29T0' + (index + 6) + ':00:00Z', endsAt: '2032-03-01T01:00:00Z'
    } });
    expect(response.status()).toBe(201);
    ids.push((await response.json()).shift.id);
  }
  const south = await request.post(path, { ...owner, data: {
    locationId: 'south', startsAt: '2032-02-29T12:00:00Z', endsAt: '2032-02-29T15:00:00Z'
  } });
  expect(south.status()).toBe(201);
  await page.context().addCookies([{ name: 'sl_session', value: fixtureSessions[ownerEmail], url: baseURL! }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/shop/schedule?view=month&month=2032-02&location=north');
  await expect(page.getByRole('heading', { name: 'February 2032' })).toBeVisible();
  await expect(page.locator('.slc-grid-month .slc-day:not(.outside)')).toHaveCount(29);
  const leapDay = page.locator('.slc-day:not(.outside)').filter({ has: page.locator('.slc-day-top>a:first-child').filter({ hasText: /^29$/ }) });
  await expect(leapDay.locator('.slc-shift')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await leapDay.locator('.slc-shift').first().click();
  await expect(page).toHaveURL(/inspect=/);
  await expect(page.getByRole('complementary', { name: 'Selected date and shift details' })).toContainText('Unassigned');
  await page.getByRole('link', { name: 'Edit / details' }).click();
  await expect(page).toHaveURL(new RegExp('/schedule/' + ids[0] + '\\?view=month'));
  await expect(page.getByRole('heading', { name: 'Edit unpublished shift' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to rota' }).click();
  await leapDay.locator('.slc-day-top>a:first-child').click();
  await expect(page.getByRole('complementary', { name: 'Selected date and shift details' })).toContainText('Unassigned');
  await page.goto('/app/shop/schedule?view=day&date=2032-02-29&location=north');
  await expect(page).toHaveURL(/view=day&date=2032-02-29&location=north$/);
  await expect(page.locator('.slc-shift')).toHaveCount(3);
  await page.reload();
  await expect(page.locator('.slc-shift')).toHaveCount(3);
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page).toHaveURL(/view=day&date=2032-03-01&location=north$/);
  await expect(page.locator('.slc-shift')).toHaveCount(3);
  await page.goBack();
  await expect(page).toHaveURL(/date=2032-02-29&location=north$/);
  await page.getByRole('link', { name: 'Month', exact: true }).click();
  await page.getByRole('link', { name: 'Next month' }).click();
  await expect(page).toHaveURL(/month=2032-03&location=north$/);
  await expect(page.getByRole('heading', { name: 'March 2032' })).toBeVisible();
});

test('calendar defaults to Month and Team view shows assigned staff without changing organisation scope', async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: 'sl_session', value: fixtureSessions[ownerEmail], url: baseURL! }]);
  await page.goto('/app/shop/schedule?location=north');
  await expect(page.getByRole('link', { name: 'Month', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.slc-grid-month')).toBeVisible();
  await page.getByRole('navigation', { name: 'Calendar view' }).getByRole('link', { name: 'Team', exact: true }).click();
  await expect(page).toHaveURL(/view=team&month=\d{4}-\d{2}&location=north$/);
  await expect(page.locator('.slc-team-list')).toBeVisible();
  await expect(page.getByText('Team schedule', { exact: true })).toBeVisible();
  await expect(page.locator('.slc-team-identity').getByText('Shared employee')).toBeVisible();
  await page.reload();
  await expect(page.locator('.slc-team-list')).toBeVisible();
  await page.getByRole('link', { name: 'Month', exact: true }).click();
  await expect(page.locator('.slc-grid-month')).toBeVisible();
});

test('open shifts require explicit marking and serialise competing claims and approvals', async ({ request }) => {
  const startsAt = '2037-05-08T09:00:00Z', endsAt = '2037-05-08T17:00:00Z';
  const data = { locationId: 'south', startsAt, endsAt };
  const draft = await request.post(path, { ...owner, data });
  expect(draft.status()).toBe(201);
  const detail = path + '/' + (await draft.json()).shift.id;
  const claimPath = detail + '/claims';
  expect((await request.post(detail + '/publish', { ...owner, data: { revision: 1 } })).status()).toBe(422);
  expect((await request.patch(detail, { ...owner, data: { ...data, revision: 1, employeeId: 'shared', isOpen: true } })).status()).toBe(422);
  expect((await request.patch(detail, { ...owner, data: { ...data, revision: 1, isOpen: true } })).status()).toBe(200);
  expect((await request.post(claimPath, employee)).status()).toBe(404);
  expect((await request.post(detail + '/publish', { ...owner, data: { revision: 2 } })).status()).toBe(200);

  expect((await request.get(detail, employee)).status()).toBe(200);
  expect((await request.get(claimPath, employee)).status()).toBe(403);
  expect((await request.get(claimPath, manager)).status()).toBe(404);
  const claimants = [employee, session(coverEmail)];
  const responses = await Promise.all(claimants.map(auth => request.post(claimPath, auth)));
  expect(responses.map(response => response.status()).sort()).toEqual([201, 409]);
  const winner = responses.findIndex(response => response.status() === 201);
  const first = (await responses[winner].json()).claim;
  expect((await request.post(claimPath + '/' + first.id + '/approve', manager)).status()).toBe(404);
  expect((await request.post(claimPath + '/' + first.id + '/decline', owner)).status()).toBe(200);

  const newClaim = await request.post(claimPath, employee);
  expect(newClaim.status()).toBe(201);
  const next = (await newClaim.json()).claim;
  const overlapping = await request.post(path, { ...owner, data: { ...data, locationId: 'north', employeeId: 'shared' } });
  expect(overlapping.status()).toBe(201);
  const conflict = (await overlapping.json()).shift;
  const approve = claimPath + '/' + next.id + '/approve';
  expect((await request.post(approve, owner)).status()).toBe(409);
  expect((await request.post(path + '/' + conflict.id + '/discard', { ...owner, data: { revision: 1 } })).status()).toBe(200);
  const decisions = await Promise.all([1, 2].map(() => request.post(approve, owner)));
  expect(decisions.map(response => response.status()).sort()).toEqual([200, 409]);
  expect((await (await request.get(detail, employee)).json()).shift).toMatchObject({ employee_id: 'shared', is_open: 0, revision: 4 });
  expect((await request.get(detail, claimants[1])).status()).toBe(404);
  expect((await (await request.get(claimPath, owner)).json()).claims.map(({ status }) => status).sort()).toEqual(['approved', 'declined']);
});

test('manager creates an open shift and reviews a real claim from the calendar', async ({ page, request, baseURL }) => {
  await page.context().addCookies([{ name: 'sl_session', value: fixtureSessions[managerEmail], url: baseURL! }]);
  await page.goto('/app/shop/schedule?view=day&date=2037-06-10&location=north');
  await page.getByRole('button', { name: /Add shift/ }).click();
  await page.getByRole('link', { name: 'Add open shift' }).click();
  await expect(page.getByLabel('Mark as an open shift')).toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Employee', exact: true })).toBeDisabled();
  await page.getByLabel('Start', { exact: true }).fill('2037-06-10T09:00');
  await page.getByLabel('End', { exact: true }).fill('2037-06-10T17:00');
  await page.getByRole('button', { name: 'Add and publish shift' }).click();
  await expect(page.getByRole('dialog', { name: 'Add shift' })).toHaveCount(0);
  const id = new URL(page.url()).searchParams.get('inspect');
  expect(id).toBeTruthy();
  expect((await request.post(path + '/' + id + '/claims', employee)).status()).toBe(201);
  await page.getByRole('link', { name: 'Edit / details' }).click();
  await expect(page.getByRole('heading', { name: 'Open shift', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve claim' }).click();
  await expect(page.getByText('approved', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Shared employee' })).toBeVisible();
});

test('bulk draft creation and publication are all-or-nothing and safe to retry', async ({ request }) => {
  const operationId = crypto.randomUUID();
  const shifts = [
    { locationId: 'north', employeeId: 'shared', startsAt: '2040-06-04T09:00:00Z', endsAt: '2040-06-04T17:00:00Z' },
    { locationId: 'south', employeeId: 'shared', startsAt: '2040-06-05T09:00:00Z', endsAt: '2040-06-05T17:00:00Z' }
  ];
  const create = path + '/bulk-create', publish = path + '/bulk-publish';
  expect((await request.post(create, { ...employee, data: { operationId, shifts } })).status()).toBe(403);
  expect((await request.post(create, { ...manager, data: { operationId, shifts } })).status()).toBe(409);
  expect((await request.get(path + '/' + operationId + '-0', owner)).status()).toBe(404);
  expect((await request.post(create, { ...owner, data: { operationId, shifts: [shifts[0], {...shifts[0]}] } })).status()).toBe(409);
  const results = await Promise.all([1,2].map(() => request.post(create, { ...owner, data: { operationId, shifts } })));
  expect(results.map(response => response.status()).sort()).toEqual([201,409]);
  const drafts = (await results.find(response => response.status() === 201)!.json()).shifts;
  const selections = drafts.map(({id,revision}) => ({id,revision}));
  expect((await request.post(publish, { ...manager, data: { shifts: selections } })).status()).toBe(409);
  expect((await request.post(publish, { ...owner, data: { shifts: [selections[0], {...selections[1],revision:2}] } })).status()).toBe(409);
  expect((await (await request.get(path + '/' + drafts[0].id, owner)).json()).shift.status).toBe('draft');
  const publishResults = await Promise.all([1,2].map(() => request.post(publish, { ...owner, data: { shifts: selections } })));
  expect(publishResults.map(response => response.status()).sort()).toEqual([200,409]);
  expect((await publishResults.find(response => response.status() === 200)!.json()).published).toBe(2);
  for (const shift of drafts) expect((await request.get(path + '/' + shift.id, employee)).status()).toBe(200);
});

test('weekly repeats, copy-week and bulk publication are usable from Schedule', async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: 'sl_session', value: fixtureSessions[managerEmail], url: baseURL! }]);
  await page.goto('/app/shop/schedule?view=day&date=2040-03-19&location=north');
  await page.getByRole('button', { name: /Add shift/ }).click();
  await page.getByRole('link', { name: 'Add assigned shift' }).click();
  await page.getByRole('combobox', { name: 'Employee', exact: true }).selectOption('shared');
  await page.getByLabel('Start', { exact: true }).fill('2040-03-19T09:00');
  await page.getByLabel('End', { exact: true }).fill('2040-03-19T17:00');
  await page.getByLabel('Weekly occurrences').fill('2');
  await page.getByRole('button', { name: 'Create 2 unpublished shifts' }).click();
  await expect(page.getByRole('dialog', { name: 'Add shift' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Edit / details' }).click();
  await expect(page.getByRole('heading', { name: 'Edit unpublished shift' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to rota' }).click();
  await page.getByRole('link', { name: 'Week', exact: true }).click();
  await page.getByRole('link', { name: 'Copy week' }).click();
  await expect(page).toHaveURL(/schedule\/bulk\?week=.*&location=north$/);
  await page.reload();
  await page.getByRole('button', { name: 'Select all' }).click();
  await expect(page.getByText('1 selected')).toBeVisible();
  await page.getByLabel('Copy how many weeks ahead?').selectOption('3');
  await page.getByRole('button', { name: 'Copy selected shifts' }).click();
  await expect(page.getByRole('status')).toContainText('Copied 1 shift as a draft.');
  await page.getByRole('link', { name: 'View rota' }).click();
  await page.getByRole('link', { name: 'Copy week' }).click();
  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Publish selected drafts' }).click();
  await expect(page.getByRole('status')).toContainText('Published 1 shift.');
  await page.getByRole('link', { name: 'View rota' }).click();
  await expect(page.getByRole('link', { name: /Shared employee.*published/ })).toBeVisible();
});

test('coverage filter flags approved leave and upcoming published shifts can be reassigned', async ({ page, request, baseURL }) => {
  const date = '2046-05-15';
  const data = { locationId:'south', employeeId:'shared', startsAt:date + 'T13:00:00Z', endsAt:date + 'T21:00:00Z' };
  const created = await request.post(path,{...owner,data});
  expect(created.status()).toBe(201);
  const { shift } = await created.json();
  const detail = path + '/' + shift.id;
  expect((await request.post(detail + '/publish',{...owner,data:{revision:1}})).status()).toBe(200);

  const leavePath = '/api/v1/organisations/shop/leave';
  const leave = await request.post(leavePath,{...owner,data:{ locationId:'south', employeeId:'shared',
    firstDate:date, lastDate:date, kind:'holiday' }});
  expect(leave.status()).toBe(201);
  expect((await request.post(leavePath + '/' + (await leave.json()).request.id + '/approve',{
    ...owner,data:{acknowledgeShiftConflict:true}
  })).status()).toBe(200);
  const vacancy = await request.post(path,{...owner,data:{...data,employeeId:null,isOpen:true}});
  expect(vacancy.status()).toBe(201);
  const vacancyId = (await vacancy.json()).shift.id;
  expect((await request.post(path + '/' + vacancyId + '/publish',{...owner,data:{revision:1}})).status()).toBe(200);
  const coverage = path + '?coverage=1&location=south&from=' + date + 'T00:00:00Z&to=2046-05-16T00:00:00Z';
  expect((await request.get(coverage,employee)).status()).toBe(403);
  expect((await (await request.get(coverage,manager)).json()).shifts).toEqual([]);
  expect((await (await request.get(detail,employee)).json()).shift.leave_conflict).toBe(0);
  expect((await request.patch(detail,{...owner,data:{...data,isOpen:true,employeeId:null,revision:2}})).status()).toBe(409);
  expect((await request.patch(detail,{...owner,data:{...data,revision:2}})).status()).toBe(409);

  await page.context().addCookies([{name:'sl_session',value:fixtureSessions[ownerEmail],url:baseURL!}]);
  await page.goto('/app/shop/schedule?view=day&date=' + date + '&location=south');
  await page.getByRole('link',{name:'Needs cover',exact:true}).click();
  await expect(page).toHaveURL(/coverage=1$/);
  await page.getByRole('link',{name:/Shared employee.*published/}).click();
  await page.getByRole('link',{name:'Edit / details'}).click();
  await expect(page.getByText('The assigned employee has approved leave during this shift.')).toBeVisible();
  await expect(page.getByRole('heading',{name:'Edit shift'})).toBeVisible();
  await page.getByRole('combobox',{name:'Employee',exact:true}).selectOption('cover-staff');
  await page.getByRole('button',{name:'Save changes'}).click();
  await expect(page.getByRole('heading',{name:'Cover Employee',exact:true})).toBeVisible();
  await expect(page.getByText('The assigned employee has approved leave during this shift.')).toHaveCount(0);
  expect((await request.get(detail,employee)).status()).toBe(404);
  expect((await (await request.get(detail,session(coverEmail))).json()).shift).toMatchObject({status:'published',revision:3});
  await page.getByRole('link',{name:'Back to rota'}).click();
  await expect(page.locator('.slc-shift')).toHaveCount(1);
  await expect(page.getByRole('link',{name:/Open shift.*published/})).toBeVisible();
});
