import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '../lib/db';
import { getWorkspace } from '../lib/workspace';
import { syncSocial } from '../lib/social-sync';
import { SocialReadOnlyProvider, type SocialSnapshot } from '../lib/social';
import { LocalIntelligenceProvider } from '../lib/intelligence';
const actor = 'social-fixture@example.invalid';
class Fixture extends SocialReadOnlyProvider {
  constructor(private value: SocialSnapshot) {
    super('x');
  }
  override async fetchData() {
    return [this.value];
  }
}
const snapshot: SocialSnapshot = {
  provider: 'x',
  accountId: '123',
  username: 'tradelink_pb',
  capturedAt: new Date().toISOString(),
  followers: 100,
  totalPosts: 10,
  posts: [],
  notes: ['Sample only; no subscriber attribution.'],
};
async function clear() {
  await db.socialSnapshot.deleteMany({ where: { accountId: '123' } });
  await db.auditLog.deleteMany({ where: { actor } });
}
beforeEach(async () => {
  vi.stubEnv('X_USER_ID', '123');
  vi.stubEnv('X_USERNAME', 'tradelink_pb');
  vi.stubEnv('X_BEARER_TOKEN', 'fixture-not-live');
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
  await syncSocial(actor, 'x', new Fixture(snapshot));
  let w = await getWorkspace(user.id);
  expect(w.social[0].snapshot?.followers).toBe(100);
  expect(await db.channelMetric.count()).toBe(channelCount);
  const answer = await new LocalIntelligenceProvider().generate({
    type: 'DAILY',
    prompt: 'Growth brief',
    context: w,
  });
  expect(answer.content).toContain('X @tradelink_pb: 100 followers');
  expect(JSON.stringify(w.social)).not.toContain('fixture-not-live');
  await expect(syncSocial(actor, 'x', new Fixture(snapshot))).rejects.toMatchObject({
    code: 'busy',
  });
  await db.auditLog.deleteMany({ where: { actor, action: 'SOCIAL_SYNC_REQUEST' } });
  await syncSocial(actor, 'x', new Fixture({ ...snapshot, followers: 105 }));
  expect(await db.socialSnapshot.count({ where: { accountId: '123' } })).toBe(1);
  vi.stubEnv('X_USER_ID', '999');
  w = await getWorkspace(user.id);
  expect(w.social[0].snapshot).toBeNull();
});
it('retains the last successful snapshot after an upstream failure and audits it safely', async () => {
  await syncSocial(actor, 'x', new Fixture(snapshot));
  await db.auditLog.deleteMany({ where: { actor, action: 'SOCIAL_SYNC_REQUEST' } });
  const provider = new Fixture(snapshot);
  vi.spyOn(provider, 'fetchData').mockRejectedValue(Error('private upstream token value'));
  await expect(syncSocial(actor, 'x', provider)).rejects.toMatchObject({ code: 'unavailable' });
  const saved = await db.socialSnapshot.findFirstOrThrow({ where: { accountId: '123' } });
  expect(saved.data).toMatchObject({ followers: 100 });
  const audits = await db.auditLog.findMany({ where: { actor } });
  expect(audits.some((a) => a.action === 'SOCIAL_SYNC_FAILED')).toBe(true);
  expect(JSON.stringify(audits)).not.toContain('private upstream token value');
});
