import { expect, test } from '@playwright/test';

// Needs PostgreSQL on localhost:5432 (docker compose up -d, or scripts/pg-local.ps1 start).
test.skip(process.env['E2E_DB_READY'] !== '1', 'Local PostgreSQL is not available.');

test('sign in as admin through the real local API and see the name; sign out clears it', async ({
  page,
}) => {
  await page.goto('/');
  const header = page.getByRole('banner');
  await expect(header.getByText('Not signed in')).toBeVisible();

  await header.getByRole('button', { name: 'User menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign in as Admin' }).click();
  await expect(header.getByText('Demo Admin')).toBeVisible();

  // The token is in memory; a reload signs in again from the remembered demo user key.
  await page.reload();
  await expect(header.getByText('Demo Admin')).toBeVisible();

  await header.getByRole('button', { name: 'User menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(header.getByText('Not signed in')).toBeVisible();
});
