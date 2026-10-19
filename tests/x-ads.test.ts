import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { oauthHeader, XAdsReadOnlyProvider, xAdsConfiguration } from '../lib/x-ads';
const credentials = {
  consumerKey: 'consumer',
  consumerSecret: 'private-consumer',
  token: 'token',
  tokenSecret: 'private-token',
};
beforeEach(() => {
  vi.stubEnv('X_ADS_ACCOUNT_ID', '18ce55xd2ys');
  vi.stubEnv('X_ADS_CONSUMER_KEY', credentials.consumerKey);
  vi.stubEnv('X_ADS_CONSUMER_SECRET', credentials.consumerSecret);
  vi.stubEnv('X_ADS_ACCESS_TOKEN', credentials.token);
  vi.stubEnv('X_ADS_ACCESS_TOKEN_SECRET', credentials.tokenSecret);
});
afterEach(() => vi.unstubAllEnvs());
const response = (data: unknown) => new Response(JSON.stringify(data));
const campaign = (id = 'abc') => ({
  id,
  name: 'TradeLink paid test',
  entity_status: 'ACTIVE',
  currency: 'USD',
});
const stat = (id = 'abc', extra: Record<string, unknown> = {}) => ({
  id,
  id_data: [
    {
      segment: null,
      metrics: {
        impressions: [1000],
        clicks: [20],
        url_clicks: [10],
        engagements: [25],
        billed_charge_local_micro: [12345000],
        ...extra,
      },
    },
  ],
});
function fixture(
  options: {
    fail?: boolean;
    badAccount?: boolean;
    nulls?: boolean;
    missing?: boolean;
    paginate?: boolean;
  } = {},
) {
  const mock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.origin).toBe('https://ads-api.twitter.com');
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('error');
    expect(init?.headers).toHaveProperty(
      'Authorization',
      expect.stringContaining('oauth_signature='),
    );
    expect(url.href).not.toContain('private');
    expect(url.href).not.toContain('oauth_token');
    if (options.fail) return new Response('private secret upstream', { status: 403 });
    if (url.pathname.includes('/stats/')) {
      expect(url.searchParams.get('start_time')).toBe('2026-10-12T00:00:00Z');
      expect(url.searchParams.get('end_time')).toBe('2026-10-19T00:00:00Z');
      expect(url.searchParams.get('granularity')).toBe('TOTAL');
      expect(url.searchParams.get('metric_groups')).toBe('ENGAGEMENT,BILLING');
      return response({
        data: options.missing
          ? []
          : [
              stat('abc', options.nulls ? { url_clicks: null } : {}),
              ...(options.paginate ? [stat('def')] : []),
            ],
      });
    }
    if (url.pathname.endsWith('/campaigns'))
      return response({
        data: [campaign(url.searchParams.has('cursor') ? 'def' : 'abc')],
        next_cursor: options.paginate && !url.searchParams.has('cursor') ? 'page2' : null,
      });
    return response({
      data: {
        id: options.badAccount ? 'wrong' : '18ce55xd2ys',
        name: 'TradeLink Ads',
        timezone: 'America/New_York',
      },
    });
  });
  return mock;
}
it('signs using RFC 5849 percent-encoding and query normalization', () => {
  const url = new URL('https://ads-api.twitter.com/12/accounts/a?b=two%20words&a=%21');
  const header = oauthHeader(url, credentials, 'nonce', '123');
  const params =
    'a=%21&b=two%20words&oauth_consumer_key=consumer&oauth_nonce=nonce&oauth_signature_method=HMAC-SHA1&oauth_timestamp=123&oauth_token=token&oauth_version=1.0';
  const enc = (s: string) =>
    encodeURIComponent(s).replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  const signature = createHmac('sha1', 'private-consumer&private-token')
    .update(`GET&${enc(url.origin + url.pathname)}&${enc(params)}`)
    .digest('base64');
  expect(header).toContain(`oauth_signature="${enc(signature)}"`);
  expect(header).not.toContain('private');
});
it('requires separate OAuth credentials, never organic bearer tokens', async () => {
  vi.stubEnv('X_ADS_ACCESS_TOKEN_SECRET', '');
  vi.stubEnv('X_BEARER_TOKEN', 'organic');
  expect(xAdsConfiguration().configured).toBe(false);
  const fetcher = fixture();
  await expect(new XAdsReadOnlyProvider(fetcher).fetchData()).rejects.toMatchObject({
    code: 'configuration',
  });
  expect(fetcher).not.toHaveBeenCalled();
});
it('reads paginated campaigns, normalizes micros, and keeps paid evidence scoped', async () => {
  const fetcher = fixture({ paginate: true });
  const snapshot = await new XAdsReadOnlyProvider(
    fetcher,
    () => new Date('2026-10-19T13:35:00Z'),
  ).fetchData();
  expect(snapshot.campaigns).toHaveLength(2);
  expect(snapshot.totals.spend).toBe(24.69);
  expect(snapshot.totals.impressions).toBe(2000);
  expect(snapshot.currency).toBe('USD');
  expect(JSON.stringify(snapshot)).not.toContain('private');
  expect(snapshot.notes.join(' ')).toContain('No conversion');
});
it('preserves unknown metrics instead of converting them to zero', async () => {
  const data = await new XAdsReadOnlyProvider(
    fixture({ nulls: true }),
    () => new Date('2026-10-19T13:35:00Z'),
  ).fetchData();
  expect(data.totals.urlClicks).toBeNull();
  expect(data.totals.spend).toBe(12.345);
});
it('rejects incorrect account scopes, incomplete stats, and rejected authorization', async () => {
  for (const option of [{ badAccount: true }, { missing: true }, { fail: true }])
    await expect(
      new XAdsReadOnlyProvider(fixture(option), () => new Date('2026-10-19T13:35:00Z')).fetchData(),
    ).rejects.toThrow();
});
it('does not loop over repeated campaign cursors or publish partial totals', async () => {
  const fetcher = vi.fn(async (input: string | URL | Request) =>
    new URL(String(input)).pathname.endsWith('/campaigns')
      ? response({ data: [], next_cursor: 'repeated' })
      : response({ data: { id: '18ce55xd2ys', name: 'TradeLink', timezone: 'UTC' } }),
  );
  await expect(new XAdsReadOnlyProvider(fetcher).fetchData()).rejects.toThrow('Repeated cursor');
  expect(fetcher).toHaveBeenCalledTimes(3);
});
