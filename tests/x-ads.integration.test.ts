import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '../lib/db';
import { getWorkspace } from '../lib/workspace';
import { syncXAds } from '../lib/x-ads-sync';
import { type XAdsProvider, type XAdsSnapshot } from '../lib/x-ads';
import { companyEvidence } from '../lib/intelligence';
import { LocalIntelligenceProvider } from '../lib/intelligence';
const actor = 'ads-fixture@example.invalid';
class Fixture implements XAdsProvider {
  constructor(private value: XAdsSnapshot) {}
  async fetchData() {
    return this.value;
  }
}
const snapshot: XAdsSnapshot = {
  accountId: 'adsfixture',
  accountName: 'TradeLink fixture',
  currency: 'USD',
  timezone: 'UTC',
  capturedAt: new Date().toISOString(),
  startTime: '2026-10-12T00:00:00Z',
  endTime: '2026-10-19T00:00:00Z',
  placement: 'ALL_ON_TWITTER',
  totals: { spend: 25, impressions: 1000, clicks: 30, urlClicks: 20, engagements: 40 },
  campaigns: [],
  notes: ['No subscriber attribution.'],
};
async function clear() {
  await db.xAdsSnapshot.deleteMany({ where: { accountId: 'adsfixture' } });
  await db.auditLog.deleteMany({ where: { actor } });
}
beforeEach(async () => {
  vi.stubEnv('X_ADS_ACCOUNT_ID', 'adsfixture');
  for (const key of [
    'X_ADS_CONSUMER_KEY',
    'X_ADS_CONSUMER_SECRET',
    'X_ADS_ACCESS_TOKEN',
    'X_ADS_ACCESS_TOKEN_SECRET',
  ])
    vi.stubEnv(key, 'fixture-not-live');
  await clear();
});
afterEach(async () => {
  await clear();
  vi.unstubAllEnvs();
});
afterAll(() => db.$disconnect());
it('persists daily snapshots, grounds CMO evidence and isolates account changes', async () => {
  const user = await db.user.findUniqueOrThrow({ where: { email: 'admin@tradelink.local' } });
  const channelCount = await db.channelMetric.count();
  await syncXAds(actor, new Fixture(snapshot));
  let w = await getWorkspace(user.id);
  expect(w.xAds.snapshot?.totals.spend).toBe(25);
  expect(await db.channelMetric.count()).toBe(channelCount);
  const answer = await new LocalIntelligenceProvider().generate({
    type: 'DAILY',
    prompt: 'Growth brief',
    context: w,
  });
  expect(answer.content).toContain('spend 25 USD');
  expect(companyEvidence(w, 'ads').paidXAdvertising.snapshot?.totals.spend).toBe(25);
  expect(JSON.stringify(w.xAds)).not.toContain('fixture-not-live');
  await expect(syncXAds(actor, new Fixture(snapshot))).rejects.toMatchObject({
    code: 'busy',
  });
  await db.auditLog.deleteMany({ where: { actor, action: 'X_ADS_SYNC_REQUEST' } });
  await syncXAds(actor, new Fixture({ ...snapshot, totals: { ...snapshot.totals, spend: 30 } }));
  expect(await db.xAdsSnapshot.count({ where: { accountId: 'adsfixture' } })).toBe(1);
  vi.stubEnv('X_ADS_ACCOUNT_ID', '999');
  w = await getWorkspace(user.id);
  expect(w.xAds.snapshot).toBeNull();
});
it('retains the last successful snapshot after an upstream failure and audits it safely', async () => {
  await syncXAds(actor, new Fixture(snapshot));
  await db.auditLog.deleteMany({ where: { actor, action: 'X_ADS_SYNC_REQUEST' } });
  const provider = new Fixture(snapshot);
  vi.spyOn(provider, 'fetchData').mockRejectedValue(Error('private upstream token value'));
  await expect(syncXAds(actor, provider)).rejects.toMatchObject({ code: 'unavailable' });
  const saved = await db.xAdsSnapshot.findFirstOrThrow({ where: { accountId: 'adsfixture' } });
  expect(saved.data).toMatchObject({ totals: { spend: 25 } });
  const audits = await db.auditLog.findMany({ where: { actor } });
  expect(audits.some((a) => a.action === 'X_ADS_SYNC_FAILED')).toBe(true);
  expect(JSON.stringify(audits)).not.toContain('private upstream token value');
});
