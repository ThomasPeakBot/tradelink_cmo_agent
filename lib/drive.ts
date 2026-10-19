import { sign } from 'node:crypto';
import { z } from 'zod';

export const tradeLinkFolderId = '1DnzWOYD2g-OXv2IsVFLJRWtqF2-qQsJ3';
const fileId = z.string().regex(/^[A-Za-z0-9_-]{5,150}$/);
const serviceAccount = z.object({
  client_email: z.string().email(),
  private_key: z.string().min(100),
});
const folderMime = 'application/vnd.google-apps.folder';
const supported = new Set(['application/vnd.google-apps.document', 'text/plain', 'text/markdown']);
export class DriveReadError extends Error {
  constructor(
    public code: 'configuration' | 'access' | 'limit' | 'unavailable' | 'busy',
    message: string,
  ) {
    super(message);
    this.name = 'DriveReadError';
  }
}
export function driveConfiguration() {
  let configured = false;
  try {
    configured = serviceAccount.safeParse(
      JSON.parse(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON || ''),
    ).success;
  } catch {}
  return {
    folderId: tradeLinkFolderId,
    folderUrl: `https://drive.google.com/drive/folders/${tradeLinkFolderId}`,
    configured,
  };
}
export type DriveImport = {
  folderId: string;
  folderName: string;
  capturedAt: string;
  skipped: number;
  skippedByMime?: Record<string, number>;
  inventory?: {
    fileId: string;
    name: string;
    path: string;
    mimeType: string;
    modifiedAt: string;
    parentId: string;
    size: string | null;
  }[];
  folders?: { fileId: string; path: string }[];
  documents: {
    fileId: string;
    name: string;
    path: string;
    modifiedAt: string;
    content: string;
    truncated: boolean;
  }[];
};
const metadata = z.object({
  id: fileId,
  name: z.string().min(1).max(1000),
  mimeType: z.string(),
  trashed: z.boolean().optional(),
  modifiedTime: z.string().datetime().optional(),
  size: z.string().regex(/^\d+$/).optional(),
  parents: z.array(fileId).optional(),
  capabilities: z.object({ canDownload: z.boolean().optional() }).optional(),
});
async function boundedText(response: Response, max: number) {
  if (!response.ok)
    throw new DriveReadError(
      'access',
      'Google Drive rejected a read. Check folder sharing, API access and service-account credentials.',
    );
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing body');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > max)
        throw new DriveReadError(
          'limit',
          'A Drive response exceeded the import size limit. No partial import was saved.',
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString('utf8');
}
export async function driveAccessToken(
  fetcher: typeof fetch = fetch,
  signal: AbortSignal = AbortSignal.timeout(30000),
) {
  const account = serviceAccount.parse(JSON.parse(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON!));
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input =
    encode({ alg: 'RS256', typ: 'JWT' }) +
    '.' +
    encode({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    });
  const assertion =
    input + '.' + sign('RSA-SHA256', Buffer.from(input), account.private_key).toString('base64url');
  const tokenResponse = await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST',
    redirect: 'error',
    cache: 'no-store',
    signal,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const token = z
    .object({ access_token: z.string().min(1), token_type: z.literal('Bearer') })
    .parse(JSON.parse(await boundedText(tokenResponse, 64000)));
  return token.access_token;
}
export class DriveReadOnlyProvider {
  constructor(private fetcher: typeof fetch = fetch) {}
  async fetchData(): Promise<DriveImport> {
    if (!driveConfiguration().configured)
      throw new DriveReadError(
        'configuration',
        'Add the dedicated Google Drive service-account JSON in Railway and share the TradeLink folder with its email as Viewer.',
      );
    const signal = AbortSignal.timeout(90000);
    try {
      const accessToken = await driveAccessToken(this.fetcher, signal);
      let requests = 0;
      const get = async (path: string, params: Record<string, string> = {}, max = 1_000_000) => {
        if (++requests > 160)
          throw new DriveReadError(
            'limit',
            'Drive import exceeded its request budget. No partial import was saved.',
          );
        const url = new URL('https://www.googleapis.com/drive/v3/' + path);
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
        return boundedText(
          await this.fetcher(url, {
            method: 'GET',
            redirect: 'error',
            cache: 'no-store',
            signal,
            headers: { Authorization: `Bearer ${accessToken}` },
          }),
          max,
        );
      };
      const root = metadata.parse(
        JSON.parse(
          await get(`files/${tradeLinkFolderId}`, {
            fields: 'id,name,mimeType,trashed',
            supportsAllDrives: 'true',
          }),
        ),
      );
      if (root.id !== tradeLinkFolderId || root.mimeType !== folderMime || root.trashed)
        throw Error('Folder mismatch');
      const result: DriveImport = {
        folderId: root.id,
        folderName: root.name,
        capturedAt: new Date().toISOString(),
        skipped: 0,
        documents: [],
        inventory: [],
        folders: [{ fileId: root.id, path: root.name }],
      };
      const queue = [{ id: root.id, path: root.name, depth: 0 }];
      const seen = new Set<string>([root.id]);
      let entries = 0;
      let totalChars = 0;
      while (queue.length) {
        const folder = queue.shift()!;
        let pageToken: string | undefined;
        const pages = new Set<string>();
        do {
          const params: Record<string, string> = {
            q: `'${folder.id}' in parents and trashed = false`,
            pageSize: '100',
            fields:
              'nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,size,parents,trashed,capabilities(canDownload))',
            supportsAllDrives: 'true',
            includeItemsFromAllDrives: 'true',
          };
          if (pageToken) params.pageToken = pageToken;
          const page = z
            .object({
              files: z.array(metadata),
              nextPageToken: z.string().min(1).optional(),
              incompleteSearch: z.boolean().optional(),
            })
            .parse(JSON.parse(await get('files', params)));
          if (page.incompleteSearch) throw Error('Incomplete listing');
          for (const file of page.files) {
            if (++entries > 100)
              throw new DriveReadError(
                'limit',
                'The folder exceeds 100 entries. Use a smaller curated folder; no partial import was saved.',
              );
            if (!file.parents?.includes(folder.id) || file.trashed || seen.has(file.id))
              throw Error('Folder membership mismatch');
            seen.add(file.id);
            if (file.mimeType === folderMime) {
              if (folder.depth >= 5)
                throw new DriveReadError(
                  'limit',
                  'Drive import supports at most five nested folder levels. No partial import was saved.',
                );
              result.folders!.push({ fileId: file.id, path: folder.path + '/' + file.name });
              queue.push({
                id: file.id,
                path: folder.path + '/' + file.name,
                depth: folder.depth + 1,
              });
              continue;
            }
            if (!file.modifiedTime) throw Error('Missing modification date');
            result.inventory!.push({
              fileId: file.id,
              name: file.name,
              path: folder.path + '/' + file.name,
              mimeType: file.mimeType,
              modifiedAt: file.modifiedTime,
              parentId: folder.id,
              size: file.size ?? null,
            });
            if (!supported.has(file.mimeType)) {
              result.skipped++;
              result.skippedByMime ??= {};
              result.skippedByMime[file.mimeType] = (result.skippedByMime[file.mimeType] ?? 0) + 1;
              continue;
            }
            if (file.capabilities?.canDownload === false)
              throw new DriveReadError(
                'access',
                'A document does not permit export/download. The import was not saved.',
              );
            if (!file.modifiedTime) throw Error('Missing modification date');
            if (result.documents.length >= 50)
              throw new DriveReadError(
                'limit',
                'Drive import supports at most 50 text documents. Use a smaller curated folder.',
              );
            const raw =
              file.mimeType === 'application/vnd.google-apps.document'
                ? await get(`files/${file.id}/export`, { mimeType: 'text/plain' }, 100_000)
                : await get(
                    `files/${file.id}`,
                    { alt: 'media', supportsAllDrives: 'true' },
                    100_000,
                  );
            const content = raw;
            totalChars += content.length;
            if (totalChars > 500000)
              throw new DriveReadError(
                'limit',
                'The folder exceeds the 500,000-character import budget. No partial import was saved.',
              );
            result.documents.push({
              fileId: file.id,
              name: file.name,
              path: folder.path + '/' + file.name,
              modifiedAt: file.modifiedTime,
              content,
              truncated: raw.length > content.length,
            });
          }
          pageToken = page.nextPageToken;
          if (pageToken) {
            if (pages.has(pageToken)) throw Error('Repeated page');
            pages.add(pageToken);
            if (pages.size > 10) throw Error('Pagination limit');
          }
        } while (pageToken);
      }
      return result;
    } catch (error) {
      if (error instanceof DriveReadError) throw error;
      throw new DriveReadError(
        'unavailable',
        'Drive import failed validation or timed out. Cached documents were retained; direct Drive reference retrieval is paused until a successful sync.',
      );
    }
  }
}
