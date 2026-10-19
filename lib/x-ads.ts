import { createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
const id = z.string().regex(/^[a-z0-9]{1,40}$/);
const metric = z.number().finite().nonnegative().nullable();
const metrics = z.object({
  spend: metric,
  impressions: metric,
  clicks: metric,
  urlClicks: metric,
  engagements: metric,
});
export const xAdsSnapshotSchema = z.object({
  accountId: id,
  accountName: z.string().max(500),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  timezone: z.string().max(100),
  capturedAt: z.string().datetime(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  placement: z.literal('ALL_ON_TWITTER'),
  totals: metrics,
  campaigns: z
    .array(metrics.extend({ id, name: z.string().max(500), status: z.string().max(50) }))
    .max(500),
  notes: z.array(z.string().max(500)).max(10),
});
export type XAdsSnapshot = z.infer<typeof xAdsSnapshotSchema>;
export class XAdsReadError extends Error {
  constructor(
    public code: 'configuration' | 'busy' | 'unavailable',
    message: string,
  ) {
    super(message);
  }
}
const credentialNames = [
  'X_ADS_CONSUMER_KEY',
  'X_ADS_CONSUMER_SECRET',
  'X_ADS_ACCESS_TOKEN',
  'X_ADS_ACCESS_TOKEN_SECRET',
] as const;
export function xAdsConfiguration() {
  const account = process.env.X_ADS_ACCOUNT_ID?.trim();
  return {
    accountId: id.safeParse(account).success ? account! : null,
    configured:
      id.safeParse(account).success && credentialNames.every((k) => !!process.env[k]?.trim()),
  };
}
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
// RFC 5849: sign every query parameter. Never send OAuth secrets in query strings.
export function oauthHeader(
  url: URL,
  credentials: { consumerKey: string; consumerSecret: string; token: string; tokenSecret: string },
  nonce = randomBytes(18).toString('hex'),
  timestamp = String(Math.floor(Date.now() / 1000)),
) {
  const oauth: Record<string, string> = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: credentials.token,
    oauth_version: '1.0',
  };
  const pairs = [...url.searchParams.entries(), ...Object.entries(oauth)]
    .map(([k, v]) => [encode(k), encode(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const base = [
    'GET',
    encode(url.origin + url.pathname),
    encode(pairs.map((p) => p.join('=')).join('&')),
  ].join('&');
  oauth.oauth_signature = createHmac(
    'sha1',
    `${encode(credentials.consumerSecret)}&${encode(credentials.tokenSecret)}`,
  )
    .update(base)
    .digest('base64');
  return (
    'OAuth ' +
    Object.entries(oauth)
      .sort()
      .map(([k, v]) => `${encode(k)}="${encode(v)}"`)
      .join(', ')
  );
}
const accountSchema = z.object({
  data: z.object({ id, name: z.string().max(500), timezone: z.string().max(100) }),
});
const campaignSchema = z.object({
  data: z
    .array(
      z.object({
        id,
        name: z.string().max(500),
        entity_status: z.string().max(50),
        currency: z.string().regex(/^[A-Z]{3}$/),
      }),
    )
    .max(200),
  next_cursor: z.string().nullable().optional(),
});
const statsSchema = z.object({
  data: z
    .array(
      z.object({
        id,
        id_data: z
          .array(
            z.object({
              segment: z.unknown().optional(),
              metrics: z.record(
                z.union([z.array(z.number().finite().nonnegative().nullable()), z.null()]),
              ),
            }),
          )
          .max(1),
      }),
    )
    .max(20),
});
export interface XAdsProvider {
  fetchData(): Promise<XAdsSnapshot>;
}
export class XAdsReadOnlyProvider implements XAdsProvider {
  constructor(
    private fetcher: typeof fetch = fetch,
    private now = () => new Date(),
  ) {}
  async fetchData(): Promise<XAdsSnapshot> {
    const config = xAdsConfiguration();
    if (!config.configured || !config.accountId)
      throw new XAdsReadError(
        'configuration',
        'X Ads requires approved Ads API access and four user-context OAuth credentials in Railway.',
      );
    const credentials = {
      consumerKey: process.env.X_ADS_CONSUMER_KEY!.trim(),
      consumerSecret: process.env.X_ADS_CONSUMER_SECRET!.trim(),
      token: process.env.X_ADS_ACCESS_TOKEN!.trim(),
      tokenSecret: process.env.X_ADS_ACCESS_TOKEN_SECRET!.trim(),
    };
    const signal = AbortSignal.timeout(120000);
    // Fixed origin, GET only, no redirects, no automatic retries or external writes.
    const read = async (path: string, params: Record<string, string> = {}) => {
      const url = new URL(`https://ads-api.twitter.com/12/${path}`);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      const response = await this.fetcher(url, {
        method: 'GET',
        headers: { Authorization: oauthHeader(url, credentials) },
        redirect: 'error',
        cache: 'no-store',
        signal,
      });
      if (!response.ok) throw Error('Ads API request rejected');
      if (Number(response.headers.get('content-length') || 0) > 2000000)
        throw Error('Ads response too large');
      const reader = response.body?.getReader();
      if (!reader) throw Error('Empty response');
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 2000000) {
          await reader.cancel();
          throw Error('Ads response too large');
        }
        chunks.push(part.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    };
    const account = accountSchema.parse(await read(`accounts/${config.accountId}`)).data;
    if (account.id !== config.accountId) throw Error('Account mismatch');
    const campaigns: z.infer<typeof campaignSchema>['data'] = [];
    let cursor: string | undefined;
    const cursors = new Set<string>();
    do {
      const page = campaignSchema.parse(
        await read(`accounts/${account.id}/campaigns`, {
          count: '200',
          with_deleted: 'true',
          ...(cursor ? { cursor } : {}),
        }),
      );
      campaigns.push(...page.data);
      if (campaigns.length > 500 || new Set(campaigns.map((c) => c.id)).size !== campaigns.length)
        throw Error('Campaign scope limit');
      cursor = page.next_cursor && page.next_cursor !== '0' ? page.next_cursor : undefined;
      if (cursor && cursors.has(cursor)) throw Error('Repeated cursor');
      if (cursor) cursors.add(cursor);
      if (cursors.size > 10) throw Error('Pagination limit');
    } while (cursor);
    // Rolling seven completed UTC days. TOTAL avoids account-timezone daily boundaries.
    const capturedAt = this.now();
    const end = new Date(capturedAt);
    end.setUTCHours(0, 0, 0, 0);
    const start = new Date(end.getTime() - 7 * 86400000);
    const currencies = new Set(campaigns.map((c) => c.currency));
    if (currencies.size > 1) throw Error('Mixed campaign currencies');
    const currency = campaigns[0]?.currency ?? null;
    const rows: XAdsSnapshot['campaigns'] = [];
    const value = (
      raw: Record<string, (number | null)[] | null> | undefined,
      key: string,
      scale = 1,
    ) => {
      const values = raw?.[key];
      // Missing/null is unknown, never zero. TOTAL must contain exactly one bucket.
      if (values == null) return null;
      if (values.length !== 1) throw Error('Unexpected stats granularity');
      return values[0] === null ? null : values[0] / scale;
    };
    for (let offset = 0; offset < campaigns.length; offset += 20) {
      const batch = campaigns.slice(offset, offset + 20);
      const stats = statsSchema.parse(
        await read(`stats/accounts/${account.id}`, {
          entity: 'CAMPAIGN',
          entity_ids: batch.map((c) => c.id).join(','),
          start_time: start.toISOString().replace('.000Z', 'Z'),
          end_time: end.toISOString().replace('.000Z', 'Z'),
          granularity: 'TOTAL',
          placement: 'ALL_ON_TWITTER',
          metric_groups: 'ENGAGEMENT,BILLING',
        }),
      );
      if (
        stats.data.length !== batch.length ||
        new Set(stats.data.map((s) => s.id)).size !== batch.length ||
        stats.data.some((s) => !batch.some((c) => c.id === s.id))
      )
        throw Error('Incomplete stats scope');
      for (const c of batch) {
        const entry = stats.data.find((s) => s.id === c.id)!;
        const segment = entry.id_data[0];
        if (segment?.segment != null) throw Error('Unexpected segmentation');
        const m = segment?.metrics;
        rows.push({
          id: c.id,
          name: c.name,
          status: c.entity_status,
          spend: value(m, 'billed_charge_local_micro', 1e6),
          impressions: value(m, 'impressions'),
          clicks: value(m, 'clicks'),
          urlClicks: value(m, 'url_clicks'),
          engagements: value(m, 'engagements'),
        });
      }
    }
    const sum = (key: keyof z.infer<typeof metrics>) =>
      rows.some((r) => r[key] === null) ? null : rows.reduce((n, r) => n + r[key]!, 0);
    return xAdsSnapshotSchema.parse({
      accountId: account.id,
      accountName: account.name,
      currency,
      timezone: account.timezone,
      capturedAt: capturedAt.toISOString(),
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      placement: 'ALL_ON_TWITTER',
      campaigns: rows,
      totals: {
        spend: sum('spend'),
        impressions: sum('impressions'),
        clicks: sum('clicks'),
        urlClicks: sum('urlClicks'),
        engagements: sum('engagements'),
      },
      notes: [
        'Seven completed UTC days; X placements only. Publisher Network excluded.',
        'Null means unavailable, not zero. Platform reporting may lag or be revised.',
        'Clicks include more than website visits. No conversion, subscriber attribution, CAC or ROAS is inferred.',
        'Campaigns may promote other products; confirm this advertiser account is exclusively TradeLink before treating spend as TradeLink spend.',
      ],
    });
  }
}
