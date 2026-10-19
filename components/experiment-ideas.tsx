'use client';
import { useEffect, useState } from 'react';
import type { GrowthIdea } from '@/lib/experiment-ideas';
type Row = {
  id: string;
  focus: string;
  content: string;
  provider: string;
  status: string;
  feedback: string;
  experimentId: string | null;
};
type Mutate = (resource: string, body: Record<string, unknown>) => Promise<void>;
export function ExperimentIdeas({ mutate }: { mutate: Mutate }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState('');
  const [focus, setFocus] = useState('');
  const [reason, setReason] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function load() {
    const response = await fetch('/api/experiment-ideas', { cache: 'no-store' });
    if (!response.ok) throw Error('Could not load saved idea history.');
    setRows(await response.json());
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/experiment-ideas', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error('Could not load idea history.');
        return response.json();
      })
      .then((result) => setRows(result))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  const row = rows.find((r) => r.id === selected) || rows[0];
  let idea: GrowthIdea | undefined;
  try {
    if (row) idea = JSON.parse(row.content);
  } catch {
    /* Preserve inaccessible history for server-side review. */
  }
  async function generate() {
    const response = await fetch('/api/experiment-ideas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'generate', focus }),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Could not generate idea.');
    await load();
    setSelected(result.id);
    setReviewing(false);
    setReason('');
  }
  async function run(action: 'generate' | 'save' | 'reject') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (action === 'generate') await generate();
      else if (row) {
        if (action === 'save') {
          await mutate('experiment-ideas', { action: 'save', id: row.id });
          await load();
          setNotice(
            'Saved to experiment backlog. Initial ICE scores are neutral at 5/5/5. Nothing launched.',
          );
        } else {
          await mutate('experiment-ideas', { action: 'reject', id: row.id, reason });
          await load();
          setReviewing(false);
          setReason('');
          setNotice('Feedback saved to CMO memory.');
          await generate();
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Creative growth idea lab</h3>
          <p>Generate an idea, save what you like, and teach the CMO what to change.</p>
        </div>
      </div>
      <div className="record-body">
        <p className="muted">
          Ideas are proposals. Saving adds an experiment to the backlog; publishing, outreach and
          spending need separate approval.
        </p>
        <label>
          Focus or constraints (optional)
          <textarea
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            maxLength={2000}
            placeholder="For example: a creative referral loop we can test for under $200 this week."
            disabled={busy}
          />
        </label>
        <button className="btn primary" disabled={busy} onClick={() => run('generate')}>
          {busy ? 'Working…' : 'Generate a growth idea'}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {row && idea && (
          <article className="idea-proposal">
            <div className="inline-buttons">
              <span className="badge">{row.status}</span>
              <span className="muted">
                {row.provider} · Estimated ${idea.costUsd.toLocaleString()} · {idea.minutes} minutes
              </span>
            </div>
            <h3>{idea.title}</h3>
            <p>
              <strong>Growth mechanism:</strong> {idea.mechanism}
            </p>
            <p>
              <strong>Audience / channel:</strong> {idea.audience} / {idea.channel}
            </p>
            <p>
              <strong>Hypothesis:</strong> {idea.hypothesis}
            </p>
            <p>
              <strong>Why this fits:</strong> {idea.rationale}
            </p>
            <h4>Smallest test</h4>
            <ol>
              {idea.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            <p>
              <strong>Success measure:</strong> {idea.successMetric}
            </p>
            <p>
              <strong>Review point:</strong> {idea.reviewPoint}
            </p>
            <p>
              <strong>Stop / scale:</strong> {idea.stopScale}
            </p>
            <h4>Copy-ready AI prompts</h4>
            {idea.aiPrompts.map((p, i) => (
              <textarea
                key={i}
                readOnly
                aria-label={`Idea AI prompt ${i + 1}`}
                value={p}
                rows={5}
              />
            ))}
            <p className="muted">Evidence: {idea.evidence.join(' · ')}</p>
            {idea.warnings.length > 0 && (
              <ul className="muted">
                {idea.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            {row.feedback && (
              <p>
                <strong>Your feedback:</strong> {row.feedback}
              </p>
            )}
            {row.status === 'DRAFT' && (
              <div className="inline-buttons">
                <button className="btn primary" disabled={busy} onClick={() => run('save')}>
                  Save to experiment backlog
                </button>
                <button className="btn" disabled={busy} onClick={() => setReviewing(!reviewing)}>
                  Not for me — give feedback
                </button>
              </div>
            )}
            {row.status === 'DRAFT' && reviewing && (
              <form
                className="today-task-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run('reject');
                }}
              >
                <label>
                  Why doesn’t this idea work for you?
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                    maxLength={2000}
                    disabled={busy}
                  />
                </label>
                <button className="btn" disabled={busy || !reason.trim()}>
                  Save feedback & suggest another
                </button>
              </form>
            )}
          </article>
        )}
        {rows.length > 0 && (
          <details className="idea-history">
            <summary>Idea history ({rows.length} most recent)</summary>
            <ul>
              {rows.map((r) => (
                <li key={r.id}>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => {
                      setSelected(r.id);
                      setReviewing(false);
                      setReason('');
                    }}
                  >
                    {JSON.parse(r.content).title} · {r.status}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
