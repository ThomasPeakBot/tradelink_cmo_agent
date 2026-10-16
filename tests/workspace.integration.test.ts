import { afterAll, describe, it, expect } from 'vitest';
import { db } from '../lib/db';
import { getWorkspace } from '../lib/workspace';
import { LocalIntelligenceProvider, OpenAIIntelligenceProvider } from '../lib/intelligence';
import { refreshAlerts } from '../lib/alerts';
afterAll(() => db.$disconnect());
describe('PostgreSQL-backed CMO evidence', () => {
  it('loads persisted metrics, experiments and knowledge', async () => {
    const user = await db.user.findUniqueOrThrow({ where: { email: 'admin@tradelink.local' } });
    const w = await getWorkspace(user.id);
    expect(w.metrics.length).toBeGreaterThan(0);
    expect(w.knowledge.length).toBeGreaterThan(0);
    expect(w.summary.current).toBeGreaterThan(0);
  });
  it('grounds answers in stored knowledge, memory, experiments and decisions', async () => {
    const user = await db.user.findUniqueOrThrow({ where: { email: 'admin@tradelink.local' } });
    const k = await db.knowledge.create({
      data: {
        title: 'Integration evidence sentinel',
        category: 'Product',
        content: 'The approved positioning is community-first.',
      },
    });
    const m = await db.memory.create({
      data: {
        title: 'Retention lesson sentinel',
        kind: 'LEARNING',
        content: 'Activation interviews revealed onboarding friction.',
      },
    });
    const a = await db.approval.create({
      data: {
        title: 'Budget decision sentinel',
        actionType: 'BUDGET',
        details: 'Test',
        status: 'REJECTED',
        requestedBy: user.email,
        reviewNote: 'Wait for attribution review',
      },
    });
    try {
      const w = await getWorkspace(user.id);
      const result = await new LocalIntelligenceProvider().generate({
        type: 'CHAT',
        prompt: 'What should we do next?',
        context: w,
      });
      expect(result.provider).toBe('local-evidence');
      expect(result.content).toContain('community-first');
      expect(result.content).toContain('Retention lesson sentinel');
      expect(result.content).toContain('Budget decision sentinel');
      expect(result.content).toContain(w.priorities[0].title);
      expect(result.content).toContain(w.summary.status.toLowerCase());
      expect(result.content).toContain('No external action has been taken');
    } finally {
      await db.knowledge.delete({ where: { id: k.id } });
      await db.memory.delete({ where: { id: m.id } });
      await db.approval.delete({ where: { id: a.id } });
    }
  });
  it('creates deduplicated alerts from stored metrics', async () => {
    const user = await db.user.findUniqueOrThrow({ where: { email: 'admin@tradelink.local' } });
    await refreshAlerts(user.id);
    const count = await db.alert.count();
    await refreshAlerts(user.id);
    expect(await db.alert.count()).toBe(count);
  });
  it('retains generated briefings across fresh database reads', async () => {
    const user = await db.user.findUniqueOrThrow({ where: { email: 'admin@tradelink.local' } });
    const w = await getWorkspace(user.id);
    const result = await new LocalIntelligenceProvider().generate({
      type: 'WEEKLY',
      prompt: 'Review',
      context: w,
    });
    const r = await db.report.create({
      data: {
        type: 'WEEKLY',
        title: 'Persistence test',
        content: result.content,
        provider: result.provider,
        isDemo: true,
      },
    });
    try {
      expect((await getWorkspace(user.id)).reports.some((item) => item.id === r.id)).toBe(true);
    } finally {
      await db.report.delete({ where: { id: r.id } });
    }
  });
  it('rolls back all imported rows when a transaction fails', async () => {
    const date = new Date('2020-01-01');
    await expect(
      db.$transaction(async (tx) => {
        await tx.dailyMetric.create({
          data: { date, subscribers: 50, newSubs: 1, churned: 0, visitors: 10, mrr: 100, spend: 0 },
        });
        throw new Error('Invalid second row');
      }),
    ).rejects.toThrow();
    expect(await db.dailyMetric.findUnique({ where: { date } })).toBeNull();
  });
  it('never exposes an external executor through either intelligence provider', () => {
    expect('execute' in new LocalIntelligenceProvider()).toBe(false);
    expect('execute' in new OpenAIIntelligenceProvider()).toBe(false);
  });
});
