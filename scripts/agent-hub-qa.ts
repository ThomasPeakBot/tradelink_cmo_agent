import 'dotenv/config';
import { autonomousQaTick, closeQaPool } from '../lib/agent-hub-autonomous';
import { hubRequest, qaHubEnabled } from '../lib/agent-hub';
import { assertQaRunnerConfig } from '../lib/agent-hub-runner-config';

let stopping = false;
let configurationValidated = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
async function main() {
  if (!qaHubEnabled()) { console.log(JSON.stringify({ status: 'disabled', qa_only: true })); return; }
  assertQaRunnerConfig(process.env);
  configurationValidated = true;
  const runId = process.env.CMO_HUB_QA_RUN_ID || '';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(runId)) throw new Error('CMO_HUB_QA_RUN_ID is required');
  const interval = Math.max(1, Math.min(60, Number(process.env.CMO_HUB_QA_INTERVAL_SECONDS || 5)));
  const ticks = Math.max(1, Math.min(600, Number(process.env.CMO_HUB_QA_MAX_TICKS || 120)));
  if (!Number.isFinite(interval) || !Number.isFinite(ticks)) throw new Error('Invalid bounded QA schedule');
  await hubRequest('POST', '/api/v1/agent/heartbeat', { state: 'tracking', version: 'autonomous-qa-v1' })
    .catch(() => { console.error('QA heartbeat unavailable; operational status is unverified.'); });
  for (let i = 0; i < ticks && !stopping; i++) {
    const result = await autonomousQaTick(runId, interval);
    await hubRequest('POST', '/api/v1/agent/heartbeat', {
      state: ['failed', 'blocked'].includes(result.status) ? 'failed' : result.status === 'completed' ? 'idle' : 'tracking',
      task_id: 'task_id' in result ? result.task_id : undefined, version: 'autonomous-qa-v1',
    }).catch(() => { console.error('QA heartbeat unavailable; operational status is unverified.'); });
    console.log(JSON.stringify({ ...result, tick: i + 1, qa_only: true }));
    if (['completed', 'failed', 'blocked', 'disabled', 'paused'].includes(result.status)) {
      if (['failed', 'blocked'].includes(result.status)) process.exitCode = 1;
      return;
    }
    for (let wait = 0; wait < interval * 10 && !stopping; wait++) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log(JSON.stringify({ status: stopping ? 'stopped' : 'bounded_run_exhausted', run_id: runId, qa_only: true }));
  if (!stopping) process.exitCode = 2;
}
main().catch(() => { console.error('CMO QA runner failed; inspect the durable run status.'); process.exitCode = 1; })
  .finally(async () => {
    if (configurationValidated) await hubRequest('POST', '/api/v1/agent/heartbeat', { state: 'paused', version: 'autonomous-qa-v1' }).catch(() => {});
    await closeQaPool();
  });
