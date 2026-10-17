import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../lib/db';
import { syncStripe } from '../lib/stripe-sync';
import {
  StripeReadOnlyProvider,
  StripeReadError,
  stripeScope,
  type StripeSnapshot,
} from '../lib/stripe';
import { getWorkspace } from '../lib/workspace';
import { refreshAlerts } from '../lib/alerts';
import { LocalIntelligenceProvider } from '../lib/intelligence';
const actor = 'stripe-integration-fixture@example.invalid';
let scopeId = '';
class FixtureProvider extends StripeReadOnlyProvider {
  constructor(private readonly fixture: StripeSnapshot) {
    super('');
  }
  override async fetchData() {
    return [this.fixture];
  }
}
function snapshot(customers: string[], daysAgo = 0): StripeSnapshot {
  const captured = new Date();
  captured.setUTCDate(captured.getUTCDate() - daysAgo);
  return {
    capturedAt: captured.toISOString(),
    scopeId,
    productIds: ['prod_IntegrationFixture'],
    customerIds: customers,
    activeSubscriptions: customers.length,
    trialingSubscriptions: 0,
    pastDueSubscriptions: 0,
    grossMrr: customers.length * 40,
    paidInvoiceAmountMonthToDate: 80,
    paidInvoicesMonthToDate: 2,
    warnings: [],
  };
}
beforeEach(async () => {
  vi.stubEnv('STRIPE_PRODUCT_IDS', 'prod_IntegrationFixture');
  vi.stubEnv('STRIPE_SECRET_KEY', ['rk', 'live', 'fixtureNotARealCredential'].join('_'));
  scopeId = stripeScope().id;
  await db.stripeSnapshot.deleteMany({ where: { scopeId } });
  await db.auditLog.deleteMany({ where: { actor } });
});
afterEach(async () => {
  await db.stripeSnapshot.deleteMany({ where: { scopeId } });
  await db.auditLog.deleteMany({ where: { actor } });
  vi.unstubAllEnvs();
});
afterAll(() => db.$disconnect());
describe('persisted Stripe evidence', () => {
  it('stores scoped snapshots, retains manual rows, and exposes only aggregates to workspace and reports', async () => {
    const user = await db.user.findUniqueOrThrow({ where: { email: 'admin@tradelink.local' } });
    const manualCount = await db.dailyMetric.count();
    await syncStripe(actor, new FixtureProvider(snapshot(['cus_privatePrevious'], 1)));
    await db.auditLog.deleteMany({ where: { actor, action: 'STRIPE_SYNC_REQUEST' } });
    await syncStripe(
      actor,
      new FixtureProvider(snapshot(['cus_privateCurrent', 'cus_privateOther'])),
    );
    const w = await getWorkspace(user.id);
    expect(w.metrics).toHaveLength(2);
    expect(w.metrics.every((m) => m.source === 'stripe' && !m.isDemo)).toBe(true);
    expect(w.summary.current).toBe(2);
    expect(w.summary.latest).toMatchObject({ newSubs: 2, churned: 1, mrr: 80 });
    expect(w.summary.forecasts.base).not.toBeNull();
    expect(w.stripe.lastSync).not.toBeNull();
    expect(await db.dailyMetric.count()).toBe(manualCount);
    expect(JSON.stringify(w)).not.toContain('cus_private');
    const report = await new LocalIntelligenceProvider().generate({
      type: 'WEEKLY',
      prompt: 'Review billing',
      context: w,
    });
    expect(report.content).toContain('Gross MRR');
    expect(report.content).toContain('observed set changes');
    expect(report.content).not.toContain('cus_private');
    await refreshAlerts(user.id);
    expect(await db.alert.count()).toBeGreaterThan(0);
  });
  it('rejects concurrent requests and leaves the last snapshot intact on failure', async () => {
    await syncStripe(actor, new FixtureProvider(snapshot(['cus_privateCurrent'])));
    await expect(syncStripe(actor, new FixtureProvider(snapshot([])))).rejects.toThrow('recently');
    await db.auditLog.deleteMany({ where: { actor, action: 'STRIPE_SYNC_REQUEST' } });
    class Failing extends StripeReadOnlyProvider {
      override async fetchData(): Promise<StripeSnapshot[]> {
        throw new StripeReadError('network', 'Read failed');
      }
    }
    await expect(syncStripe(actor, new Failing(''))).rejects.toThrow('Read failed');
    expect(await db.stripeSnapshot.count({ where: { scopeId } })).toBe(1);
    const row = await db.stripeSnapshot.findFirstOrThrow({ where: { scopeId } });
    expect(row.data).toMatchObject({ customerIds: ['cus_privateCurrent'] });
    expect(await db.auditLog.count({ where: { actor, action: 'STRIPE_SYNC_FAILED' } })).toBe(1);
  });
});
