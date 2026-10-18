import { test, expect } from '@playwright/test';

test('social reporting distinguishes unconfigured accounts and does not imply paid attribution', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/login');
  await page.getByLabel('Email address').fill('admin@tradelink.local');
  await page.getByLabel('Password', { exact: true }).fill('TradeLink-Demo-2026!');
  await page.getByRole('button', { name: 'Enter workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Growth, at a glance.' })).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: 'Channels', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'X reporting', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Instagram reporting', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sync X read-only', exact: true })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Sync Instagram read-only', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText('Not connected — no successful sync yet.', { exact: true }),
  ).toHaveCount(2);
  await page.screenshot({ path: 'test-results/social-dark.png', fullPage: true, caret: 'initial' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
