'use client';
import { useState } from 'react';
import type { WorkRecord } from '@/lib/operating-context';
export function DeferredWork({
  tasks,
  mutate,
}: {
  tasks: WorkRecord[];
  mutate: (resource: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const [selected, setSelected] = useState('');
  const [outcome, setOutcome] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!tasks.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Unfinished deferred work</h3>
          <p>
            These items carry forward across days. The CMO checks them before recommending dependent
            work.
          </p>
        </div>
      </div>
      <div className="record-body">
        {tasks.map((t) => (
          <details key={t.id}>
            <summary>
              {t.title} · deferred {t.date}
            </summary>
            <p>
              <strong>Your reason:</strong> {t.reason}
            </p>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setSelected(t.id);
                setOutcome('');
                setError('');
              }}
            >
              Record prerequisite completion
            </button>
            {selected === t.id && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError('');
                  try {
                    await mutate('today', { action: 'complete-deferred', taskId: t.id, outcome });
                    setSelected('');
                    setOutcome('');
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Could not save completion.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  What was completed, and what evidence confirms it?
                  <textarea
                    value={outcome}
                    onChange={(e) => setOutcome(e.target.value)}
                    required
                    maxLength={3000}
                  />
                </label>
                <p className="muted">
                  Use this after the deferred task is actually completed, not merely when its
                  blocker clears.
                </p>
                <button className="btn primary" disabled={busy || !outcome.trim()}>
                  Record completed prerequisite
                </button>
              </form>
            )}
          </details>
        ))}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
