import { test, expect } from '@playwright/test';
test('affiliate templates are editable, previewable, version approved and paused until mailbox and rules are ready', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill('admin@tradelink.local');
  await page.getByLabel('Password', { exact: true }).fill('TradeLink-Demo-2026!');
  await page.getByRole('button', { name: 'Enter workspace' }).click();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Affiliate communications', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Initialize affiliate email workspace', exact: true })
    .click();
  await expect(page.getByText('PAUSED — NO AUTOMATIC SENDS', { exact: true })).toBeVisible();
  const panel = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: '10-referral milestone', exact: true }) });
  await panel
    .getByLabel('Email subject', { exact: true })
    .fill('Thanks, {{first_name}} — a milestone to celebrate');
  await panel.getByRole('button', { name: 'Save template revision', exact: true }).click();
  await expect(panel.getByText('VERSION 2 · DRAFT — NOT APPROVED', { exact: true })).toBeVisible();
  await panel.getByText('Preview with DEMO values', { exact: true }).click();
  await expect(
    panel.getByRole('heading', { name: 'Thanks, Alex — a milestone to celebrate', exact: true }),
  ).toBeVisible();
  await panel.getByRole('checkbox').check();
  await panel
    .getByRole('button', { name: 'Approve saved template for automation', exact: true })
    .click();
  await expect(panel.getByText('VERSION 2 · APPROVED', { exact: true })).toBeVisible();
  await panel
    .getByLabel('Email body', { exact: true })
    .fill('Hi {{first_name}},\n\nHere is our revised draft for your review.');
  await panel.getByRole('button', { name: 'Save template revision', exact: true }).click();
  await expect(panel.getByText('VERSION 3 · DRAFT — NOT APPROVED', { exact: true })).toBeVisible();
  await page
    .getByLabel(
      'I authorize automatic sends from experience@peakbot.com using the approved template versions and rules.',
      { exact: true },
    )
    .check();
  await page
    .getByRole('button', { name: 'Enable automatic affiliate emails', exact: true })
    .click();
  await expect(page.getByRole('alert').filter({ hasText: 'Connect the mailbox' })).toContainText(
    'Connect the mailbox',
  );
  const denied = await page.request.post('/api/affiliate-email', {
    data: { action: 'initialize' },
  });
  expect(denied.status()).toBe(400);
  await page.reload();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Affiliate communications', exact: true })
    .click();
  await expect(panel.getByLabel('Email subject', { exact: true })).toHaveValue(
    'Thanks, {{first_name}} — a milestone to celebrate',
  );
  await expect(panel.getByText('VERSION 3 · DRAFT — NOT APPROVED', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
