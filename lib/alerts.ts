import { db } from './db';
import { getWorkspace } from './workspace';
export async function refreshAlerts(userId: string) {
  const w = await getWorkspace(userId);
  const s = w.summary;
  const today = new Date().toISOString().slice(0, 10);
  const candidates = [
    ...(s.status === 'BEHIND'
      ? [
          {
            key: `pace:${today}`,
            title: 'Subscriber growth is behind pace',
            severity: 'HIGH',
            detail: `${s.current} subscribers versus ${s.expected} target today. Prioritize acquisition and retention experiments.`,
          },
        ]
      : []),
    ...(s.forecasts.base !== null && s.forecasts.base < w.company.goalTarget
      ? [
          {
            key: `forecast:${today}`,
            title: 'Current run rate falls short of the goal',
            severity: 'HIGH',
            detail: `The base scenario projects ${s.forecasts.base} subscribers versus the ${w.company.goalTarget} goal. Daily net additions need to rise to ${s.requiredDaily?.toFixed(1)}; current observed average is ${s.averageNet.toFixed(1)}.`,
          },
        ]
      : []),
    ...((s.dataAgeDays ?? 999) > 2
      ? [
          {
            key: `stale:${today}`,
            title: 'Daily metrics need an update',
            severity: 'MEDIUM',
            detail: s.latest
              ? `Latest entry is ${s.dataAgeDays} days old.`
              : 'No daily metrics have been recorded.',
          },
        ]
      : []),
    ...(s.latest && s.latest.churned > s.latest.newSubs
      ? [
          {
            key: `churn:${s.latest.date}`,
            title: 'Churn exceeds acquisition',
            severity: 'HIGH',
            detail: `${s.latest.churned} churned versus ${s.latest.newSubs} new subscribers on ${s.latest.date}.`,
          },
        ]
      : []),
  ];
  for (const candidate of candidates)
    await db.alert.upsert({
      where: { key: candidate.key },
      update: { detail: candidate.detail, isDemo: s.latest?.isDemo ?? false },
      create: { ...candidate, isDemo: s.latest?.isDemo ?? false },
    });
}
