import { test, expect } from '@playwright/test';
test('Drive references show private-folder setup and do not imply a successful import', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/login');
  await page.getByLabel('Email address').fill('admin@tradelink.local');
  await page.getByLabel('Password', { exact: true }).fill('TradeLink-Demo-2026!');
  await page.getByRole('button', { name: 'Enter workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Growth, at a glance.' })).toBeVisible();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Knowledge base', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Google Drive reference folder', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Sync Drive read-only', exact: true }),
  ).toBeDisabled();
  await expect(page.getByText('No successful Drive import yet.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the approved Drive folder' })).toHaveAttribute(
    'href',
    'https://drive.google.com/drive/folders/1DnzWOYD2g-OXv2IsVFLJRWtqF2-qQsJ3',
  );
  await page.screenshot({ path: 'test-results/drive-dark.png', fullPage: true, caret: 'initial' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
