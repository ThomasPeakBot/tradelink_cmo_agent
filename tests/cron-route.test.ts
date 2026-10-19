import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock('@/lib/sync-all', () => ({ syncAll: mocks.sync, SyncBusyError: class extends Error {} }));
import { POST } from '../app/api/internal/sync/route';
const secret = 'fixture-secret-with-at-least-32-characters';
const request = (value = secret) =>
  new Request('https://example.invalid/api/internal/sync', {
    method: 'POST',
    headers: { Authorization: `Bearer ${value}` },
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SYNC_CRON_SECRET', secret);
});
afterEach(() => vi.unstubAllEnvs());
it('rejects absent, incorrect and short secrets without invoking providers', async () => {
  expect((await POST(request('wrong'))).status).toBe(401);
  vi.stubEnv('SYNC_CRON_SECRET', '');
  expect((await POST(request(''))).status).toBe(401);
  expect(mocks.sync).not.toHaveBeenCalled();
});
it('accepts the cron credential and reports partial failure as a failed job', async () => {
  mocks.sync.mockResolvedValueOnce({ status: 'SUCCESS', results: [] });
  expect((await POST(request())).status).toBe(200);
  expect(mocks.sync).toHaveBeenCalledWith('scheduled-sync', 'SCHEDULED');
  mocks.sync.mockResolvedValueOnce({ status: 'PARTIAL', results: [] });
  expect((await POST(request())).status).toBe(503);
});
