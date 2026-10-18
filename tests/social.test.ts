import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SocialReadOnlyProvider, socialConfiguration } from '../lib/social';
const secret = 'test-token-never-save';
function configured() {
  vi.stubEnv('X_BEARER_TOKEN', secret);
  vi.stubEnv('X_USER_ID', '123');
  vi.stubEnv('X_USERNAME', 'tradelink_pb');
  vi.stubEnv('INSTAGRAM_ACCESS_TOKEN', secret);
  vi.stubEnv('INSTAGRAM_USER_ID', '456');
  vi.stubEnv('INSTAGRAM_USERNAME', 'tradelink_pb');
}
const account = {
  data: {
    id: '123',
    username: 'tradelink_pb',
    public_metrics: { followers_count: 90, tweet_count: 42 },
  },
};
const posts = {
  data: [
    {
      id: '111',
      author_id: '123',
      text: 'A useful trading post',
      created_at: '2026-10-18T12:00:00Z',
      public_metrics: { like_count: 8, reply_count: 2, retweet_count: 1 },
    },
  ],
  meta: { result_count: 1 },
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(configured);
afterEach(() => vi.unstubAllEnvs());
it('requires both credentials and a numeric account ID; configuration never exposes tokens', async () => {
  expect(JSON.stringify(socialConfiguration('x'))).not.toContain(secret);
  vi.stubEnv('X_USER_ID', '../another-account');
  expect(socialConfiguration('x').configured).toBe(false);
  const fetcher = vi.fn();
  await expect(new SocialReadOnlyProvider('x', fetcher).fetchData()).rejects.toMatchObject({
    code: 'configuration',
  });
  expect(fetcher).not.toHaveBeenCalled();
});
it('reads only two fixed X endpoints and stores missing views as unavailable', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(account))
    .mockResolvedValueOnce(response(posts));
  const [snapshot] = await new SocialReadOnlyProvider('x', fetcher).fetchData();
  expect(snapshot).toMatchObject({
    followers: 90,
    totalPosts: 42,
    posts: [{ likes: 8, shares: 1, views: null }],
  });
  for (const [url, options] of fetcher.mock.calls) {
    expect(url.origin).toBe('https://api.x.com');
    expect(url.href).not.toContain(secret);
    expect(options).toMatchObject({
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      headers: { Authorization: `Bearer ${secret}` },
    });
  }
  expect(fetcher.mock.calls[1][0].searchParams.get('max_results')).toBe('50');
  expect(JSON.stringify(snapshot)).not.toContain(secret);
});
it('rejects unexpected accounts, usernames, post authors and duplicate posts', async () => {
  for (const [a, p] of [
    [{ data: { ...account.data, id: '999' } }, posts],
    [{ data: { ...account.data, username: 'someone_else' } }, posts],
    [account, { data: [{ ...posts.data[0], author_id: '999' }], meta: { result_count: 1 } }],
    [account, { data: [posts.data[0], posts.data[0]], meta: { result_count: 2 } }],
  ]) {
    const fetcher = vi.fn().mockResolvedValueOnce(response(a)).mockResolvedValueOnce(response(p));
    await expect(new SocialReadOnlyProvider('x', fetcher).fetchData()).rejects.toMatchObject({
      code: 'invalid',
    });
  }
});
it('accepts empty X timelines but rejects inconsistent result counts', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(account))
    .mockResolvedValueOnce(response({ meta: { result_count: 0 } }));
  expect((await new SocialReadOnlyProvider('x', fetcher).fetchData())[0].posts).toEqual([]);
  const bad = vi
    .fn()
    .mockResolvedValueOnce(response(account))
    .mockResolvedValueOnce(response({ meta: { result_count: 1 } }));
  await expect(new SocialReadOnlyProvider('x', bad).fetchData()).rejects.toMatchObject({
    code: 'invalid',
  });
});
it('imports professional Instagram reporting without fabricating hidden likes, shares or views', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      response({ id: '456', username: 'tradelink_pb', followers_count: 120, media_count: 3 }),
    )
    .mockResolvedValueOnce(
      response({ data: [{ id: '789', timestamp: '2026-10-18T10:00:00+0000', comments_count: 4 }] }),
    );
  const [snapshot] = await new SocialReadOnlyProvider('instagram', fetcher).fetchData();
  expect(snapshot.posts[0]).toMatchObject({
    text: '',
    likes: null,
    comments: 4,
    shares: null,
    views: null,
  });
  expect(fetcher.mock.calls[0][0].origin).toBe('https://graph.instagram.com');
  expect(fetcher.mock.calls[1][0].pathname).toBe('/v24.0/456/media');
});
it('redacts upstream errors and never retries permission or rate-limit failures', async () => {
  for (const [status, code] of [
    [401, 'permission'],
    [403, 'permission'],
    [429, 'rate_limit'],
    [500, 'unavailable'],
  ] as const) {
    const fetcher = vi.fn().mockResolvedValue(response({ error: { message: secret } }, status));
    const error = await new SocialReadOnlyProvider('x', fetcher).fetchData().catch((e) => e);
    expect(error.code).toBe(code);
    expect(error.message).not.toContain(secret);
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
it('rejects partial errors, invalid counters and oversized responses without exposing bodies', async () => {
  for (const result of [
    response({ ...account, errors: [{ message: secret }] }),
    response({ data: { ...account.data, public_metrics: { followers_count: -1 } } }),
    new Response('x'.repeat(2_000_001)),
  ]) {
    const error = await new SocialReadOnlyProvider('x', vi.fn().mockResolvedValue(result))
      .fetchData()
      .catch((e) => e);
    expect(error.code).toBe('invalid');
    expect(error.message).not.toContain(secret);
  }
});
