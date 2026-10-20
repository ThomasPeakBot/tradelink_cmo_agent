import copyContract from '../lib/agent-hub-qa-copy.json';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAutonomousQaExperiment, hubRequest, qaHubEnabled } from '../lib/agent-hub';
import { canonical, qaPayloadHash, validateQaOutcome } from '../lib/agent-hub-autonomous';

const taskId = '10000000-0000-4000-8000-000000000001';
const hash = qaPayloadHash(buildAutonomousQaExperiment('unit'));
function task() {
  return { id: taskId, state: 'completed', payload_hash: hash, target_agent: 'emailcreator', capability: 'prepare_experiment',
    outcome: { kind: 'tradelink_experiment_dry_run', mode: 'dry_run', side_effects: 'none', valid: true,
      validation: 'passed', requested_experiment_version: 'v1', experiment: { id: 'tradelink-creator-positioning', version: { label: 'v1', sha256: copyContract.definition_sha256 }, sources_sha256: copyContract.sources_sha256 },
      adapter: { agent: 'emailcreator', capability: 'prepare_experiment', hub_task_id: taskId, store_durable: true },
      approval: { launch_ready: false, approved_for_sending: false }, audience: { leads_read: 24, selected: 24 },
      assignment: { A: 12, B: 12 }, variants: structuredClone(copyContract.variants), plan_sha256: 'a'.repeat(64),
      preparation: { qa_only: true, full_plan_persisted: true, artifact_sha256: 'b'.repeat(64) } } };
}
describe('bounded autonomous CMO QA contract', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it('pins the same immutable fictional fixture across QA runs while changing only idempotency', () => {
    const one = buildAutonomousQaExperiment('one'); const two = buildAutonomousQaExperiment('two');
    expect(one.payload.start_date).toBe('2026-10-27');
    expect(one.payload).toEqual(two.payload);
    expect(one.idempotency_key).not.toBe(two.idempotency_key);
    expect(qaPayloadHash(one)).toBe(qaPayloadHash(two));
    expect(one.payload.leads.every((lead) => lead.identity.email.endsWith('.example'))).toBe(true);
  });
  it('rejects arbitrary identifiers and payload destinations', async () => {
    expect(() => buildAutonomousQaExperiment('../evil')).toThrow();
    expect(() => buildAutonomousQaExperiment('x'.repeat(65))).toThrow();
    vi.stubEnv('CMO_HUB_ORIGIN', 'http://127.0.0.1:3200');
    vi.stubEnv('CMO_HUB_AGENT_TOKEN', 'x'.repeat(32));
    vi.stubEnv('CMO_ENVIRONMENT', 'isolated_qa');
    await expect(hubRequest('POST', '/api/v1/agent/tasks/not-an-id/delivered')).rejects.toMatchObject({ status: 422 });
  });
  it('requires both isolated environment and explicit enable flag', () => {
    vi.stubEnv('CMO_HUB_QA_ENABLED', 'true'); vi.stubEnv('CMO_ENVIRONMENT', 'production');
    expect(qaHubEnabled()).toBe(false);
    vi.stubEnv('CMO_ENVIRONMENT', 'isolated_qa'); expect(qaHubEnabled()).toBe(true);
    vi.stubEnv('CMO_HUB_QA_ENABLED', 'false'); expect(qaHubEnabled()).toBe(false);
  });
  it('canonicalizes nested dictionaries exactly and detects a changed payload', () => {
    expect(canonical({ z: 1, a: [2, { c: true, b: false }] })).toBe('{"a":[2,{"b":false,"c":true}],"z":1}');
    const changed = buildAutonomousQaExperiment('unit'); changed.payload.discount_percent = 50;
    expect(qaPayloadHash(changed)).not.toBe(hash);
  });
  it('accepts only completed evidence for the exact task and immutable experiment', () => {
    expect(validateQaOutcome(task(), taskId, hash).valid).toBe(true);
    const changed = task(); changed.payload_hash = 'c'.repeat(64);
    expect(() => validateQaOutcome(changed, taskId, hash)).toThrow();
  });
  it.each(['source', 'version', 'definition_hash', 'source_hash', 'copy_hash', 'send', 'artifact', 'audience', 'valid'])('rejects altered %s evidence', (change) => {
    const result = task();
    if (change === 'source') result.outcome.adapter.agent = 'tradelink-cmo';
    if (change === 'version') result.outcome.experiment.version.label = 'v2';
    if (change === 'definition_hash') result.outcome.experiment.version.sha256 = 'c'.repeat(64);
    if (change === 'source_hash') result.outcome.experiment.sources_sha256 = 'd'.repeat(64);
    if (change === 'copy_hash') result.outcome.variants.A.touches[0].subject_sha256 = 'e'.repeat(64);
    if (change === 'send') result.outcome.approval.approved_for_sending = true;
    if (change === 'artifact') result.outcome.preparation.full_plan_persisted = false;
    if (change === 'audience') result.outcome.audience.selected = 23;
    if (change === 'valid') result.outcome.valid = false;
    expect(() => validateQaOutcome(result, taskId, hash)).toThrow();
  });
});
