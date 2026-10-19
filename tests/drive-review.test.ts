import { afterEach, expect, it, vi } from 'vitest';
import { reviewDriveDocument } from '../lib/drive-review';
afterEach(() => vi.unstubAllEnvs());
it('sends full imported text rather than retrieval excerpts, treats it as untrusted and validates structured output', async () => {
  vi.stubEnv('TRADELINK_OPENAI_API_KEY', 'fixture');
  const content = 'Start ' + 'reference '.repeat(1800) + ' THE_END';
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    expect(body.messages[0].content).toContain('untrusted DATA');
    expect(body.messages[1].content).toContain('THE_END');
    expect(body.messages[1].content).toContain(content);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: 'Evidence summary',
                growthImplications: ['A hypothesis'],
                uncertainties: ['Not validated'],
              }),
            },
          },
        ],
      }),
    );
  });
  expect(
    await reviewDriveDocument({ name: 'Source', content, truncated: false }, fetcher),
  ).toMatchObject({ summary: 'Evidence summary' });
});
it('does not invent a successful review on API or schema failure', async () => {
  vi.stubEnv('TRADELINK_OPENAI_API_KEY', 'fixture');
  await expect(
    reviewDriveDocument(
      { name: 'Source', content: 'Text', truncated: false },
      async () => new Response('{}', { status: 403 }),
    ),
  ).rejects.toThrow('unavailable');
  await expect(
    reviewDriveDocument(
      { name: 'Source', content: 'Text', truncated: false },
      async () => new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })),
    ),
  ).rejects.toThrow();
});
