import { describe, it, expect } from 'vitest';
import { readJson, PayloadTooLarge } from '../lib/http';
describe('bounded JSON request bodies', () => {
  it('reads valid JSON', async () => {
    expect(
      await readJson(
        new Request('http://localhost', { method: 'POST', body: '{"count":50}' }),
        100,
      ),
    ).toEqual({ count: 50 });
  });
  it('rejects oversized declared bodies before parsing', async () => {
    await expect(
      readJson(
        new Request('http://localhost', {
          method: 'POST',
          headers: { 'content-length': '500' },
          body: '{}',
        }),
        100,
      ),
    ).rejects.toBeInstanceOf(PayloadTooLarge);
  });
  it('also rejects oversized chunked bodies with no length', async () => {
    await expect(
      readJson(
        new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify({ value: 'x'.repeat(500) }),
        }),
        100,
      ),
    ).rejects.toBeInstanceOf(PayloadTooLarge);
  });
});
