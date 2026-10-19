import { test, expect } from '@playwright/test';
test('Today guides a bounded workday, saves task outcomes and records a check-in', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill('admin@tradelink.local');
  await page.getByLabel('Password', { exact: true }).fill('TradeLink-Demo-2026!');
  await page.getByRole('button', { name: 'Enter workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Growth, at a glance.' })).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByLabel('Planning provider').selectOption('local');
  await page.getByRole('button', { name: 'Generate today’s plan', exact: true }).click();
  const cards = page.locator('details.today-task-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).not.toHaveAttribute('open');
  await expect(cards.first().getByText('Deliverable:', { exact: true })).not.toBeVisible();
  const firstToggle = cards.first().locator('summary.today-task-toggle');
  await firstToggle.focus();
  await page.keyboard.press('Enter');
  await expect(cards.first()).toHaveAttribute('open', '');
  await expect(cards.first().getByText('Deliverable:', { exact: true })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(cards.first()).not.toHaveAttribute('open');
  for (const toggle of await cards.locator('summary.today-task-toggle').all()) await toggle.click();
  await expect(page.getByRole('button', { name: 'Approve task', exact: true })).toHaveCount(3);
  await expect(
    page.getByRole('heading', { name: 'Step-by-step instructions', exact: true }),
  ).toHaveCount(3);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page
    .getByRole('button', { name: /Copy AI prompt:/ })
    .first()
    .click();
  await expect(page.getByRole('button', { name: /Copy AI prompt:/ }).first()).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('TradeLink');
  await page.getByRole('button', { name: 'Defer task', exact: true }).last().click();
  await expect(
    page.getByRole('button', { name: 'Defer and suggest another task', exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel('Why are you deferring this task?')
    .fill('Waiting on creative assets; need a draft I can prepare now.');
  await page.getByRole('button', { name: 'Defer and suggest another task', exact: true }).click();
  await expect(page.getByText('DEFERRED', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Deferral reason: Waiting on creative assets; need a draft I can prepare now.', {
      exact: true,
    }),
  ).toBeVisible();
  await cards.last().locator('summary.today-task-toggle').click();
  await expect(
    page.getByRole('heading', { name: 'Step-by-step instructions', exact: true }),
  ).toHaveCount(4);
  await page.getByRole('button', { name: 'Discuss with CMO', exact: true }).first().click();
  await page
    .getByLabel('Ask about this task', { exact: true })
    .fill('Can you explain the first step?');
  await page.getByRole('button', { name: 'Ask CMO about this task', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Can you explain the first step?');
  await expect(page.getByRole('log')).toContainText('Local evidence mode');
  await page.getByText('Save a confirmed clarification to CMO memory', { exact: true }).click();
  await page
    .getByLabel('Confirmed clarification', { exact: true })
    .fill('Prepare drafts for review before scheduling any posts.');
  await page.getByRole('button', { name: 'Save clarification to memory', exact: true }).click();
  await expect(page.getByText('Clarification saved to CMO memory.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve task', exact: true }).first().click();
  await page
    .getByLabel('Observed outcome')
    .fill('Reviewed the baseline and wrote a measurable test brief.');
  await page.getByLabel('Actual minutes (optional)').fill('90');
  await page.getByRole('button', { name: 'Complete and record outcome', exact: true }).click();
  await expect(page.getByText('COMPLETED', { exact: true })).toBeVisible();
  await page
    .getByLabel('What did you do, and what happened?')
    .fill('Prepared one focused acquisition test.');
  await page
    .getByLabel('What did you learn?')
    .fill('We need better signup attribution before increasing spend.');
  await page
    .getByLabel('Blockers or work to carry forward')
    .fill('Web analytics connection pending.');
  await page.getByRole('button', { name: 'Save check-in to memory', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Check-in saved' })).toContainText(
    'Check-in saved',
  );
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.getByText('COMPLETED', { exact: true })).toBeVisible();
  await cards.first().locator('summary.today-task-toggle').click();
  await page
    .getByRole('button', { name: /^Discuss with CMO/ })
    .first()
    .click();
  await expect(page.getByRole('log')).toContainText('Can you explain the first step?');
  await page.screenshot({
    path: 'test-results/today-desktop.png',
    fullPage: true,
    caret: 'initial',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
