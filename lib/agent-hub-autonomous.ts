/** Bounded deterministic QA preparation only. No provider SDK or sending integration is imported. */
import { createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { buildAutonomousQaExperiment, HUB_AGENT_ID, hubRequest, HubError, qaHubEnabled } from './agent-hub';
import copyContract from './agent-hub-qa-copy.json';

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return '{' + Object.keys(object).sort().map((key) => JSON.stringify(key) + ':' + canonical(object[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}
export function qaPayloadHash(proposal: ReturnType<typeof buildAutonomousQaExperiment>) {
  return createHash('sha256').update(canonical([
    HUB_AGENT_ID, proposal.target_agent, proposal.capability, proposal.subject, proposal.payload,
  ])).digest('hex');
}
type HubTask = Record<string, unknown> & { id: string; state: string };
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function validateQaOutcome(task: HubTask, expectedTask: string, expectedHash: string) {
  if (task.id !== expectedTask || task.payload_hash !== expectedHash || task.target_agent !== 'emailcreator' ||
      task.capability !== 'prepare_experiment' || !['completed', 'failed'].includes(task.state)) {
    throw new HubError('Hub terminal result does not match the immutable request.', 422);
  }
  const evidence = object(task.outcome);
  const experiment = object(evidence.experiment);
  const version = object(experiment.version);
  const adapter = object(evidence.adapter);
  const approval = object(evidence.approval);
  const audience = object(evidence.audience);
  const assignment = object(evidence.assignment);
  const preparation = object(evidence.preparation);
  if (evidence.kind !== 'tradelink_experiment_dry_run' || evidence.mode !== 'dry_run' ||
      evidence.side_effects !== 'none' || experiment.id !== 'tradelink-creator-positioning' ||
      version.label !== 'v1' || version.sha256 !== copyContract.definition_sha256 ||
      experiment.sources_sha256 !== copyContract.sources_sha256 ||
      evidence.requested_experiment_version !== 'v1' || adapter.agent !== 'emailcreator' ||
      adapter.capability !== 'prepare_experiment' || adapter.hub_task_id !== expectedTask ||
      adapter.store_durable !== true || approval.launch_ready !== false || approval.approved_for_sending !== false) {
    throw new HubError('Email Creator evidence failed identity, version or no-send validation.', 422);
  }
  if (task.state === 'completed' && (evidence.valid !== true || evidence.validation !== 'passed' ||
      audience.leads_read !== 24 || audience.selected !== 24 ||
      Number(assignment.A) + Number(assignment.B) !== 24 ||
      preparation.qa_only !== true || preparation.full_plan_persisted !== true ||
      !/^[a-f0-9]{64}$/.test(String(preparation.artifact_sha256)) ||
      !/^[a-f0-9]{64}$/.test(String(evidence.plan_sha256)))) {
    throw new HubError('Completed preparation evidence is incomplete.', 422);
  }
  if (task.state === 'completed') {
    const variants = object(evidence.variants);
    for (const arm of ['A', 'B'] as const) {
      const touches = object(variants[arm]).touches;
      if (!Array.isArray(touches) || touches.length !== 5 || touches.some((touch, i) => {
        const actual = object(touch);
        const expected = copyContract.variants[arm].touches[i];
        return Object.entries(expected).some(([key, value]) => canonical(actual[key]) !== canonical(value));
      })) throw new HubError('Returned copy fingerprints or source fidelity differ from the approved QA definition.', 422);
    }
  }
  return evidence;
}

let pool: Pool | undefined;
export function qaPool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  return pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 5000,
    statement_timeout: 10000, idleTimeoutMillis: 1000 });
}
export async function closeQaPool() { if (pool) { await pool.end(); pool = undefined; } }
async function event(client: PoolClient, run: string, name: string, detail: Record<string, unknown> = {}) {
  await client.query('INSERT INTO cmo_hub_qa_events(run_id,event,detail) VALUES ($1,$2,$3)', [run, name, detail]);
}
export async function qaStatus() {
  const db = qaPool();
  const controls = await db.query('SELECT paused,updated_at FROM cmo_hub_qa_controls WHERE id=TRUE');
  const rows = await db.query(`SELECT run_id,experiment_id,experiment_version,task_id,workflow_id,state,hub_state,
    attempts,consecutive_failures,next_run_at,last_run_at,submitted_at,result_received_at,result_delivered_at,
    last_error,result,created_at,updated_at FROM cmo_hub_qa_runs ORDER BY created_at DESC LIMIT 10`);
  return { enabled: qaHubEnabled(), paused: controls.rows[0]?.paused ?? true, runs: rows.rows.map((run) => ({
    ...run,
    result: run.result ? {
      valid: run.result.valid, validation: run.result.validation, mode: run.result.mode,
      side_effects: run.result.side_effects, approval: run.result.approval,
      warnings: run.result.warnings, errors: run.result.errors, plan_sha256: run.result.plan_sha256,
      preparation: run.result.preparation, audience: run.result.audience, assignment: run.result.assignment,
    } : null,
  })) };
}
export async function setQaPaused(paused: boolean, actor: string = 'administrator') {
  const client = await qaPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE cmo_hub_qa_controls SET paused=$1,updated_at=now() WHERE id=TRUE', [paused]);
    await client.query(`INSERT INTO cmo_hub_qa_events(run_id,event,detail)
      SELECT run_id,'qa_pause_changed',$1 FROM cmo_hub_qa_runs`, [{ paused, actor }]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  return qaStatus();
}

/** A session advisory lock fences concurrent CMO processes; Hub idempotency fences a crash after HTTP. */
export async function autonomousQaTick(runId: string, intervalSeconds = 5) {
  if (!qaHubEnabled()) return { status: 'disabled' };
  const proposal = buildAutonomousQaExperiment(runId);
  const payloadHash = qaPayloadHash(proposal);
  const client = await qaPool().connect();
  let locked = false;
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', ['cmo-hub-qa:' + runId]);
    locked = lock.rows[0].locked;
    if (!locked) return { status: 'already_running' };
    const controls = await client.query('SELECT paused FROM cmo_hub_qa_controls WHERE id=TRUE');
    if (controls.rows[0]?.paused !== false) return { status: 'paused' };
    const inserted = await client.query(`INSERT INTO cmo_hub_qa_runs(run_id,experiment_id,experiment_version,payload_hash,idempotency_key)
      VALUES ($1,'tradelink-creator-positioning','v1',$2,$3) ON CONFLICT DO NOTHING RETURNING run_id`,
    [runId, payloadHash, proposal.idempotency_key]);
    if (inserted.rowCount) await event(client, runId, 'triggered', { actor: HUB_AGENT_ID, qa_only: true, payload_hash: payloadHash });
    const { rows } = await client.query('SELECT * FROM cmo_hub_qa_runs WHERE run_id=$1', [runId]);
    const run = rows[0];
    if (run.payload_hash !== payloadHash) throw new HubError('Stored QA request fingerprint changed; intervention required.', 422);
    if (run.result_delivered_at || ['blocked', 'failed'].includes(run.state)) return { status: run.state, run_id: runId, task_id: run.task_id };
    if (run.next_run_at && new Date(run.next_run_at).getTime() > Date.now()) return { status: 'waiting', run_id: runId, task_id: run.task_id };
    await client.query('UPDATE cmo_hub_qa_runs SET attempts=attempts+1,last_run_at=now(),updated_at=now() WHERE run_id=$1', [runId]);
    try {
      if (!run.task_id) {
        // Re-read the kill switch immediately before creating work.
        const control = await client.query('SELECT paused FROM cmo_hub_qa_controls WHERE id=TRUE');
        if (!qaHubEnabled() || control.rows[0]?.paused !== false) return { status: 'paused' };
        const response = await hubRequest('POST', '/api/v1/agent/proposals', proposal);
        if (!/^[a-f0-9-]{36}$/.test(String(response.id)) || response.payload_hash !== payloadHash) {
          throw new HubError('Hub did not return the expected immutable proposal.', 422);
        }
        run.task_id = response.id;
        await client.query(`UPDATE cmo_hub_qa_runs SET task_id=$2,workflow_id=$3,state='submitted',hub_state=$4,
          submitted_at=now(),updated_at=now() WHERE run_id=$1`, [runId, response.id, response.workflow_id ?? null, response.state]);
        await event(client, runId, 'submitted', { task_id: response.id, payload_hash: payloadHash });
      }
      const submissions = await hubRequest('GET', `/api/v1/agent/submissions?task_id=${run.task_id}`);
      const task = Array.isArray(submissions.tasks) ? submissions.tasks.find((value) => object(value).id === run.task_id) as HubTask | undefined : undefined;
      if (!task || task.payload_hash !== payloadHash || task.target_agent !== 'emailcreator' || task.capability !== 'prepare_experiment') {
        throw new HubError('Hub request readback did not match the stored task.', 422);
      }
      if (['completed', 'failed'].includes(task.state)) {
        const evidence = validateQaOutcome(task, run.task_id, payloadHash);
        await client.query(`UPDATE cmo_hub_qa_runs SET result=$2,result_received_at=COALESCE(result_received_at,now()),
          hub_state=$3,state='result_received',workflow_id=$4,last_error=NULL,updated_at=now() WHERE run_id=$1`,
        [runId, evidence, task.state, task.workflow_id ?? run.workflow_id]);
        if (!run.result_received_at) await event(client, runId, 'result_received', { task_id: run.task_id, hub_state: task.state, validation: evidence.validation });
        const ack = await hubRequest('POST', `/api/v1/agent/tasks/${run.task_id}/delivered`, { payload_hash: payloadHash });
        if (ack.id !== run.task_id || ack.state !== task.state ||
            (task.workflow_id && ack.workflow_id !== task.workflow_id) ||
            typeof ack.result_delivered_at !== 'string' || !Number.isFinite(Date.parse(ack.result_delivered_at))) {
          throw new HubError('Hub has not confirmed matching result delivery.', 503);
        }
        await client.query(`UPDATE cmo_hub_qa_runs SET result_delivered_at=$2,state=$3,consecutive_failures=0,
          next_run_at=NULL,last_error=NULL,updated_at=now() WHERE run_id=$1`, [runId, ack.result_delivered_at, task.state]);
        await event(client, runId, 'result_delivered', { task_id: run.task_id, outcome: task.state });
        return { status: task.state, run_id: runId, task_id: run.task_id };
      }
      if (!['proposed', 'approved', 'claimed', 'retrying', 'cancelled', 'needs_human', 'blocked', 'rejected'].includes(task.state)) {
        throw new HubError('Unknown Hub task state; intervention required.', 422);
      }
      const state = ['cancelled', 'needs_human', 'blocked', 'rejected'].includes(task.state) ? 'blocked' : 'awaiting_result';
      if (task.state !== run.hub_state) await event(client, runId, task.state, { task_id: run.task_id });
      await client.query(`UPDATE cmo_hub_qa_runs SET state=$2,hub_state=$3,workflow_id=$4,consecutive_failures=0,
        last_error=NULL,next_run_at=now()+($5*interval '1 second'),updated_at=now() WHERE run_id=$1`,
      [runId, state, task.state, task.workflow_id ?? run.workflow_id, Math.max(1, Math.min(intervalSeconds, 60))]);
      return { status: state, run_id: runId, task_id: run.task_id };
    } catch (error) {
      const permanent = error instanceof HubError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status);
      const failures = Number(run.consecutive_failures) + 1;
      const blocked = permanent || failures >= 6;
      const message = error instanceof HubError ? error.message : 'QA persistence or processing failed; no success is assumed.';
      await client.query(`UPDATE cmo_hub_qa_runs SET state=$2,consecutive_failures=$3,last_error=$4,
        next_run_at=CASE WHEN $5 THEN NULL ELSE now()+($6*interval '1 second') END,updated_at=now() WHERE run_id=$1`,
      [runId, blocked ? 'blocked' : 'retrying', failures, message, blocked, Math.min(60, 2 ** failures)]);
      await event(client, runId, blocked ? 'blocked' : 'retrying', { reason: message, attempt: failures });
      return { status: blocked ? 'blocked' : 'retrying', run_id: runId, task_id: run.task_id, error: message };
    }
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['cmo-hub-qa:' + runId]).catch(() => {});
    client.release();
  }
}
