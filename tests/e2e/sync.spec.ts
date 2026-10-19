import { test, expect } from '@playwright/test';
test('Sync all stores visible per-provider results and fits the mobile header', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill('admin@tradelink.local');
  await page.getByLabel('Password', { exact: true }).fill('TradeLink-Demo-2026!');
  await page.getByRole('button', { name: 'Enter workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Growth, at a glance.' })).toBeVisible();
  await page.getByRole('button', { name: 'Sync all data', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Sync finished.');
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Sync schedule & history', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('MANUAL · SKIPPED', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Sync all data', exact: true })).toBeVisible();
});
