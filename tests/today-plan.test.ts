import { afterEach, expect, it, vi } from 'vitest';
import { generateTodayDraft, validateTodayDraft } from '../lib/today-plan';
import type { Workspace } from '../lib/workspace';
import { growthSummary } from '../lib/growth';
const company = {
  id: 'tradelink',
  name: 'TradeLink',
  description: 'Approved evidence',
  goalStart: 50,
  goalTarget: 5000,
  goalStartDate: '2026-01-01',
  goalEndDate: '2027-01-01',
  currency: 'USD',
  updatedAt: new Date(),
};
const workspace = {
  company,
  summary: growthSummary(company, []),
  priorities: [],
  experiments: [],
  knowledge: [],
  memories: [],
  approvals: [],
  channels: [],
  alerts: [],
  social: [],
  drive: { available: false, documents: [] },
  stripe: { configured: false, products: [], lastSync: null, summary: null },
  metrics: [],
  messages: [],
  today: { current: null, history: [] },
  xAds: { connected: false },
} as unknown as Workspace;
afterEach(() => vi.unstubAllEnvs());
it('creates three bounded local proposals and reserves review/check-in time for every supported budget', async () => {
  for (const budget of [240, 270, 300]) {
    const { draft, provider } = await generateTodayDraft(workspace, budget, 'local');
    expect(draft.tasks).toHaveLength(3);
    expect(draft.tasks.reduce((n, t) => n + t.minutes, 0)).toBeLessThanOrEqual(budget - 40);
    expect(provider).toBe('local-evidence');
    expect(draft.warnings.join(' ')).toContain('missing');
  }
});
it('rejects invented evidence and over-budget work rather than saving a bad plan', async () => {
  const { draft } = await generateTodayDraft(workspace, 240, 'local');
  expect(() =>
    validateTodayDraft(
      { ...draft, tasks: draft.tasks.map((t) => ({ ...t, minutes: 180 })) },
      workspace,
      240,
    ),
  ).toThrow('exceeds');
  expect(() =>
    validateTodayDraft(
      { ...draft, tasks: draft.tasks.map((t) => ({ ...t, evidence: ['experiment:invented'] })) },
      workspace,
      240,
    ),
  ).toThrow('unavailable evidence');
});
it('uses structured OpenAI output, stored evidence and no execution tools', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'fixture-key');
  vi.stubEnv('TRADELINK_OPENAI_API_KEY', '');
  const { draft } = await generateTodayDraft(workspace, 270, 'local');
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(draft) } }] })),
    );
  const result = await generateTodayDraft(workspace, 270, 'auto', fetcher);
  expect(result.provider).toContain('openai:');
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body.response_format.type).toBe('json_schema');
  expect(body.tools).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain('fixture-key');
  expect(JSON.stringify(body)).toContain('storedEvidence');
});
it('does not disguise provider failures or invalid output as a successful local plan', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'fixture-key');
  vi.stubEnv('TRADELINK_OPENAI_API_KEY', '');
  await expect(
    generateTodayDraft(
      workspace,
      270,
      'auto',
      vi.fn().mockResolvedValue(new Response('{}', { status: 429 })),
    ),
  ).rejects.toThrow('generation failed');
});
