import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSyntheticExperiment, HUB_AGENT_ID, hubRequest } from '../lib/agent-hub';

describe('Agent Hub dry-run source contract', () => {
  it('uses only the allowed source/target and dry-run capability', () => {
    const r = buildSyntheticExperiment(new Date('2026-10-20T12:00:00Z'));
    expect(HUB_AGENT_ID).toBe('tradelink-cmo');
    expect(r.target_agent).toBe('emailcreator');
    expect(r.capability).toBe('prepare_experiment');
    expect(r.payload.mode).toBe('dry_run');
    expect(r.payload.discount_percent).toBe(40);
    expect(r.payload.price_usd).toBe(40);
    expect(r.payload.lead_source).toBe('payload');
    expect(r.payload.cadence_mode).toBe('business');
    expect(r.payload.leads).toHaveLength(24);
  });
  it('includes no real people or recipient credentials', () => {
    const r = buildSyntheticExperiment(new Date('2026-10-20T12:00:00Z'));
    const body = JSON.stringify(r);
    expect(body).not.toContain('token');
    expect(body).not.toContain('gmail.com');
    for (const lead of r.payload.leads) {
      expect(lead.identity.email).toMatch(/@sample-[0-9]+\.example$/);
    }
  });
  it('keeps retries stable for the same scenario', () => {
    const d = new Date('2026-10-20T12:00:00Z');
    const a = buildSyntheticExperiment(d);
    const b = buildSyntheticExperiment(d);
    expect(a).toEqual(b);
    expect(a.idempotency_key).toBe('tradelink-creator-ab-v1-synthetic-qa-business-24-2026-10-27');
    expect(a.payload.start_date).toBe('2026-10-27');
  });
});


describe('Agent Hub server-side HTTP boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  const trusted = 'https://web-production-44a4c.up.railway.app';
  const agentToken = 'synthetic-test-token-' + 'x'.repeat(48);

  function setup() {
    vi.stubEnv('CMO_HUB_ORIGIN', trusted);
    vi.stubEnv('CMO_HUB_AGENT_TOKEN', agentToken);
  }

  it('rejects missing or wrong origin before making any outbound request', async () => {
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    vi.stubEnv('CMO_HUB_ORIGIN', 'https://example.com');
    vi.stubEnv('CMO_HUB_AGENT_TOKEN', agentToken);
    await expect(hubRequest('GET', '/api/v1/agent/submissions')).rejects.toMatchObject({ status: 503 });
    expect(mock).not.toHaveBeenCalled();
  });

  it('sends only the scoped CMO identity in a server-side Authorization header', async () => {
    setup();
    const mock = vi.fn(async (_input: RequestInfo | URL, _options?: RequestInit) =>
      new Response(JSON.stringify({tasks: []}), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', mock);
    await expect(hubRequest('GET', '/api/v1/agent/submissions')).resolves.toEqual({ tasks: [] });
    const [url, opts] = mock.mock.calls[0];
    const request = opts as RequestInit;
    const headers = request.headers as Record<string, string>;
    expect(url).toBe(trusted + '/api/v1/agent/submissions');
    expect(headers['X-Agent-Id']).toBe('tradelink-cmo');
    expect(headers.Authorization).toBe('Bearer ' + agentToken);
    expect(request.redirect).toBe('manual');
    expect(request.cache).toBe('no-store');
  });

  it('never follows Hub redirects or treats invalid responses as success', async () => {
    setup();
    const mock = vi.fn(async () => new Response(null, {
      status: 302, headers: { location: 'https://attacker.test/capture' },
    }));
    vi.stubGlobal('fetch', mock);
    await expect(hubRequest('GET', '/api/v1/agent/submissions')).rejects.toMatchObject({ status: 502 });
    expect(mock).toHaveBeenCalledTimes(1);
    mock.mockImplementation(async () => new Response('not json', { status: 200 }));
    await expect(hubRequest('GET', '/api/v1/agent/submissions')).rejects.toMatchObject({ status: 502 });
  });

  it('rejects oversized Hub responses instead of returning unbounded data', async () => {
    setup();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(70000), { status: 200 })));
    await expect(hubRequest('GET', '/api/v1/agent/submissions')).rejects.toMatchObject({ status: 502 });
  });

  it('issues a fresh, explicit human-approved QA request for a new planned start date', () => {
    const a = buildSyntheticExperiment(new Date('2026-10-20T12:00:00Z'));
    const b = buildSyntheticExperiment(new Date('2026-10-21T12:00:00Z'));
    expect(a.payload.start_date).not.toBe(b.payload.start_date);
    expect(a.idempotency_key).not.toBe(b.idempotency_key);
    expect(a.payload.mode).toBe('dry_run');
    expect(b.payload.mode).toBe('dry_run');
  });
});
