'use client';
import { useEffect, useState } from 'react';
type Finding = string | { rule?: string; where?: string; detail?: string; severity?: string };
export type Run = { run_id: string; experiment_id: string; experiment_version: string; task_id: string | null;
  state: string; hub_state: string | null; last_run_at: string | null; next_run_at: string | null;
  submitted_at: string | null; result_received_at: string | null; result_delivered_at: string | null;
  last_error: string | null; result: { valid?: boolean; validation?: string; warnings?: Finding[];
    errors?: Finding[]; plan_sha256?: string } | null };
type Status = { enabled: boolean; paused: boolean; runs: Run[] };
const when = (value: string | null) => value ? new Date(value).toLocaleString() : 'Not yet';
function findingText(finding: Finding) {
  return typeof finding === 'string' ? finding : [finding.severity, finding.where, finding.rule, finding.detail].filter(Boolean).join(' · ');
}
/** Pure presentation also permits real returned findings to be regression-tested without a database/auth bootstrap. */
export function AutonomousQaRun({ run }: { run: Run }) {
  return <article className="record-row" style={{ padding: '12px 0', borderBottom: '1px solid #e6ebe7' }}>
    <strong>{run.experiment_id} · {run.experiment_version} · {run.state}</strong>
    <small className="block">Run {run.run_id} · Hub task {run.task_id || 'not submitted'} · Hub {run.hub_state || 'not accepted yet'}</small>
    <small className="block">Submitted {when(run.submitted_at)} · Last attempt {when(run.last_run_at)} · Next attempt {when(run.next_run_at)}</small>
    <small className="block">Email Creator result {when(run.result_received_at)} · Delivery confirmed {when(run.result_delivered_at)}</small>
    {run.last_error && <p className="error">{run.last_error}</p>}
    {run.result && <><p>Preparation validation: {run.result.validation}. {run.state === 'completed' && run.result_delivered_at ? 'The verified result has returned to CMO.' : 'Final preparation is not yet confirmed.'} Live sending remains disabled.</p>
      <small className="block">Plan fingerprint {run.result.plan_sha256 || 'not available'}</small>
      {(run.result.warnings || []).map((warning, i) => <p className="muted" key={i}>{findingText(warning)}</p>)}
      {(run.result.errors || []).map((finding, i) => <p className="error" key={i}>{findingText(finding)}</p>)}</>}
  </article>;
}
export function AgentHubAutonomous() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch('/api/agent-hub/autonomous', { cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'QA state unavailable');
        setStatus(data); setError('');
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'QA state unavailable'); }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 5000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);
  async function pause(paused: boolean) {
    setBusy(true);
    try {
      const response = await fetch('/api/agent-hub/autonomous', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Pause could not be saved');
      setStatus(data); setError('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Pause could not be saved'); }
    finally { setBusy(false); }
  }
  return <section className="panel" data-testid="autonomous-hub-qa">
    <div className="panel-head"><div><h3>Autonomous experiment preparation</h3><p>Isolated QA · fictional 24-lead cohort · live launch blocked</p></div></div>
    <div className="record-body">
      {error && <p className="error" role="alert">{error}</p>}
      {status && <><p>Trigger {status.enabled ? 'enabled' : 'disabled'} · {status.paused ? 'paused' : 'accepting the configured QA run'}. The dedicated runner starts work; opening this panel does not.</p>
        <button className="btn" disabled={busy} onClick={() => void pause(!status.paused)}>{status.paused ? 'Resume QA requests' : 'Pause QA requests'}</button>
        {status.runs.length === 0 && <p className="muted">No autonomous run has been recorded. Configure the isolated QA runner to begin.</p>}
        {status.runs.map((run) => <AutonomousQaRun key={run.run_id} run={run} />)}</>}
    </div>
  </section>;
}
