import copyContract from '../lib/agent-hub-qa-copy.json';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autonomousQaTick, closeQaPool, qaPool, qaStatus, setQaPaused } from '../lib/agent-hub-autonomous';

const taskId = '20000000-0000-4000-8000-000000000001';
let payloadHash = '';
let state = 'approved';
let posts = 0;
let ackFailures = 0;
let badVersion = false;
function evidence() {
  return { kind: 'tradelink_experiment_dry_run', mode: 'dry_run', side_effects: 'none', valid: true,
    validation: 'passed', requested_experiment_version: 'v1', experiment: { id: 'tradelink-creator-positioning', version: { label: badVersion ? 'v2' : 'v1', sha256: copyContract.definition_sha256 }, sources_sha256: copyContract.sources_sha256 },
    adapter: { agent: 'emailcreator', capability: 'prepare_experiment', hub_task_id: taskId, store_durable: true },
    approval: { launch_ready: false, approved_for_sending: false }, audience: { leads_read: 24, selected: 24 },
    assignment: { A: 12, B: 12 }, variants: structuredClone(copyContract.variants), plan_sha256: 'a'.repeat(64),
    preparation: { qa_only: true, full_plan_persisted: true, artifact_sha256: 'b'.repeat(64) } };
}
async function due(run: string) { await qaPool().query('UPDATE cmo_hub_qa_runs SET next_run_at=NULL WHERE run_id=$1', [run]); }
function mockHub() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    if (url.endsWith('/proposals')) {
      posts++;
      const { qaPayloadHash } = await import('../lib/agent-hub-autonomous');
      payloadHash = qaPayloadHash(JSON.parse(String(options.body)));
      return Response.json({ id: taskId, state, payload_hash: payloadHash, workflow_id: 'workflow-qa' });
    }
    if (url.endsWith('/delivered')) {
      if (ackFailures-- > 0) return Response.json({ error: 'unavailable' }, { status: 500 });
      return Response.json({ id: taskId, state, result_delivered_at: new Date().toISOString() });
    }
    return Response.json({ tasks: [{ id: taskId, payload_hash: payloadHash, target_agent: 'emailcreator', capability: 'prepare_experiment', state, outcome: evidence() }] });
  }));
}
describe('CMO durable autonomous QA on disposable PostgreSQL', () => {
  beforeEach(async () => {
    if (!process.env.DATABASE_URL?.split('?')[0].endsWith('_test')) throw new Error('Disposable _test database required');
    await qaPool().query('TRUNCATE cmo_hub_qa_events,cmo_hub_qa_runs RESTART IDENTITY CASCADE');
    await qaPool().query('UPDATE cmo_hub_qa_controls SET paused=FALSE WHERE id=TRUE');
    vi.stubEnv('CMO_ENVIRONMENT', 'isolated_qa'); vi.stubEnv('CMO_HUB_QA_ENABLED', 'true');
    vi.stubEnv('CMO_HUB_ORIGIN', 'http://127.0.0.1:3200'); vi.stubEnv('CMO_HUB_AGENT_TOKEN', 'test-only-' + 'x'.repeat(48));
    state = 'approved'; posts = 0; ackFailures = 0; badVersion = false; mockHub();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  afterAll(closeQaPool);
  it('submits once across concurrent triggers and process-pool restart, then delivers the exact result', async () => {
    await Promise.all([autonomousQaTick('concurrency'), autonomousQaTick('concurrency')]);
    expect(posts).toBe(1);
    await closeQaPool(); await due('concurrency'); state = 'completed';
    expect((await autonomousQaTick('concurrency')).status).toBe('completed');
    await closeQaPool();
    expect((await autonomousQaTick('concurrency')).status).toBe('completed');
    expect(posts).toBe(1);
    const status = await qaStatus(); expect(status.runs[0].result_delivered_at).toBeTruthy();
    const events = await qaPool().query("SELECT event FROM cmo_hub_qa_events WHERE run_id='concurrency' ORDER BY id");
    expect(events.rows.map((row) => row.event)).toEqual(['triggered', 'submitted', 'approved', 'result_received', 'result_delivered']);
  });
  it('persists the result before acknowledgment and recovers after acknowledgment HTTP 500', async () => {
    state = 'completed'; ackFailures = 1;
    expect((await autonomousQaTick('ack-retry')).status).toBe('retrying');
    let status = await qaStatus(); expect(status.runs[0].result_received_at).toBeTruthy();
    expect(status.runs[0].result_delivered_at).toBeNull();
    await closeQaPool(); await due('ack-retry');
    expect((await autonomousQaTick('ack-retry')).status).toBe('completed');
    status = await qaStatus(); expect(status.runs[0].result_delivered_at).toBeTruthy(); expect(posts).toBe(1);
  });
  it('does not initiate work while disabled or persistently paused', async () => {
    vi.stubEnv('CMO_HUB_QA_ENABLED', 'false'); expect((await autonomousQaTick('disabled')).status).toBe('disabled');
    vi.stubEnv('CMO_HUB_QA_ENABLED', 'true'); await setQaPaused(true, 'qa-operator');
    expect((await autonomousQaTick('paused')).status).toBe('paused'); expect(posts).toBe(0);
    expect((await qaStatus()).runs).toHaveLength(0);
  });
  it('blocks mismatched experiment evidence without acknowledging it', async () => {
    state = 'completed'; badVersion = true;
    expect((await autonomousQaTick('altered-version')).status).toBe('blocked');
    const status = await qaStatus(); expect(status.runs[0].result_delivered_at).toBeNull(); expect(status.runs[0].last_error).toContain('evidence');
    const fetch = vi.mocked(globalThis.fetch);
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/delivered'))).toBe(false);
  });
  it('records a terminal failed worker result as failed, never completed', async () => {
    state = 'failed';
    expect((await autonomousQaTick('worker-failed')).status).toBe('failed');
    expect((await qaStatus()).runs[0].state).toBe('failed');
  });
  it('retries transient submission failures with backoff and blocks after the sixth failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'unavailable' }, { status: 500 })));
    for (let i = 1; i <= 6; i++) {
      await due('hub-down'); const result = await autonomousQaTick('hub-down');
      expect(result.status).toBe(i < 6 ? 'retrying' : 'blocked');
      const status = await qaStatus(); expect(status.runs[0].consecutive_failures).toBe(i);
      expect(Boolean(status.runs[0].next_run_at)).toBe(i < 6);
    }
  });
  it('shows Hub cancellation and dead-letter states as intervention required', async () => {
    state = 'blocked'; expect((await autonomousQaTick('hub-blocked')).status).toBe('blocked');
    expect((await qaStatus()).runs[0].hub_state).toBe('blocked');
  });
});
