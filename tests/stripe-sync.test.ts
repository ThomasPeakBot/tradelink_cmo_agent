import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  lease: false,
  records: [] as unknown[],
  upsert: vi.fn(),
  createAudit: vi.fn(),
}));
vi.mock('../lib/db', () => {
  const tx = {
    $queryRaw: vi.fn(),
    auditLog: {
      findFirst: vi.fn(async () => (state.lease ? { id: 'existing' } : null)),
      create: state.createAudit,
    },
    stripeSnapshot: { upsert: state.upsert },
  };
  return {
    db: { ...tx, $transaction: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx) },
  };
});
import { syncStripe } from '../lib/stripe-sync';
import { StripeReadError, stripeScope, type StripeReadOnlyProvider } from '../lib/stripe';
beforeEach(() => {
  vi.stubEnv('STRIPE_PRODUCT_IDS', 'prod_TradeLink');
  state.lease = false;
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());
const provider = (fetchData: () => Promise<unknown>) => ({ fetchData }) as StripeReadOnlyProvider;
it('does not fetch or persist when another sync holds the durable lease', async () => {
  state.lease = true;
  const fetchData = vi.fn();
  await expect(syncStripe('admin', provider(fetchData))).rejects.toThrow('recently');
  expect(fetchData).not.toHaveBeenCalled();
  expect(state.upsert).not.toHaveBeenCalled();
});
it('retains previous snapshots and writes a sanitized failure audit when a read fails', async () => {
  const secret = 'never-log-upstream-credentials';
  await expect(
    syncStripe(
      'admin',
      provider(async () => {
        throw new StripeReadError('network', secret);
      }),
    ),
  ).rejects.toThrow();
  expect(state.upsert).not.toHaveBeenCalled();
  expect(JSON.stringify(state.createAudit.mock.calls)).not.toContain(secret);
  expect(state.createAudit.mock.calls.at(-1)?.[0].data.action).toBe('STRIPE_SYNC_FAILED');
});
it('upserts one UTC-date/scope snapshot and audits the successful read', async () => {
  const s = {
    scopeId: stripeScope().id,
    capturedAt: '2026-10-16T23:59:00Z',
    customerIds: ['cus_A'],
  };
  await syncStripe(
    'admin',
    provider(async () => [s]),
  );
  expect(state.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { scopeId_date: { scopeId: s.scopeId, date: new Date('2026-10-16') } },
    }),
  );
  expect(state.createAudit.mock.calls.at(-1)?.[0].data.action).toBe('STRIPE_SYNC_SUCCESS');
});
