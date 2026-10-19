import { z } from 'zod';
import { driveAccessToken, tradeLinkFolderId } from './drive';
export const driveInventorySchema = z.object({
  folderId: z.literal(tradeLinkFolderId),
  capturedAt: z.string().datetime(),
  folders: z.array(z.object({ fileId: z.string(), path: z.string() })).max(100),
  files: z
    .array(
      z.object({
        fileId: z.string().regex(/^[\w-]{5,150}$/),
        name: z.string(),
        path: z.string(),
        mimeType: z.string(),
        modifiedAt: z.string().datetime(),
        parentId: z.string(),
        size: z.string().nullable(),
      }),
    )
    .max(100),
});
export type DriveAsset = z.infer<typeof driveInventorySchema>['files'][number];
async function bytes(response: Response, maximum: number, onChunk?: (size: number) => void) {
  if (!response.ok) throw Error('Drive asset access rejected');
  const reader = response.body?.getReader();
  if (!reader) throw Error('Empty asset response');
  const chunks: Uint8Array[] = [];
  let count = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      count += part.value.length;
      onChunk?.(part.value.length);
      if (count > maximum) throw Error('Asset exceeds download bound');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
export class DriveAssetReader {
  private total = 0;
  private allowed = new Map<string, DriveAsset>();
  private constructor(
    private token: string,
    private fetcher: typeof fetch,
  ) {}
  static async create(
    inventory: z.infer<typeof driveInventorySchema>,
    fetcher: typeof fetch = fetch,
  ) {
    const parsed = driveInventorySchema.parse(inventory);
    const reader = new DriveAssetReader(await driveAccessToken(fetcher), fetcher);
    const folders = new Set(parsed.folders.map((f) => f.fileId));
    if (!folders.has(tradeLinkFolderId)) throw Error('Missing root scope');
    for (const asset of parsed.files) {
      if (!folders.has(asset.parentId)) throw Error('Asset parent outside scanned hierarchy');
      reader.allowed.set(asset.fileId, asset);
    }
    return reader;
  }
  async download(asset: DriveAsset) {
    const allowed = this.allowed.get(asset.fileId);
    if (!allowed || JSON.stringify(allowed) !== JSON.stringify(asset))
      throw Error('Asset is outside scanned inventory');
    if (this.total >= 500_000_000) throw Error('Folder media download budget exceeded');
    const signal = AbortSignal.timeout(120000);
    const get = async (path: string, params: Record<string, string>, max: number) => {
      const url = new URL('https://www.googleapis.com/drive/v3/' + path);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      return bytes(
        await this.fetcher(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.token}` },
          redirect: 'error',
          cache: 'no-store',
          signal,
        }),
        max,
        track
          ? (size) => {
              this.total += size;
              if (this.total > 500_000_000) throw Error('Folder media download budget exceeded');
            }
          : undefined,
      );
    };
    const metadata = z
      .object({
        id: z.string(),
        mimeType: z.string(),
        modifiedTime: z.string(),
        parents: z.array(z.string()),
        trashed: z.boolean().optional(),
        size: z.string().optional(),
        capabilities: z.object({ canDownload: z.boolean().optional() }).optional(),
      })
      .parse(
        JSON.parse(
          (
            await get(
              `files/${asset.fileId}`,
              {
                fields: 'id,mimeType,modifiedTime,parents,trashed,size,capabilities(canDownload)',
                supportsAllDrives: 'true',
              },
              64000,
            )
          ).toString(),
        ),
      );
    if (
      metadata.id !== asset.fileId ||
      metadata.mimeType !== asset.mimeType ||
      Date.parse(metadata.modifiedTime) !== Date.parse(asset.modifiedAt) ||
      !metadata.parents.includes(asset.parentId) ||
      metadata.trashed ||
      metadata.capabilities?.canDownload === false
    )
      throw Error('Asset scope, revision or permissions changed');
    const max =
      asset.mimeType === 'video/mp4'
        ? 150_000_000
        : asset.mimeType.includes('photoshop')
          ? 100_000_000
          : 30_000_000;
    if (metadata.size && Number(metadata.size) > max) throw Error('Asset exceeds download bound');
    const workbook = asset.mimeType === 'application/vnd.google-apps.spreadsheet';
    const result = await get(
      workbook ? `files/${asset.fileId}/export` : `files/${asset.fileId}`,
      workbook
        ? { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
        : { alt: 'media', supportsAllDrives: 'true' },
      max,
      true,
    );
    if (this.total > 500_000_000) throw Error('Folder media download budget exceeded');
    return result;
  }
}
