import { generateKeyPairSync, createPublicKey, verify } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DriveReadOnlyProvider, driveConfiguration, tradeLinkFolderId } from '../lib/drive';
import { driveEvidence } from '../lib/drive-evidence';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const secret = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const folder = 'application/vnd.google-apps.folder';
const doc = {
  id: 'document_123',
  name: 'Positioning',
  mimeType: 'application/vnd.google-apps.document',
  modifiedTime: '2026-10-18T12:00:00.000Z',
  parents: [tradeLinkFolderId],
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const token = () => json({ access_token: 'test-access-token', token_type: 'Bearer' });
const root = () => json({ id: tradeLinkFolderId, name: 'TradeLink', mimeType: folder });
beforeEach(() =>
  vi.stubEnv(
    'GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON',
    JSON.stringify({
      client_email: 'fixture@example.iam.gserviceaccount.com',
      private_key: secret,
    }),
  ),
);
afterEach(() => vi.unstubAllEnvs());
it('never exposes service-account credentials in configuration', () => {
  expect(driveConfiguration()).toMatchObject({ configured: true, folderId: tradeLinkFolderId });
  expect(JSON.stringify(driveConfiguration())).not.toContain('PRIVATE KEY');
  vi.stubEnv('GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON', 'invalid');
  expect(driveConfiguration().configured).toBe(false);
});
it('uses a signed non-delegated read-only JWT and imports only confirmed descendants', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(token())
    .mockResolvedValueOnce(root())
    .mockResolvedValueOnce(json({ files: [doc] }))
    .mockResolvedValueOnce(new Response('Approved company positioning'));
  const result = await new DriveReadOnlyProvider(fetcher).fetchData();
  expect(result.documents[0]).toMatchObject({
    fileId: doc.id,
    content: 'Approved company positioning',
    truncated: false,
  });
  const [authUrl, authOptions] = fetcher.mock.calls[0];
  expect(authUrl).toBe('https://oauth2.googleapis.com/token');
  const assertion = authOptions.body.get('assertion');
  const parts = assertion.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  expect(payload.scope).toBe('https://www.googleapis.com/auth/drive.readonly');
  expect(payload.sub).toBeUndefined();
  expect(
    verify(
      'RSA-SHA256',
      Buffer.from(parts[0] + '.' + parts[1]),
      createPublicKey(privateKey),
      Buffer.from(parts[2], 'base64url'),
    ),
  ).toBe(true);
  for (const [url, options] of fetcher.mock.calls.slice(1)) {
    expect(url.origin).toBe('https://www.googleapis.com');
    expect(options.method).toBe('GET');
    expect(options.redirect).toBe('error');
    expect(url.href).not.toContain('test-access-token');
  }
  expect(JSON.stringify(result)).not.toContain('test-access-token');
});
it('paginates, traverses subfolders and skips shortcuts/PDFs without following their targets', async () => {
  const sub = {
    id: 'subfolder_123',
    name: 'Strategy',
    mimeType: folder,
    parents: [tradeLinkFolderId],
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(token())
    .mockResolvedValueOnce(root())
    .mockResolvedValueOnce(json({ files: [sub], nextPageToken: 'next' }))
    .mockResolvedValueOnce(
      json({
        files: [
          { ...doc, id: 'pdf_123', mimeType: 'application/pdf' },
          { ...doc, id: 'shortcut_123', mimeType: 'application/vnd.google-apps.shortcut' },
        ],
      }),
    )
    .mockResolvedValueOnce(json({ files: [{ ...doc, parents: [sub.id], mimeType: 'text/plain' }] }))
    .mockResolvedValueOnce(new Response('Nested reference'));
  const result = await new DriveReadOnlyProvider(fetcher).fetchData();
  expect(result.skipped).toBe(2);
  expect(result.documents[0].path).toBe('TradeLink/Strategy/Positioning');
  expect(fetcher.mock.calls[3][0].searchParams.get('pageToken')).toBe('next');
  expect(fetcher.mock.calls[5][0].searchParams.get('alt')).toBe('media');
});
it('rejects outside-folder files, wrong roots and incomplete searches', async () => {
  for (const result of [
    { files: [{ ...doc, parents: ['outside_folder'] }] },
    { files: [], incompleteSearch: true },
  ]) {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(root())
      .mockResolvedValueOnce(json(result));
    await expect(new DriveReadOnlyProvider(fetcher).fetchData()).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  }
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(token())
    .mockResolvedValueOnce(json({ id: 'wrong_folder', name: 'Other', mimeType: folder }));
  await expect(new DriveReadOnlyProvider(fetcher).fetchData()).rejects.toMatchObject({
    code: 'unavailable',
  });
});
it('retains complete supported text and rejects oversized or inaccessible files safely', async () => {
  const setup = () =>
    vi
      .fn()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(root())
      .mockResolvedValueOnce(json({ files: [doc] }));
  const complete = setup().mockResolvedValueOnce(new Response('x'.repeat(21000)));
  expect((await new DriveReadOnlyProvider(complete).fetchData()).documents[0]).toMatchObject({
    truncated: false,
    content: 'x'.repeat(21000),
  });
  const oversized = setup().mockResolvedValueOnce(new Response('x'.repeat(100001)));
  await expect(new DriveReadOnlyProvider(oversized).fetchData()).rejects.toMatchObject({
    code: 'limit',
  });
  const denied = setup().mockResolvedValueOnce(
    json({ error: { message: 'private upstream detail' } }, 403),
  );
  const error = await new DriveReadOnlyProvider(denied).fetchData().catch((e) => e);
  expect(error.code).toBe('access');
  expect(error.message).not.toContain('private upstream detail');
});
it('bounds CMO evidence, selects relevant documents, retains citations and excludes unavailable imports', () => {
  const documents = Array.from({ length: 12 }, (_, i) => ({
    fileId: 'document_' + i,
    name: i === 10 ? 'Referral strategy' : 'General document',
    path: 'TradeLink/doc',
    sourceUrl: 'https://drive.google.com/file/d/document_' + i + '/view',
    modifiedAt: '2026-10-18T12:00:00Z',
    syncedAt: '2026-10-18T13:00:00Z',
    content: 'x'.repeat(9000),
    truncated: false,
  }));
  const result = driveEvidence({ available: true, documents }, 'Referral strategy');
  expect(result.documents).toHaveLength(8);
  expect(result.documents[0].name).toBe('Referral strategy');
  expect(result.documents[0].content.length).toBe(4000);
  expect(result.documents[0].sourceUrl).toContain('document_10');
  expect(driveEvidence({ available: false, documents }, 'Referral').documents).toEqual([]);
});
