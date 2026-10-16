import { test, expect, type APIRequestContext } from '@playwright/test';
async function login(request: APIRequestContext) {
  const res = await request.post('/api/auth/login', {
    headers: { origin: 'http://localhost:3001' },
    data: { email: 'admin@tradelink.local', password: 'TradeLink-Demo-2026!' },
  });
  expect(res.ok()).toBeTruthy();
}
const headers = { origin: 'http://localhost:3001' };
test('unauthenticated users and cross-origin requests are rejected', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  expect((await request.get('/api/workspace')).status()).toBe(401);
  expect(
    (
      await request.post('/api/metrics', {
        headers: { origin: 'https://untrusted.example' },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post('/api/auth/login', {
        headers,
        data: { email: 'admin@tradelink.local', password: 'wrong' },
      })
    ).status(),
  ).toBe(401);
});
test('login, dashboard and navigation work on desktop and mobile', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill('admin@tradelink.local');
  await page.getByLabel('Password', { exact: true }).fill('TradeLink-Demo-2026!');
  await page.getByRole('button', { name: 'Enter workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Growth, at a glance.' })).toBeVisible();
  await expect(page.getByText('PostgreSQL connected')).toBeVisible();
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  for (const tab of [
    'Daily metrics',
    'Channels',
    'Experiments',
    'Forecast',
    'Knowledge base',
    'Institutional memory',
    'Approvals',
    'Audit log',
    'CSV import',
    'Settings',
  ]) {
    await page.getByRole('navigation').getByRole('button', { name: tab, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: tab, exact: true })).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Growth, at a glance.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('manual KPI entry persists and changes pace', async ({ request }) => {
  await login(request);
  const date = new Date().toISOString().slice(0, 10);
  const res = await request.post('/api/metrics', {
    headers,
    data: { date, subscribers: 900, newSubs: 10, churned: 2, visitors: 500, mrr: 17100, spend: 50 },
  });
  expect(res.ok()).toBeTruthy();
  const w = await (await request.get('/api/workspace')).json();
  expect(w.summary.current).toBe(900);
  expect(w.summary.status).toBe('AHEAD');
  expect(w.metrics.find((m: { date: string }) => m.date === date).isDemo).toBe(false);
  expect(w.audits.some((a: { action: string }) => a.action === 'UPSERT')).toBe(true);
  expect(
    (await request.post('/api/metrics', { headers, data: { date, subscribers: -1 } })).status(),
  ).toBe(400);
});
test('CSV validation is atomic and overwrites require an explicit choice', async ({ request }) => {
  await login(request);
  const h = 'date,subscribers,newSubs,churned,visitors,mrr,spend\n';
  expect(
    (
      await request.post('/api/import', {
        headers,
        data: { csv: h + '2021-01-01,50,1,0,10,100,0\n2021-01-02,-2,1,0,10,100,0' },
      })
    ).status(),
  ).toBe(400);
  let w = await (await request.get('/api/workspace')).json();
  expect(w.metrics.some((m: { date: string }) => m.date === '2021-01-01')).toBe(false);
  const csv = h + '2021-01-01,50,1,0,10,100,0';
  expect((await request.post('/api/import', { headers, data: { csv } })).ok()).toBeTruthy();
  expect((await request.post('/api/import', { headers, data: { csv } })).status()).toBe(400);
  expect(
    (await request.post('/api/import', { headers, data: { csv, overwrite: true } })).ok(),
  ).toBeTruthy();
  w = await (await request.get('/api/workspace')).json();
  expect(w.metrics.find((m: { date: string }) => m.date === '2021-01-01').source).toBe('csv');
});
test('knowledge and decisions inform CMO responses; approvals never execute', async ({
  request,
}) => {
  await login(request);
  expect(
    (
      await request.post('/api/knowledge', {
        headers,
        data: {
          title: 'Browser evidence sentinel',
          category: 'Product',
          content: 'Our approved promise is practical value.',
        },
      })
    ).ok(),
  ).toBeTruthy();
  await request.post('/api/approvals', {
    headers,
    data: {
      title: 'Browser approval sentinel',
      actionType: 'BUDGET',
      details: 'Review a $100 manual pilot.',
    },
  });
  let w = await (await request.get('/api/workspace')).json();
  const a = w.approvals.find((a: { title: string }) => a.title === 'Browser approval sentinel');
  expect(
    (
      await request.post('/api/approvals', {
        headers,
        data: { id: a.id, status: 'APPROVED', reviewNote: 'Approved for manual execution only.' },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.post('/api/approvals', {
        headers,
        data: { id: a.id, status: 'REJECTED', reviewNote: 'Cannot change a reviewed decision.' },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post('/api/chat', {
        headers,
        data: { type: 'CHAT', prompt: 'Are we ahead or behind pace?', mode: 'local' },
      })
    ).ok(),
  ).toBeTruthy();
  w = await (await request.get('/api/workspace')).json();
  const answer = w.messages.at(-1);
  expect(answer.content).toContain('practical value');
  expect(answer.content).toContain('Browser approval sentinel');
  expect(answer.content).toContain('No external action has been taken');
  expect(
    w.memories.some((m: { content: string }) =>
      m.content.includes('Approved for manual execution only'),
    ),
  ).toBe(true);
});
test('daily, weekly and monthly reports are generated and persisted', async ({ page, request }) => {
  await login(request);
  for (const type of ['DAILY', 'WEEKLY', 'MONTHLY']) {
    const res = await request.post('/api/reports', {
      headers,
      data: { type, prompt: 'Generate a briefing', mode: 'local' },
    });
    expect(res.ok()).toBeTruthy();
  }
  const w = await (await request.get('/api/workspace')).json();
  for (const type of ['DAILY', 'WEEKLY', 'MONTHLY'])
    expect(w.reports.some((r: { type: string }) => r.type === type)).toBe(true);
  await page.goto('/login');
  await page.getByLabel('Email address').fill('admin@tradelink.local');
  await page.getByLabel('Password', { exact: true }).fill('TradeLink-Demo-2026!');
  await page.getByRole('button', { name: 'Enter workspace' }).click();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Briefs & plans', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Saved briefings', exact: true })).toBeVisible();
  await expect(page.getByText('Approval boundary', { exact: true })).toBeVisible();
});
test('session cookies are HttpOnly; logout revokes the session', async ({ request }) => {
  const response = await request.post('/api/auth/login', {
    headers,
    data: { email: 'admin@tradelink.local', password: 'TradeLink-Demo-2026!' },
  });
  expect(response.headers()['set-cookie']).toContain('HttpOnly');
  expect(response.headers()['set-cookie']).toContain('SameSite=lax');
  await request.post('/api/auth/logout', { headers });
  expect((await request.get('/api/workspace')).status()).toBe(401);
});

test('real browser forms save knowledge and request a grounded CMO answer', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill('admin@tradelink.local');
  await page.getByLabel('Password', { exact: true }).fill('TradeLink-Demo-2026!');
  await page.getByRole('button', { name: 'Enter workspace' }).click();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Knowledge base', exact: true })
    .click();
  await page.getByLabel('Title', { exact: true }).fill('UI form knowledge sentinel');
  await page
    .getByLabel('Facts, evidence, and relevant constraints')
    .fill('Our verified primary objective is subscriber retention.');
  await page.getByRole('button', { name: 'Add knowledge', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'UI form knowledge sentinel', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'CMO intelligence', exact: true })
    .click();
  await page
    .getByLabel('Ask your CMO', { exact: true })
    .fill('What is the primary objective recorded in our knowledge?');
  await page.getByRole('button', { name: 'Ask CMO', exact: true }).click();
  await expect(
    page.getByText(/Our verified primary objective is subscriber retention/),
  ).toBeVisible();
});
test('failed logins are rate limited without exposing account existence', async ({ request }) => {
  const email = 'rate-limit-test@tradelink.local';
  for (let i = 0; i < 8; i++) {
    expect(
      (
        await request.post('/api/auth/login', { headers, data: { email, password: 'invalid' } })
      ).status(),
    ).toBe(401);
  }
  expect(
    (
      await request.post('/api/auth/login', { headers, data: { email, password: 'invalid' } })
    ).status(),
  ).toBe(429);
});
