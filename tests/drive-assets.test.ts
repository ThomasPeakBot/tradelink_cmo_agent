import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { DriveAssetReader } from '../lib/drive-assets';
import { tradeLinkFolderId } from '../lib/drive';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const asset = {
  fileId: 'asset_fixture',
  name: 'Private image',
  path: 'TradeLink/sub/image',
  mimeType: 'image/png',
  modifiedAt: '2026-10-19T12:00:00Z',
  parentId: 'child_folder',
  size: '4',
};
const inventory: Parameters<typeof DriveAssetReader.create>[0] = {
  folderId: tradeLinkFolderId,
  capturedAt: '2026-10-19T12:00:00Z',
  folders: [
    { fileId: tradeLinkFolderId, path: 'TradeLink' },
    { fileId: 'child_folder', path: 'TradeLink/sub' },
  ],
  files: [asset],
};
beforeEach(() =>
  vi.stubEnv(
    'GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON',
    JSON.stringify({
      client_email: 'fixture@example.invalid',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    }),
  ),
);
afterEach(() => vi.unstubAllEnvs());
const json = (v: unknown) => new Response(JSON.stringify(v));
it('downloads only current authorized inventory members through fixed read-only endpoints', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json({ access_token: 'private-token', token_type: 'Bearer' }))
    .mockResolvedValueOnce(
      json({
        id: asset.fileId,
        mimeType: 'image/png',
        modifiedTime: asset.modifiedAt,
        parents: ['child_folder'],
        size: '4',
      }),
    )
    .mockResolvedValueOnce(new Response('data'));
  const reader = await DriveAssetReader.create(inventory, fetcher);
  expect((await reader.download(asset)).toString()).toBe('data');
  expect(fetcher.mock.calls[2][0].origin).toBe('https://www.googleapis.com');
  expect(fetcher.mock.calls[2][1].redirect).toBe('error');
  expect(fetcher.mock.calls[2][0].href).not.toContain('private-token');
  await expect(reader.download({ ...asset, fileId: 'outside_file' })).rejects.toThrow('outside');
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('rejects changed revisions and moved files before downloading content', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json({ access_token: 'private-token', token_type: 'Bearer' }))
    .mockResolvedValueOnce(
      json({
        id: asset.fileId,
        mimeType: 'image/png',
        modifiedTime: asset.modifiedAt,
        parents: ['outside_folder'],
        size: '4',
      }),
    );
  const reader = await DriveAssetReader.create(inventory, fetcher);
  await expect(reader.download(asset)).rejects.toThrow('scope');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
