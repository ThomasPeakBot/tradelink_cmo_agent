/**
 * Server-side agent Hub client, dry-run synthetic QA only.
 * No prospect PII, no production integrations, no email sending.
 */
export const HUB_AGENT_ID = 'tradelink-cmo';
const EXPECTED_HUB_ORIGIN = 'https://web-production-44a4c.up.railway.app';
const MAX_RESPONSE_BYTES = 64 * 1024;

export class HubError extends Error {
  constructor(message: string, readonly status: number = 502) {
    super(message);
  }
}

export function buildSyntheticExperiment(now: Date = new Date()) {
  const start = new Date(now.getTime());
  start.setUTCDate(start.getUTCDate() + 7);
  while (start.getUTCDay() === 0 || start.getUTCDay() === 6) {
    start.setUTCDate(start.getUTCDate() + 1);
  }
  const startDate = start.toISOString().slice(0, 10);
  const fleet = [
    'gavynharris@getpeakbot.com',
    'gavynharris@partnerwithpeakbot.com',
    'gavynharris@peakbotpartners.com',
  ];
  const leads = Array.from({ length: 24 }, (_, i) => ({
    identity: {
      email: 'synthetic-creator-' + i + '@sample-' + i + '.example',
      domain: 'sample-' + i + '.example',
      handles: ['@synthetic' + i],
    },
    company: 'Synthetic Futures Creator ' + i,
    row_idx: i + 2,
    tps_sent: 0,
    replied: false,
    opted_out: false,
    left_cold_reason: '',
    draft_pending: '',
    sending_inbox: fleet[i % fleet.length],
    source: i % 2 === 0 ? 'youtube' : 'discord',
  }));
  return {
    target_agent: 'emailcreator',
    capability: 'prepare_experiment',
    subject: 'TradeLink creator positioning: affiliate-first vs user-first (synthetic QA)',
    idempotency_key: 'tradelink-creator-ab-v1-synthetic-qa-business-24-' + startDate,
    payload: {
      mode: 'dry_run',
      experiment_id: 'tradelink-creator-positioning',
      experiment_version: 'v1',
      discount_percent: 40,
      price_usd: 40,
      cadence_mode: 'business',
      start_date: startDate,
      lead_source: 'payload',
      max_cohort_size: 24,
      leads,
      migration: { identity_refs: [] },
    },
  };
}

function credentials() {
  const token = process.env.CMO_HUB_AGENT_TOKEN;
  const origin = process.env.CMO_HUB_ORIGIN;
  if (!token || token.length < 24 || origin !== EXPECTED_HUB_ORIGIN) {
    throw new HubError('Agent Hub is not configured. No request was submitted.', 503);
  }
  return { token, origin };
}

export async function hubRequest(
  method: 'GET' | 'POST',
  route: '/api/v1/agent/proposals' | '/api/v1/agent/submissions',
  payload?: unknown,
): Promise<Record<string, unknown>> {
  const { origin, token } = credentials();
  let response: Response;
  try {
    response = await fetch(origin + route, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        'X-Agent-Id': HUB_AGENT_ID,
        'Content-Type': 'application/json',
      },
      body: method === 'POST' ? JSON.stringify(payload) : undefined,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new HubError('Agent Hub could not be reached. No success is assumed.', 503);
  }
  if (response.status >= 300 && response.status < 400) {
    throw new HubError('Agent Hub returned a redirect; request was not followed.', 502);
  }
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_RESPONSE_BYTES) throw new HubError('Agent Hub response too large.', 502);
  const reader = response.body?.getReader();
  if (!reader) throw new HubError('Agent Hub returned no response body.', 502);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new HubError('Agent Hub response too large.', 502);
    }
    chunks.push(value);
  }
  let data: unknown;
  try {
    const full = new Uint8Array(bytes);
    let off = 0;
    for (const chunk of chunks) {
      full.set(chunk, off);
      off += chunk.length;
    }
    data = JSON.parse(new TextDecoder().decode(full));
  } catch {
    throw new HubError('Agent Hub returned invalid JSON.', 502);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HubError('Agent Hub returned an invalid result.', 502);
  }
  if (!response.ok) {
    throw new HubError('Agent Hub refused the request (HTTP ' + response.status + ').', response.status);
  }
  return data as Record<string, unknown>;
}
