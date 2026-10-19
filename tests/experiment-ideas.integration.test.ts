import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { db } from '../lib/db';
import { ideaAction, generateIdea, validateIdea } from '../lib/experiment-ideas';
import { getWorkspace } from '../lib/workspace';
let actor: { id: string; email: string };
async function clean() {
  const rows = await db.experimentIdea.findMany();
  await db.memory.deleteMany({ where: { OR: rows.map((r) => ({ content: { contains: r.id } })) } });
  await db.auditLog.deleteMany({ where: { entityType: 'ExperimentIdea' } });
  await db.experiment.deleteMany({
    where: { id: { in: rows.flatMap((r) => (r.experimentId ? [r.experimentId] : [])) } },
  });
  await db.experimentIdea.deleteMany();
}
beforeEach(async () => {
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('TRADELINK_OPENAI_API_KEY', '');
  await clean();
  actor = await db.user.findFirstOrThrow({ select: { id: true, email: true } });
});
afterAll(async () => {
  await clean();
  vi.unstubAllEnvs();
  await db.$disconnect();
});
it('keeps generated proposals out of backlog, stores reason in memory, and offers a different next idea', async () => {
  const before = await db.experiment.count();
  const first = await ideaAction(actor, {
    action: 'generate',
    focus: 'Low cost creative referral loop',
  });
  expect(first.status).toBe('DRAFT');
  expect(await db.experiment.count()).toBe(before);
  await expect(
    ideaAction(actor, { action: 'reject', id: first.id, reason: ' ' }),
  ).rejects.toThrow();
  await ideaAction(actor, {
    action: 'reject',
    id: first.id,
    reason: 'We cannot build a new calculator this week.',
  });
  expect(await db.memory.findFirst({ where: { content: { contains: first.id } } })).toMatchObject({
    kind: 'DECISION',
  });
  const second = await ideaAction(actor, { action: 'generate', focus: 'No engineering time' });
  expect(JSON.parse(second.content).title).not.toBe(JSON.parse(first.content).title);
  await expect(ideaAction(actor, { action: 'save', id: first.id })).rejects.toThrow(
    'already been reviewed',
  );
});
it('saves all execution details once, records a decision, and never launches the experiment', async () => {
  const row = await ideaAction(actor, { action: 'generate', focus: '' });
  const results = await Promise.allSettled([
    ideaAction(actor, { action: 'save', id: row.id }),
    ideaAction(actor, { action: 'save', id: row.id }),
  ]);
  expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
  const saved = await db.experimentIdea.findUniqueOrThrow({ where: { id: row.id } });
  const experiment = await db.experiment.findUniqueOrThrow({ where: { id: saved.experimentId! } });
  expect(saved.status).toBe('SAVED');
  expect(experiment.status).toBe('BACKLOG');
  expect(experiment.hypothesis).toContain('AI prompts:');
  expect(experiment.impact).toBe(5);
  expect(await db.experiment.count({ where: { id: saved.experimentId! } })).toBe(1);
  const retried = await ideaAction(actor, { action: 'save', id: row.id });
  expect(retried.experimentId).toBe(saved.experimentId);
});
it('grounds OpenAI requests in stored evidence and rejection feedback and validates citations', async () => {
  const w = await getWorkspace(actor.id);
  const { idea } = await generateIdea(w, '', []);
  vi.stubEnv('TRADELINK_OPENAI_API_KEY', 'test-placeholder');
  let request = '';
  const fetcher = vi.fn(async (_url: unknown, init: RequestInit | undefined) => {
    request = String(init?.body);
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(idea) } }] }),
    );
  }) as unknown as typeof fetch;
  const result = await generateIdea(
    w,
    'No engineering time',
    [{ content: JSON.stringify(idea), feedback: 'No engineering time', status: 'REJECTED' }],
    fetcher,
  );
  expect(result.provider).toBe('OpenAI');
  expect(request).toContain('No engineering time');
  expect(request).toContain('institutionalMemory');
  expect(() => validateIdea({ ...idea, evidence: ['knowledge:invented'] }, w)).toThrow(
    'unavailable evidence',
  );
  await expect(
    generateIdea(w, '', [], async () => new Response('', { status: 429 })),
  ).rejects.toThrow('preserved');
});
