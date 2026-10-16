import { db } from './db';
import { growthSummary, prioritize } from './growth';
export async function getWorkspace(userId: string) {
  const [
    company,
    rawMetrics,
    rawChannels,
    experiments,
    knowledge,
    memories,
    approvals,
    audits,
    alerts,
    reports,
    messages,
  ] = await Promise.all([
    db.company.findUniqueOrThrow({ where: { id: 'tradelink' } }),
    db.dailyMetric.findMany({ orderBy: { date: 'asc' } }),
    db.channel.findMany({
      include: { metrics: { orderBy: { date: 'desc' }, take: 30 } },
      orderBy: { name: 'asc' },
    }),
    db.experiment.findMany({ orderBy: { updatedAt: 'desc' } }),
    db.knowledge.findMany({ orderBy: { updatedAt: 'desc' } }),
    db.memory.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    db.approval.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    db.alert.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    db.report.findMany({ orderBy: { createdAt: 'desc' }, take: 30 }),
    db.chatMessage.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30 }),
  ]);
  const metrics = rawMetrics.map((m) => ({
    ...m,
    date: m.date.toISOString().slice(0, 10),
    mrr: Number(m.mrr),
    spend: Number(m.spend),
  }));
  const goal = {
    ...company,
    goalStartDate: company.goalStartDate.toISOString().slice(0, 10),
    goalEndDate: company.goalEndDate.toISOString().slice(0, 10),
  };
  const channels = rawChannels.map((c) => {
    const cutoff = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const valid = c.metrics.filter(
      (m) => m.date.toISOString().slice(0, 10) >= cutoff && m.date <= new Date(),
    );
    const total = valid.reduce(
      (a, m) => ({
        visitors: a.visitors + m.visitors,
        leads: a.leads + m.leads,
        subscribers: a.subscribers + m.subscribers,
        spend: a.spend + Number(m.spend),
      }),
      { visitors: 0, leads: 0, subscribers: 0, spend: 0 },
    );
    return {
      id: c.id,
      name: c.name,
      ...total,
      cac: total.subscribers ? total.spend / total.subscribers : null,
      conversion: total.visitors ? (total.subscribers / total.visitors) * 100 : null,
      isDemo: valid.some((m) => m.isDemo),
      records: valid.length,
    };
  });
  return {
    company: goal,
    metrics,
    channels,
    experiments,
    priorities: prioritize(experiments),
    knowledge,
    memories,
    approvals,
    audits,
    alerts,
    reports,
    messages: messages.reverse(),
    summary: growthSummary(goal, metrics),
  };
}
export type Workspace = Awaited<ReturnType<typeof getWorkspace>>;
