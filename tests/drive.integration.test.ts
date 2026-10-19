import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '../lib/db';
import { syncDrive } from '../lib/drive-sync';
import { getWorkspace } from '../lib/workspace';
import { DriveReadOnlyProvider, tradeLinkFolderId, type DriveImport } from '../lib/drive';
import { LocalIntelligenceProvider } from '../lib/intelligence';
const actor = 'drive-fixture@example.invalid';
class Fixture extends DriveReadOnlyProvider {
  constructor(private value: DriveImport) {
    super();
  }
  override async fetchData() {
    return this.value;
  }
}
const result: DriveImport = {
  folderId: tradeLinkFolderId,
  folderName: 'TradeLink',
  capturedAt: new Date().toISOString(),
  skipped: 1,
  folders: [{ fileId: tradeLinkFolderId, path: 'TradeLink' }],
  inventory: [
    {
      fileId: 'fixture_image',
      name: 'Asset',
      path: 'TradeLink/Asset',
      mimeType: 'image/png',
      modifiedAt: new Date().toISOString(),
      parentId: tradeLinkFolderId,
      size: '1024',
    },
  ],
  documents: [
    {
      fileId: 'fixture_document',
      name: 'Referral positioning',
      path: 'TradeLink/Referral positioning',
      modifiedAt: new Date().toISOString(),
      content: 'Approved referral audience evidence',
      truncated: false,
    },
  ],
};
async function clear() {
  await db.report.deleteMany({ where: { id: 'drive-file-inventory' } });
  await db.driveDocument.deleteMany({ where: { folderId: tradeLinkFolderId } });
  await db.driveSync.deleteMany({ where: { folderId: tradeLinkFolderId } });
  await db.auditLog.deleteMany({ where: { actor } });
}
beforeEach(async () => {
  vi.stubEnv(
    'GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON',
    JSON.stringify({ client_email: 'fixture@example.invalid', private_key: 'x'.repeat(200) }),
  );
  await clear();
});
afterEach(async () => {
  await clear();
  vi.unstubAllEnvs();
});
afterAll(() => db.$disconnect());
it('atomically replaces folder references, preserves manual knowledge and grounds CMO answers', async () => {
  const user = await db.user.findUniqueOrThrow({ where: { email: 'admin@tradelink.local' } });
  const manual = await db.knowledge.count();
  await syncDrive(actor, new Fixture(result));
  const inventory = await db.report.findUniqueOrThrow({ where: { id: 'drive-file-inventory' } });
  expect(JSON.parse(inventory.content)).toMatchObject({
    folderId: tradeLinkFolderId,
    files: [{ fileId: 'fixture_image', path: 'TradeLink/Asset' }],
  });
  const w = await getWorkspace(user.id);
  expect(w.drive.documents[0].content).toContain('Approved referral');
  expect(await db.knowledge.count()).toBe(manual);
  const answer = await new LocalIntelligenceProvider().generate({
    type: 'CHAT',
    prompt: 'Referral',
    context: w,
  });
  expect(answer.content).toContain('Referral positioning');
  expect(answer.content).toContain('https://drive.google.com/file/d/fixture_document/view');
  await expect(syncDrive(actor, new Fixture(result))).rejects.toMatchObject({ code: 'busy' });
  await db.auditLog.deleteMany({ where: { actor, action: 'DRIVE_SYNC_REQUEST' } });
  await syncDrive(actor, new Fixture({ ...result, documents: [] }));
  expect(await db.driveDocument.count({ where: { folderId: tradeLinkFolderId } })).toBe(0);
});
it('retains cached content but excludes it from new evidence after failed access', async () => {
  const user = await db.user.findUniqueOrThrow({ where: { email: 'admin@tradelink.local' } });
  await syncDrive(actor, new Fixture(result));
  await db.auditLog.deleteMany({ where: { actor, action: 'DRIVE_SYNC_REQUEST' } });
  const provider = new Fixture(result);
  vi.spyOn(provider, 'fetchData').mockRejectedValue(Error('secret upstream credential'));
  await expect(syncDrive(actor, provider)).rejects.toMatchObject({ code: 'unavailable' });
  expect(await db.driveDocument.count({ where: { folderId: tradeLinkFolderId } })).toBe(1);
  const w = await getWorkspace(user.id);
  expect(w.drive.available).toBe(false);
  expect(w.drive.documents).toEqual([]);
  expect(JSON.stringify(await db.auditLog.findMany({ where: { actor } }))).not.toContain(
    'secret upstream credential',
  );
});
