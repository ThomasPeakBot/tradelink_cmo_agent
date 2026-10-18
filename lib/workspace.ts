import { socialConfiguration, socialSnapshotSchema } from './social';
import { stripeConfiguration, stripeSnapshotSchema } from './stripe';
import { stripeMetrics } from './stripe-evidence';
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
  const social = await Promise.all(
    (['x', 'instagram'] as const).map(async (provider) => {
      const config = socialConfiguration(provider);
      const rows = config.accountId
        ? await db.socialSnapshot.findMany({
            where: { provider, accountId: config.accountId },
            orderBy: { date: 'desc' },
            take: 30,
          })
        : [];
      const latest = rows[0] ? socialSnapshotSchema.parse(rows[0].data) : null;
      return {
        ...config,
        lastSync: latest?.capturedAt ?? null,
        isStale: latest ? Date.now() - Date.parse(latest.capturedAt) > 86400000 : false,
        snapshot: latest,
        history: rows
          .slice()
          .reverse()
          .map((row) => {
            const item = socialSnapshotSchema.parse(row.data);
            return { capturedAt: item.capturedAt, followers: item.followers };
          }),
      };
    }),
  );
  const stripeConfig = stripeConfiguration();
  const snapshots = stripeConfig.scopeId
    ? (
        await db.stripeSnapshot.findMany({
          where: { scopeId: stripeConfig.scopeId },
          orderBy: { date: 'asc' },
        })
      ).map((row) => stripeSnapshotSchema.parse(row.data))
    : [];
  const billingMetrics = stripeMetrics(snapshots);
  const manualMetrics = rawMetrics.map((m) => ({
    ...m,
    date: m.date.toISOString().slice(0, 10),
    mrr: Number(m.mrr),
    spend: Number(m.spend),
  }));
  // Once scoped Stripe evidence exists, do not blend demo counts or manual flow definitions into its forecast.
  const metrics = billingMetrics.length ? billingMetrics : manualMetrics;
  const latestBilling = snapshots.at(-1);
  const billingSummary = latestBilling
    ? {
        grossMrr: latestBilling.grossMrr,
        paidInvoiceAmountMonthToDate: latestBilling.paidInvoiceAmountMonthToDate,
        paidInvoicesMonthToDate: latestBilling.paidInvoicesMonthToDate,
        activeSubscriptions: latestBilling.activeSubscriptions,
        trialingSubscriptions: latestBilling.trialingSubscriptions,
        pastDueSubscriptions: latestBilling.pastDueSubscriptions,
        warnings: latestBilling.warnings,
      }
    : null;
  const stripe = {
    ...stripeConfig,
    lastSync: latestBilling?.capturedAt ?? null,
    summary: billingSummary,
  };
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
    stripe,
    social,
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
