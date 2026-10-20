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

it('allows email only at 9am Eastern through both DST transitions', () => {
  for (const day of ['2026-03-08', '2026-07-01', '2026-10-21']) {
    expect(easternSchedule(new Date(`${day}T12:59:59Z`), 9, true).due).toBe(false);
    expect(easternSchedule(new Date(`${day}T13:00:00Z`), 9, true).due).toBe(true);
    expect(easternSchedule(new Date(`${day}T14:00:00Z`), 9, true).due).toBe(false);
  }
  for (const day of ['2026-11-01', '2026-12-01']) {
    expect(easternSchedule(new Date(`${day}T13:00:00Z`), 9, true).due).toBe(false);
    expect(easternSchedule(new Date(`${day}T14:00:00Z`), 9, true).due).toBe(true);
  }
});
