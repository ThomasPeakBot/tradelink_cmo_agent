import { afterEach, expect, it, vi } from 'vitest';
import { continuityEvidence, type OperatingContext } from '../lib/operating-context';
import { assessTaskReadiness, assertDeclaredPrerequisites } from '../lib/task-readiness';
import type { Workspace } from '../lib/workspace';
const deferred = {
  id: 'page',
  title: 'Build the landing page',
  status: 'DEFERRED',
  reason: 'We do not have the assets yet',
  outcome: '',
  date: '2026-09-01',
  prerequisiteTaskIds: [],
};
const context: OperatingContext = {
  unfinishedDeferredWork: [deferred],
  completedWork: [],
  ownerStatements: [],
};
afterEach(() => vi.unstubAllEnvs());
it('carries old deferred work and relevant owner statements beyond recent chat windows', () => {
  const c = {
    ...context,
    ownerStatements: [
      ...Array.from({ length: 200 }, (_, i) => ({
        id: String(i),
        taskId: null,
        date: '2026-10-22',
        content: 'Other unrelated conversation.',
      })),
      {
        id: 'old',
        taskId: 'page',
        date: '2026-09-01',
        content: 'We cannot launch the signup page because the assets are not ready.',
      },
    ],
  };
  const result = continuityEvidence(c, 'signup page assets readiness');
  expect(result.unfinishedDeferredWork[0].id).toBe('page');
  expect(result.ownerStatements.some((m) => m.id === 'old')).toBe(true);
});
it('requires an actual completion, not age or a proposed alternative, for declared prerequisites', () => {
  const candidate = {
    title: 'Launch page test',
    deliverable: 'Run test',
    prerequisiteTaskIds: ['page'],
  };
  expect(() =>
    assertDeclaredPrerequisites([candidate], { operatingContext: context } as unknown as Workspace),
  ).toThrow('unfinished');
  expect(() =>
    assertDeclaredPrerequisites([candidate], {
      operatingContext: {
        ...context,
        unfinishedDeferredWork: [],
        completedWork: [{ ...deferred, status: 'COMPLETED' }],
      },
    } as unknown as Workspace),
  ).not.toThrow();
});
it('rejects semantically dependent work even if the generator omits dependency IDs', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'fixture');
  vi.stubEnv('TRADELINK_OPENAI_API_KEY', '');
  let request = '';
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    request = String(init?.body);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                results: [
                  {
                    index: 0,
                    ready: false,
                    prerequisiteTaskIds: ['page'],
                    reason: 'The landing page is still deferred, so the campaign cannot launch.',
                  },
                ],
              }),
            },
          },
        ],
      }),
    );
  }) as typeof fetch;
  await expect(
    assessTaskReadiness(
      [
        {
          title: 'Launch a signup conversion campaign',
          deliverable: 'Send traffic to the signup page',
        },
      ],
      { operatingContext: context } as unknown as Workspace,
      fetcher,
    ),
  ).rejects.toThrow('still deferred');
  expect(request).toContain('We do not have the assets yet');
});
it('rejects a review claiming ready when the linked prerequisite remains unfinished', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'fixture');
  vi.stubEnv('TRADELINK_OPENAI_API_KEY', '');
  const fetcher = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                results: [
                  { index: 0, ready: true, prerequisiteTaskIds: ['page'], reason: 'Looks good' },
                ],
              }),
            },
          },
        ],
      }),
    );
  await expect(
    assessTaskReadiness(
      [{ title: 'Launch campaign', deliverable: 'Send traffic' }],
      { operatingContext: context } as unknown as Workspace,
      fetcher,
    ),
  ).rejects.toThrow('unfinished');
});
it('fails closed on an incomplete readiness review', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'fixture');
  vi.stubEnv('TRADELINK_OPENAI_API_KEY', '');
  await expect(
    assessTaskReadiness(
      [{ title: 'Some action', deliverable: 'Output' }],
      { operatingContext: context } as unknown as Workspace,
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '{"results":[]}' } }] })),
    ),
  ).rejects.toThrow('Incomplete prerequisite review');
});
