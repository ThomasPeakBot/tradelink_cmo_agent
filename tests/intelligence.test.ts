import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  LocalIntelligenceProvider,
  OpenAIIntelligenceProvider,
  intelligenceProvider,
} from '../lib/intelligence';
import type { Workspace } from '../lib/workspace';
import { growthSummary } from '../lib/growth';
const company = {
  id: 'tradelink',
  name: 'TradeLink',
  description: 'Approved facts',
  goalStart: 50,
  goalTarget: 5000,
  goalStartDate: '2026-01-01',
  goalEndDate: '2027-01-01',
  currency: 'USD',
  updatedAt: new Date(),
};
const context: Workspace = {
  stripe: { configured: false, products: [], scopeId: null, lastSync: null, summary: null },
  company,
  social: [],
  xAds: { accountId: null, connected: false, note: 'Not connected' },
  syncHistory: [],
  today: { date: '2026-10-18', current: null, history: [] },
  drive: {
    folderId: 'test',
    folderUrl: 'https://drive.google.com',
    configured: false,
    available: false,
    folderName: null,
    lastSync: null,
    failed: false,
    skipped: 0,
    documents: [],
  },
  metrics: [],
  channels: [],
  experiments: [],
  priorities: [],
  knowledge: [],
  memories: [],
  approvals: [],
  audits: [],
  alerts: [],
  reports: [],
  messages: [],
  summary: growthSummary(company, []),
};
vi.stubEnv('TRADELINK_OPENAI_API_KEY', '');
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('intelligence provider contracts', () => {
  it('runs without credentials and does not invent an actual subscriber count', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const provider = intelligenceProvider();
    expect(provider).toBeInstanceOf(LocalIntelligenceProvider);
    const answer = await provider.generate({ type: 'CHAT', prompt: 'Where are we?', context });
    expect(answer.content).toContain('Pace cannot be assessed');
    expect(answer.content).toContain('No company knowledge supplied');
  });
  it('lets a human explicitly use local mode even when a key is configured', () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    expect(intelligenceProvider('local')).toBeInstanceOf(LocalIntelligenceProvider);
    expect(intelligenceProvider()).toBeInstanceOf(OpenAIIntelligenceProvider);
  });
  it('sends evidence to OpenAI without tools and persists no credentials in the prompt', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const mock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'Grounded CMO recommendation' } }] }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', mock);
    const answer = await new OpenAIIntelligenceProvider().generate({
      type: 'DAILY',
      prompt: 'Brief me',
      context,
    });
    expect(answer.content).toContain('Grounded');
    const [, options] = mock.mock.calls[0];
    const payload = JSON.parse(options.body);
    expect(payload.tools).toBeUndefined();
    expect(options.body).not.toContain('test-key');
    expect(payload.messages[1].content).toContain('storedEvidence');
    expect(payload.messages[1].content).toContain('TradeLink');
  });
  it('reports provider errors without fabricating a successful answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 })),
    );
    await expect(
      new OpenAIIntelligenceProvider().generate({ type: 'CHAT', prompt: 'Hello', context }),
    ).rejects.toThrow('unavailable');
  });
  it('rejects an empty provider completion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [] }))),
    );
    await expect(
      new OpenAIIntelligenceProvider().generate({ type: 'CHAT', prompt: 'Hello', context }),
    ).rejects.toThrow('empty response');
  });
});
