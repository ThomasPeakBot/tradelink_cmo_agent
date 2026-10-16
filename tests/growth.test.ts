import { describe, it, expect } from 'vitest';
import { growthSummary, targetAt, prioritize, type Metric } from '../lib/growth';
const goal = {
  goalStart: 50,
  goalTarget: 5000,
  goalStartDate: '2026-01-01',
  goalEndDate: '2027-01-01',
};
const metric = (date: string, subscribers: number, newSubs = 4, churned = 1): Metric => ({
  date,
  subscribers,
  newSubs,
  churned,
  visitors: 100,
  mrr: 1000,
  spend: 10,
  isDemo: false,
});
describe('subscriber trajectory and forecasts', () => {
  it('anchors the trajectory at 50 and 5000 and clamps dates', () => {
    expect(targetAt(goal, '2025-01-01')).toBe(50);
    expect(targetAt(goal, '2026-01-01')).toBe(50);
    expect(targetAt(goal, '2027-01-01')).toBe(5000);
    expect(targetAt(goal, '2028-01-01')).toBe(5000);
  });
  it('uses geometric interpolation, not a linear subscriber target', () => {
    expect(targetAt(goal, new Date(Date.parse(goal.goalStartDate) + 182 * 86400000))).toBeCloseTo(
      496.855,
      2,
    );
  });
  it('reports behind and ahead pace from actual observations', () => {
    expect(growthSummary(goal, [metric('2026-07-01', 100)], new Date('2026-07-01')).status).toBe(
      'BEHIND',
    );
    expect(growthSummary(goal, [metric('2026-07-01', 1000)], new Date('2026-07-01')).status).toBe(
      'AHEAD',
    );
  });
  it('does not fabricate an actual count without observations', () => {
    const s = growthSummary(goal, [], new Date('2026-07-01'));
    expect(s.status).toBe('NO DATA');
    expect(s.current).toBeNull();
    expect(s.forecasts.base).toBeNull();
  });
  it('excludes future observations and reports staleness', () => {
    const s = growthSummary(
      goal,
      [metric('2026-06-28', 100), metric('2026-08-01', 5000)],
      new Date('2026-07-01'),
    );
    expect(s.current).toBe(100);
    expect(s.dataAgeDays).toBe(3);
  });
  it('uses observed dates only, and states sample size for sparse data', () => {
    const s = growthSummary(
      goal,
      [
        metric('2026-06-01', 50, 100),
        metric('2026-06-15', 70, 5, 1),
        metric('2026-07-01', 100, 9, 1),
      ],
      new Date('2026-07-01'),
    );
    expect(s.sampleDays).toBe(2);
    expect(s.averageNet).toBe(6);
    expect(s.forecasts.downside!).toBeLessThan(s.forecasts.base!);
    expect(s.forecasts.upside!).toBeGreaterThan(s.forecasts.base!);
  });
  it('floors shrinking forecasts at zero and handles an expired goal', () => {
    const s = growthSummary(goal, [metric('2026-07-01', 10, 0, 100)], new Date('2026-07-01'));
    expect(s.forecasts.base).toBe(0);
    const expired = growthSummary(goal, [metric('2027-02-01', 100)], new Date('2027-02-01'));
    expect(expired.remainingDays).toBe(0);
    expect(expired.forecasts.base).toBe(100);
  });
  it('outputs 12 monthly milestones plus the baseline', () => {
    const s = growthSummary(goal, [], new Date('2026-01-01'));
    expect(s.trajectory).toHaveLength(13);
    expect(s.trajectory.at(-1)?.target).toBe(5000);
  });
  it('ranks active experiments by ICE and excludes completed work', () => {
    const result = prioritize([
      { status: 'COMPLETED', impact: 10, confidence: 10, ease: 10 },
      { status: 'BACKLOG', impact: 9, confidence: 8, ease: 8 },
      { status: 'RUNNING', impact: 2, confidence: 3, ease: 4 },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].score).toBe(576);
  });
});
