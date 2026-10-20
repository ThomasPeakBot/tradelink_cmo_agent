'use client';
import { useCallback, useEffect, useState } from 'react';

type Task = { id: string; subject: string; state: string; outcome?: Record<string, unknown> | null };
export function AgentHubExperiment() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const refresh = useCallback(async () => {
    setError('');
    try {
      const r = await fetch('/api/agent-hub', { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Agent Hub unavailable');
      setTasks(Array.isArray(d.tasks) ? d.tasks : []);
      setConnected(true);
    } catch (e) {
      setConnected(false);
      setError(e instanceof Error ? e.message : 'Agent Hub unavailable');
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/agent-hub', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Agent Hub unavailable');
        return data;
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setTasks(Array.isArray(data.tasks) ? data.tasks : []);
        setConnected(true);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setConnected(false);
        setError(error instanceof Error ? error.message : 'Agent Hub unavailable');
      });
    return () => controller.abort();
  }, []);

  async function submit() {
    if (!window.confirm('Submit a SYNTHETIC dry-run experiment proposal to Agent Hub? This uses no real contacts and cannot send email.')) return;
    setBusy(true);
    setError('');
    setNote('');
    try {
      const r = await fetch('/api/agent-hub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit_synthetic_qa' }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Request refused');
      setNote('Dry-run proposal recorded: ' + d.id + '. It still needs a separate Hub approval.');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed');
    } finally {
      setBusy(false);
    }
  }
  const ours = tasks.filter((t) => t.subject.includes('TradeLink creator positioning')).slice(0, 10);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>PeakBot Agent Hub handoff</h3>
          <p>CMO → owner approval → Email Creator validation → recorded result</p>
        </div>
        <a className="btn" href="https://web-production-44a4c.up.railway.app/"
           target="_blank" rel="noopener noreferrer">Open Agent Hub ↗</a>
      </div>
      <div className="record-body">
        <p className="muted">
          This is a synthetic QA demonstration. It uses 24 fictional creator records,
          no real email sends, and an explicitly labeled business-day test schedule.
          It is not approval to activate a live campaign.
        </p>
        <div className="inline-buttons">
          <button className="btn primary" disabled={busy || !connected} onClick={() => void submit()}>
            {busy ? 'Submitting…' : 'Submit synthetic dry-run'}
          </button>
          <button className="btn" disabled={busy} onClick={() => void refresh()}>Refresh Hub status</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {note && <p role="status">{note}</p>}
        {!connected && <p className="muted">Hub connection is not enabled or is unavailable.</p>}
        {connected && ours.length === 0 && <p className="muted">No Hub requests submitted yet.</p>}
        {ours.map((task) => (
          <div className="record-row" key={task.id} style={{ padding: '12px 0', borderBottom: '1px solid #e6ebe7' }}>
            <strong>{task.subject}</strong>
            <small className="block muted">Request {task.id} · {task.state}</small>
            {task.outcome && <small className="block muted">
              Dry-run validation {task.outcome.valid === true ? 'completed' : 'needs review'}.
              A completed validation is not live copy approval.
            </small>}
          </div>
        ))}
      </div>
    </section>
  );
}
