import { z } from 'zod';
import type { IntegrationProvider } from './intelligence';

export const socialProviderSchema = z.enum(['x', 'instagram']);
export type SocialProvider = z.infer<typeof socialProviderSchema>;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id = z.string().regex(/^\d{1,40}$/);
const username = z.string().regex(/^[A-Za-z0-9_.]{1,50}$/);
export const socialSnapshotSchema = z.object({
  provider: socialProviderSchema,
  accountId: id,
  username,
  capturedAt: z.string().datetime(),
  followers: count.nullable(),
  totalPosts: count.nullable(),
  posts: z
    .array(
      z.object({
        id,
        text: z.string().max(2000),
        publishedAt: z.string().datetime(),
        likes: count.nullable(),
        comments: count.nullable(),
        shares: count.nullable(),
        views: count.nullable(),
      }),
    )
    .max(50),
  notes: z.array(z.string().max(500)).max(10),
});
export type SocialSnapshot = z.infer<typeof socialSnapshotSchema>;
export class SocialReadError extends Error {
  constructor(
    public code: 'configuration' | 'permission' | 'rate_limit' | 'unavailable' | 'invalid' | 'busy',
    message: string,
  ) {
    super(message);
    this.name = 'SocialReadError';
  }
}
export function socialConfiguration(provider: SocialProvider) {
  const account = process.env[provider === 'x' ? 'X_USER_ID' : 'INSTAGRAM_USER_ID']?.trim();
  const token = process.env[provider === 'x' ? 'X_BEARER_TOKEN' : 'INSTAGRAM_ACCESS_TOKEN']?.trim();
  return {
    provider,
    label: provider === 'x' ? 'X' : 'Instagram',
    configured: !!token && id.safeParse(account).success,
    accountId: id.safeParse(account).success ? account! : null,
    expectedUsername:
      process.env[provider === 'x' ? 'X_USERNAME' : 'INSTAGRAM_USERNAME']
        ?.trim()
        .replace(/^@/, '') || null,
  };
}

