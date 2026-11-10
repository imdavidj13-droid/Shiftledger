import { expect, test } from '@playwright/test';
import { employeeEmail, password } from './fixtures.mjs';

async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('personal profile is authorised and persists edits across reload', async ({ request, page }) => {
  expect((await request.patch('/api/v1/auth/me', { data: { name: 'Unauthorised' } })).status()).toBe(401);
  await page.goto('/profile');
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  await signIn(page, employeeEmail);
  await expect(page).toHaveURL(/\/profile$/);
  await page.getByLabel('Display name').fill('Updated Employee Profile');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Display name')).toHaveValue('Updated Employee Profile');
  await expect(page.getByLabel('Verified email address')).toHaveValue(employeeEmail);
});

test('onboarding step URLs survive refresh and browser history before saving multiple branches', async ({ page }) => {
  await page.goto('/sign-in');
  await signIn(page, 'browser-onboard@example.test');
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel('Organisation name').fill('Onboarding Browser Fixture');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/onboarding\?step=2$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Set your scheduling preferences.' })).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel('Organisation name')).toHaveValue('Onboarding Browser Fixture');
  await page.goForward();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/onboarding\?step=3$/);
  await page.getByRole('combobox', { name: 'Location setup' }).selectOption('multiple');
  await page.getByLabel('Branch 1', { exact: true }).fill('British branch');
  await page.getByLabel('Branch 2', { exact: true }).fill('Canadian branch');
  await page.getByLabel('Branch 2 time zone (optional)', { exact: true }).fill('America/Toronto');
  await page.getByRole('button', { name: 'Create organisation' }).click();
  await expect(page.getByRole('heading', { name: 'Your workforce, organised.' })).toBeVisible();
  await page.getByRole('link', { name: 'Locations', exact: true }).click();
  await expect(page.getByRole('link', { name: 'British branch' })).toBeVisible();
  await expect(page.getByText('America/Toronto', { exact: true })).toBeVisible();
});
