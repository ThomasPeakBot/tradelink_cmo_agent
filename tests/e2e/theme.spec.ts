import { test, expect } from '@playwright/test';

test('theme follows the device until selected, persists through login and fits mobile', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const hydrationErrors: string[] = [];
  page.on('console', (message) => {
    if (/hydration|hydrated/i.test(message.text())) hydrationErrors.push(message.text());
  });
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.login-form')).toHaveCSS('background-color', 'rgb(25, 40, 32)');
  await page.screenshot({ path: 'test-results/login-dark.png', fullPage: true, caret: 'initial' });
  const toggle = page.getByRole('button', { name: 'Toggle light and dark mode' });
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await toggle.click();
  await page.getByLabel('Email address').fill('admin@tradelink.local');
  await page.getByLabel('Password', { exact: true }).fill('TradeLink-Demo-2026!');
  await page.getByRole('button', { name: 'Enter workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Growth, at a glance.' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.panel').first()).toHaveCSS('background-color', 'rgb(25, 40, 32)');
  await page.screenshot({
    path: 'test-results/dashboard-dark.png',
    fullPage: true,
    caret: 'initial',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(toggle).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.panel').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  expect(hydrationErrors).toEqual([]);
});
