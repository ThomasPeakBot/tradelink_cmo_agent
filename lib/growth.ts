export type Metric = {
  source?: string;
  date: string;
  subscribers: number;
  newSubs: number | null;
  churned: number | null;
  visitors: number | null;
  mrr: number | null;
  spend: number | null;
  isDemo: boolean;
};
export type Goal = {
  goalStart: number;
  goalTarget: number;
  goalStartDate: string;
  goalEndDate: string;
};
const dayMs = 86400000;
export const utcDay = (value: string | Date) =>
  new Date(new Date(value).toISOString().slice(0, 10) + 'T00:00:00.000Z');
export function targetAt(goal: Goal, date: string | Date): number {
  const total = (utcDay(goal.goalEndDate).getTime() - utcDay(goal.goalStartDate).getTime()) / dayMs;
  const elapsed = (utcDay(date).getTime() - utcDay(goal.goalStartDate).getTime()) / dayMs;
  const fraction = Math.min(1, Math.max(0, elapsed / Math.max(total, 1)));
  return goal.goalStart * Math.pow(goal.goalTarget / goal.goalStart, fraction);
}
export function growthSummary(goal: Goal, metrics: Metric[], now = new Date()) {
  const ordered = metrics
    .filter((m) => utcDay(m.date) <= utcDay(now))
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = ordered.at(-1);
  const current = latest?.subscribers ?? null;
  const expected = targetAt(goal, now);
  const recent = latest
    ? ordered.filter((m) => (utcDay(latest.date).getTime() - utcDay(m.date).getTime()) / dayMs < 30)
    : [];
  const span =
    recent.length > 1
      ? Math.min(
          30,
          (utcDay(recent.at(-1)!.date).getTime() - utcDay(recent[0].date).getTime()) / dayMs + 1,
        )
      : recent.length;
  const flow = recent.filter((m) => m.newSubs !== null && m.churned !== null);
  const averageNet = flow.length
    ? flow.reduce((a, m) => a + m.newSubs! - m.churned!, 0) / flow.length
    : 0;
  const remainingDays = Math.max(
    0,
    Math.ceil((utcDay(goal.goalEndDate).getTime() - utcDay(now).getTime()) / dayMs),
  );
  const gap = current === null ? null : current - expected;
  const dataAgeDays = latest
    ? Math.round((utcDay(now).getTime() - utcDay(latest.date).getTime()) / dayMs)
    : null;
  const project = (factor: number) =>
    current === null || !flow.length
      ? null
      : Math.max(0, Math.round(current + averageNet * factor * remainingDays));
  return {
    current,
    expected: Math.round(expected),
    gap: gap === null ? null : Math.round(gap),
    pacePercent: current === null ? null : (current / expected - 1) * 100,
    status: current === null ? 'NO DATA' : current >= expected ? 'AHEAD' : 'BEHIND',
    remainingDays,
    averageNet,
    requiredDaily:
      current === null
        ? null
        : remainingDays
          ? Math.max(0, (goal.goalTarget - current) / remainingDays)
          : 0,
    latest,
    dataAgeDays,
    sampleDays: flow.length,
    sampleSpan: span,
    forecasts: { downside: project(0.65), base: project(1), upside: project(1.35) },
    trajectory: Array.from({ length: 13 }, (_, month) => {
      const time = new Date(
        utcDay(goal.goalStartDate).getTime() +
          ((utcDay(goal.goalEndDate).getTime() - utcDay(goal.goalStartDate).getTime()) * month) /
            12,
      );
      return {
        month,
        date: time.toISOString().slice(0, 10),
        target: Math.round(targetAt(goal, time)),
      };
    }),
  };
}
export function prioritize<
  T extends { impact: number; confidence: number; ease: number; status: string },
>(experiments: T[]) {
  return experiments
    .filter((e) => !['COMPLETED', 'CANCELLED'].includes(e.status))
    .map((e) => ({ ...e, score: e.impact * e.confidence * e.ease }))
    .sort((a, b) => b.score - a.score);
}
