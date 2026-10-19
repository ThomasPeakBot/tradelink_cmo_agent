vi.mock('../lib/x-ads-sync', () => ({ syncXAds: mocks.ads }));
vi.mock('../lib/x-ads', () => ({ xAdsConfiguration: () => ({ configured: true }) }));
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  ads: vi.fn(),
  stripe: vi.fn(),
  social: vi.fn(),
  drive: vi.fn(),
  alerts: vi.fn(),
}));
vi.mock('../lib/stripe-sync', () => ({ syncStripe: mocks.stripe }));
vi.mock('../lib/social-sync', () => ({ syncSocial: mocks.social }));
vi.mock('../lib/drive-sync', () => ({ syncDrive: mocks.drive }));
vi.mock('../lib/alerts', () => ({ refreshAlerts: mocks.alerts }));
vi.mock('../lib/stripe', () => ({ stripeConfiguration: () => ({ configured: true }) }));
vi.mock('../lib/social', () => ({ socialConfiguration: () => ({ configured: true }) }));
vi.mock('../lib/drive', () => ({ driveConfiguration: () => ({ configured: false }) }));
import { db } from '../lib/db';
import { syncAll } from '../lib/sync-all';
import { Client } from 'pg';
const actor = 'batch-fixture@example.invalid';
const now = new Date('2026-07-01T08:00:00Z');
async function clear() {
  await db.syncRun.deleteMany({ where: { actor } });
  await db.auditLog.deleteMany({ where: { actor } });
}
beforeEach(async () => {
  vi.clearAllMocks();
  await clear();
});
afterEach(clear);
afterAll(() => db.$disconnect());
it('isolates provider failures, skips absent credentials, and deduplicates a scheduled Eastern day', async () => {
  mocks.social.mockImplementation(async (_actor, platform) => {
    if (platform === 'x') throw Error('private token value');
  });
  const result = await syncAll(actor, 'SCHEDULED', now);
  expect(result.status).toBe('PARTIAL');
  expect(result.results).toEqual(
    expect.arrayContaining([
      {
        provider: 'drive',
        status: 'SKIPPED',
        message: 'Not configured; no external request was made.',
      },
    ]),
  );
  expect(mocks.social).toHaveBeenCalledTimes(2);
  expect(mocks.ads).toHaveBeenCalledWith(actor);
  expect(mocks.drive).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain('private token value');
  await syncAll(actor, 'SCHEDULED', new Date('2026-07-01T09:00:00Z'));
  expect(mocks.social).toHaveBeenCalledTimes(2);
  expect(await db.syncRun.count({ where: { actor } })).toBe(1);
});
it('allows manual sync any time but rejects overlapping full syncs using PostgreSQL', async () => {
  const connection = new Client({ connectionString: process.env.DATABASE_URL });
  await connection.connect();
  await connection.query('SELECT pg_advisory_lock(74182358)');
  try {
    await expect(syncAll(actor, 'MANUAL', now)).rejects.toThrow('already running');
  } finally {
    await connection.end();
  }
  await syncAll(actor, 'MANUAL', new Date('2026-07-01T06:00:00Z'));
  expect(mocks.stripe).toHaveBeenCalledTimes(1);
});
it('does nothing before 4am and resumes an orphaned run without repeating completed providers', async () => {
  await syncAll(actor, 'SCHEDULED', new Date('2026-07-01T07:00:00Z'));
  expect(mocks.stripe).not.toHaveBeenCalled();
  await db.syncRun.create({
    data: {
      actor,
      trigger: 'SCHEDULED',
      scheduledDay: new Date('2026-07-01'),
      status: 'RUNNING',
      results: [{ provider: 'stripe', status: 'SUCCESS', message: 'previously saved' }],
    },
  });
  await syncAll(actor, 'SCHEDULED', now);
  expect(mocks.stripe).not.toHaveBeenCalled();
  expect(mocks.social).toHaveBeenCalledTimes(2);
});
