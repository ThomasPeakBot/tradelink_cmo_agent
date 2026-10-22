import { afterEach, expect, it, vi } from 'vitest';
import { generateReplacement } from '../lib/today-replacement';
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
  expect(
    body.response_format.json_schema.schema.properties.tasks.items.properties.evidence.items.enum,
  ).toContain('growth');
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
it('keeps the highest-priority real experiment after a stale-data reconciliation task', async () => {
  const experiment = {
    id: 'highest-priority',
    title: 'Test the referral offer',
    successMetric: 'Measure qualified referral conversion',
    isDemo: false,
  };
  const context = {
    ...workspace,
    experiments: [experiment],
    priorities: [experiment],
  } as unknown as Workspace;
  const { draft } = await generateTodayDraft(context, 270, 'local');
  expect(draft.tasks[0].title).toBe('Reconcile subscriber and revenue evidence');
  expect(draft.tasks[1].title).toBe('Test the referral offer');
  expect(draft.tasks[1].evidence).toEqual(['experiment:highest-priority']);
});

it('replacement considers the owner reason and rejects duplicate or over-budget AI output', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'fixture-key');
  vi.stubEnv('TRADELINK_OPENAI_API_KEY', '');
  const { draft } = await generateTodayDraft(workspace, 270, 'local');
  const context = {
    title: 'Blocked task',
    reason: 'No account access today',
    maximumMinutes: 30,
    existingTitles: draft.tasks.map((t) => t.title),
  };
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(draft.tasks[0]) } }] }),
      ),
    );
  const result = await generateReplacement(workspace, context, fetcher);
  expect(result.provider).toBe('local evidence replacement');
  expect(result.task.minutes).toBeLessThanOrEqual(30);
  expect(context.existingTitles).not.toContain(result.task.title);
  const request = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(JSON.stringify(request.messages)).toContain(context.reason);
  expect(request.tools).toBeUndefined();
  const success = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(result.task) } }] }),
      ),
    );
  expect((await generateReplacement(workspace, context, success)).provider).toBe('AI replacement');
});

it('discards a semantically blocked plan and regenerates independent work with review feedback', async () => {
  const operatingContext = {
    unfinishedDeferredWork: [
      {
        id: 'landing-page',
        title: 'Build landing page',
        status: 'DEFERRED',
        reason: 'Missing approved creative assets',
        outcome: 'Missing approved creative assets',
        date: '2026-01-01',
        prerequisiteTaskIds: [],
      },
    ],
    completedWork: [],
    ownerStatements: [],
  };
  const w = { ...workspace, operatingContext } as Workspace;
  const initial = (await generateTodayDraft(workspace, 270, 'local')).draft;
  initial.tasks[0].title = 'Launch paid traffic to the landing page';
  const safe = (await generateTodayDraft(w, 270, 'local')).draft;
  vi.stubEnv('OPENAI_API_KEY', 'fixture-key');
  vi.stubEnv('TRADELINK_OPENAI_API_KEY', '');
  const reply = (value: unknown) =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(initial))
    .mockResolvedValueOnce(
      reply({
        results: initial.tasks.map((_, index) => ({
          index,
          ready: index !== 0,
          prerequisiteTaskIds: index === 0 ? ['landing-page'] : [],
          reason: index === 0 ? 'The landing page is still deferred.' : 'Independent work.',
        })),
      }),
    )
    .mockResolvedValueOnce(reply(safe))
    .mockResolvedValueOnce(
      reply({
        results: safe.tasks.map((_, index) => ({
          index,
          ready: true,
          prerequisiteTaskIds: [],
          reason: 'Independent paper-only preparation.',
        })),
      }),
    );
  const result = await generateTodayDraft(w, 270, 'auto', fetcher);
  expect(
    result.draft.tasks.some((t) => t.title === 'Launch paid traffic to the landing page'),
  ).toBe(false);
  expect(result.draft.tasks[0].title).toBe('Draft an independent creative growth hypothesis');
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(String(fetcher.mock.calls[2][1].body)).toContain('landing page is still deferred');
});
