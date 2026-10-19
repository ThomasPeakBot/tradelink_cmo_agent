import { expect, it } from 'vitest';
import { easternSchedule, batchStatus } from '../lib/sync-state';
it('runs at 4am Eastern in both winter and summer, never at 3am', () => {
  expect(easternSchedule(new Date('2026-07-01T07:59:59Z'))).toEqual({
    day: '2026-07-01',
    due: false,
  });
  expect(easternSchedule(new Date('2026-07-01T08:00:00Z')).due).toBe(true);
  expect(easternSchedule(new Date('2026-12-01T08:00:00Z')).due).toBe(false);
  expect(easternSchedule(new Date('2026-12-01T09:00:00Z')).due).toBe(true);
});
it('handles both DST transition days and uses the Eastern date near UTC midnight', () => {
  expect(easternSchedule(new Date('2026-03-08T08:00:00Z'))).toEqual({
    day: '2026-03-08',
    due: true,
  });
  expect(easternSchedule(new Date('2026-11-01T08:00:00Z')).due).toBe(false);
  expect(easternSchedule(new Date('2026-11-01T09:00:00Z')).due).toBe(true);
  expect(easternSchedule(new Date('2026-10-19T00:00:00Z')).day).toBe('2026-10-18');
});
it('never labels failures or all-skipped providers as a successful import', () => {
  expect(
    batchStatus([
      { provider: 'x', status: 'FAILED', message: 'failed' },
      { provider: 'stripe', status: 'SUCCESS', message: 'done' },
    ]),
  ).toBe('PARTIAL');
  expect(
    batchStatus([
      { provider: 'drive', status: 'SKIPPED', message: 'unconfigured' },
      { provider: 'alerts', status: 'SUCCESS', message: 'refreshed' },
    ]),
  ).toBe('SKIPPED');
  expect(batchStatus([{ provider: 'instagram', status: 'FAILED', message: 'failed' }])).toBe(
    'FAILED',
  );
});