// Credentials never appear in URLs, client responses, saved snapshots or error messages.
async function read(url: URL, token: string, fetcher: typeof fetch, signal: AbortSignal) {
  const response = await fetcher(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new SocialReadError(
        'permission',
        'Social API access was rejected. Check the token, account permissions and API plan.',
      );
    if (response.status === 429)
      throw new SocialReadError('rate_limit', 'Social API rate limit reached. Retry later.');
    throw new SocialReadError(
      'unavailable',
      'Social API is unavailable. Previous successful data was retained.',
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty response');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2_000_000) throw new Error('Response limit');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const object = z
    .object({ error: z.unknown().optional(), errors: z.unknown().optional() })
    .passthrough()
    .parse(data);
  if (object.error || object.errors)
    throw new SocialReadError(
      'invalid',
      'Social API returned incomplete or invalid data. No snapshot was saved.',
    );
  return object;
}
const metric = count.nullish().transform((v) => v ?? null);
const xMetrics = z.object({
  like_count: metric,
  reply_count: metric,
  retweet_count: metric,
  impression_count: metric,
});
const date = z
  .string()
  .refine((v) => Number.isFinite(Date.parse(v)))
  .transform((v) => new Date(v).toISOString());
const text = z
  .string()
  .optional()
  .transform((v) => (v || '').slice(0, 2000));
export class SocialReadOnlyProvider implements IntegrationProvider<SocialSnapshot> {
  name: string;
  mode = 'live' as const;
  constructor(
    readonly provider: SocialProvider,
    private fetcher: typeof fetch = fetch,
  ) {
    this.name = provider === 'x' ? 'X public reporting' : 'Instagram professional reporting';
  }
  async fetchData(): Promise<SocialSnapshot[]> {
    const config = socialConfiguration(this.provider);
    if (!config.configured || !config.accountId)
      throw new SocialReadError(
        'configuration',
        'This social account is not configured. Add its server-side access token and numeric account ID in Railway.',
      );
    const token =
      process.env[this.provider === 'x' ? 'X_BEARER_TOKEN' : 'INSTAGRAM_ACCESS_TOKEN']!.trim();
    const signal = AbortSignal.timeout(30000);
    const base =
      this.provider === 'x' ? 'https://api.x.com/2/' : 'https://graph.instagram.com/v24.0/';
    const get = (path: string, params: Record<string, string>) => {
      const url = new URL(path, base);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      return read(url, token, this.fetcher, signal);
    };
    try {
      let snapshot: SocialSnapshot;
      if (this.provider === 'x') {
        const account = z
          .object({
            data: z.object({
              id,
              username,
              public_metrics: z.object({ followers_count: metric, tweet_count: metric }),
            }),
          })
          .parse(await get(`users/${config.accountId}`, { 'user.fields': 'public_metrics' })).data;
        const response = z
          .object({
            data: z
              .array(
                z.object({ id, author_id: id, text, created_at: date, public_metrics: xMetrics }),
              )
              .max(50)
              .optional(),
            meta: z.object({ result_count: count }).passthrough(),
          })
          .parse(
            await get(`users/${config.accountId}/tweets`, {
              max_results: '50',
              exclude: 'retweets',
              'tweet.fields': 'created_at,public_metrics,author_id',
            }),
          );
        const posts = response.data ?? [];
        if (
          account.id !== config.accountId ||
          posts.length !== response.meta.result_count ||
          posts.some((p) => p.author_id !== account.id)
        )
          throw new Error('Account mismatch');
        snapshot = {
          provider: 'x',
          accountId: account.id,
          username: account.username,
          capturedAt: new Date().toISOString(),
          followers: account.public_metrics.followers_count,
          totalPosts: account.public_metrics.tweet_count,
          posts: posts.map((p) => ({
            id: p.id,
            text: p.text,
            publishedAt: p.created_at,
            likes: p.public_metrics.like_count,
            comments: p.public_metrics.reply_count,
            shares: p.public_metrics.retweet_count,
            views: p.public_metrics.impression_count,
          })),
          notes: [
            'Latest up to 50 API-returned posts, excluding reposts; replies included. This is a sample, not a calendar-period total.',
            'Public views may be unavailable. Engagement is not website traffic, leads or paid-subscriber attribution.',
          ],
        };
      } else {
        const account = z
          .object({ id, username, followers_count: metric, media_count: metric })
          .parse(
            await get(config.accountId, { fields: 'id,username,followers_count,media_count' }),
          );
        const response = z
          .object({
            data: z
              .array(
                z.object({
                  id,
                  caption: text,
                  timestamp: date,
                  like_count: metric,
                  comments_count: metric,
                }),
              )
              .max(50),
          })
          .parse(
            await get(`${config.accountId}/media`, {
              fields: 'id,caption,timestamp,like_count,comments_count',
              limit: '50',
            }),
          );
        if (account.id !== config.accountId) throw new Error('Account mismatch');
        snapshot = {
          provider: 'instagram',
          accountId: account.id,
          username: account.username,
          capturedAt: new Date().toISOString(),
          followers: account.followers_count,
          totalPosts: account.media_count,
          posts: response.data.map((p) => ({
            id: p.id,
            text: p.caption,
            publishedAt: p.timestamp,
            likes: p.like_count,
            comments: p.comments_count,
            shares: null,
            views: null,
          })),
          notes: [
            'Instagram Login API for professional accounts. Latest up to 50 API-returned media items; Stories, reach, shares, saves and views are not imported by this adapter.',
            'Missing or hidden metrics are unavailable, not zero. Engagement does not establish paid-subscriber attribution.',
          ],
        };
      }
      if (
        config.expectedUsername &&
        snapshot.username.toLowerCase() !== config.expectedUsername.toLowerCase()
      )
        throw new Error('Username mismatch');
      if (new Set(snapshot.posts.map((p) => p.id)).size !== snapshot.posts.length)
        throw new Error('Duplicate posts');
      return [socialSnapshotSchema.parse(snapshot)];
    } catch (error) {
      if (error instanceof SocialReadError) throw error;
      throw new SocialReadError(
        'invalid',
        'Social data could not be read or validated. Check account permissions; previous successful data was retained.',
      );
    }
  }
}
