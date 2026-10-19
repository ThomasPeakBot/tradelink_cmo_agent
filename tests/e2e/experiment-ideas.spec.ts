import { test, expect } from '@playwright/test';
test('idea lab persists owner feedback, suggests another idea and saves only selected ideas to backlog', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill('admin@tradelink.local');
  await page.getByLabel('Password', { exact: true }).fill('TradeLink-Demo-2026!');
  await page.getByRole('button', { name: 'Enter workspace' }).click();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Experiments', exact: true })
    .click();
  await page
    .getByLabel('Focus or constraints (optional)')
    .fill('A creative test without new engineering');
  await page.getByRole('button', { name: 'Generate a growth idea', exact: true }).click();
  const proposal = page.locator('.idea-proposal');
  await expect(
    proposal.getByRole('heading', {
      name: 'Prototype a shareable prop-account workflow calculator',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', {
      name: 'Prototype a shareable prop-account workflow calculator',
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Not for me — give feedback' }).click();
  await expect(
    page.getByRole('button', { name: 'Save feedback & suggest another' }),
  ).toBeDisabled();
  await page
    .getByLabel('Why doesn’t this idea work for you?')
    .fill('We have no engineering capacity this week.');
  await page.getByRole('button', { name: 'Save feedback & suggest another' }).click();
  await expect(
    proposal.getByRole('heading', {
      name: 'Design a coordinated multi-account setup clinic',
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save to experiment backlog', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved to experiment backlog');
  await expect(proposal.getByText('SAVED', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('cell').filter({ hasText: 'Design a coordinated multi-account setup clinic' }),
  ).toHaveCount(1);
  await page.reload();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Experiments', exact: true })
    .click();
  await expect(proposal.getByText('SAVED', { exact: true })).toBeVisible();
  await page.getByText('Idea history (2 most recent)', { exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Prototype a shareable prop-account workflow calculator · REJECTED',
      exact: true,
    })
    .click();
  await expect(proposal).toContainText('We have no engineering capacity this week.');
  await expect(
    page.getByRole('button', { name: 'Save to experiment backlog', exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: 'test-results/experiment-ideas-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
