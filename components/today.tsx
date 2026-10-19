'use client';
import { useState, type FormEvent } from 'react';
import type { Workspace } from '@/lib/workspace';
type Json<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Json<U>[]
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T;
type Plan = NonNullable<Json<Workspace>['today']['current']>;
type Task = Plan['tasks'][number];
type Mutate = (resource: string, body: Record<string, unknown>) => Promise<void>;
export function Today({ data, mutate }: { data: Json<Workspace>; mutate: Mutate }) {
  const [selected, setSelected] = useState('');
  const [budget, setBudget] = useState(270);
  const [mode, setMode] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const plan =
    selected && selected !== data.today.date
      ? data.today.history.find((p) => p.date === selected)
      : data.today.current;
  const historical = !!plan && plan.date !== data.today.date;
  const planned =
    plan?.tasks.filter((t) => t.status !== 'DEFERRED').reduce((n, t) => n + t.minutes, 0) ?? 0;
  const sources: Record<string, { label: string; url?: string }> = Object.fromEntries([
    ['workspace', { label: 'Workspace evidence and gaps' }],
    ['growth', { label: 'Subscriber pace and forecast' }],
    ['stripe', { label: 'Stripe billing snapshot' }],
    ...data.knowledge.map((r) => [`knowledge:${r.id}`, { label: r.title }]),
    ...data.experiments.map((r) => [`experiment:${r.id}`, { label: r.title }]),
    ...data.memories.map((r) => [`memory:${r.id}`, { label: r.title }]),
    ...data.alerts.map((r) => [`alert:${r.id}`, { label: r.title }]),
    ...data.approvals.map((r) => [`approval:${r.id}`, { label: r.title }]),
    ...data.channels.map((r) => [`channel:${r.id}`, { label: r.name }]),
    ...data.social.map((r) => [`social:${r.provider}`, { label: `${r.label} organic reporting` }]),
    ...data.drive.documents.map((r) => [`drive:${r.fileId}`, { label: r.name, url: r.sourceUrl }]),
  ]);
  const actual = plan?.tasks.reduce((n, t) => n + (t.actualMinutes ?? 0), 0) ?? 0;
  async function generate() {
    setBusy(true);
    setError('');
    try {
      await mutate('today', { action: 'generate', budgetMinutes: budget, mode });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Plan generation failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="today-intro">
        <div>
          <span className="eyebrow">FOCUS / {data.today.date} · EASTERN</span>
          <h2>Your next right moves.</h2>
          <p className="muted">
            Three priorities, a clear finish line, and room to learn. Nothing is published or spent
            automatically.
          </p>
        </div>
        <label>
          View workday
          <select
            aria-label="View workday"
            value={selected || data.today.date}
            onChange={(e) => {
              setSelected(e.target.value);
              setError('');
            }}
          >
            <option value={data.today.date}>Today · {data.today.date}</option>
            {data.today.history.map((p) => (
              <option key={p.id} value={p.date}>
                {p.date}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!plan && !historical && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h3>Build today’s plan</h3>
              <p>
                Choose your available time. Twenty minutes for review and twenty for check-in are
                reserved.
              </p>
            </div>
          </div>
          <div className="record-body">
            <div className="form-grid">
              <label>
                Available time
                <select value={budget} onChange={(e) => setBudget(Number(e.target.value))}>
                  <option value={240}>4 hours</option>
                  <option value={270}>4.5 hours</option>
                  <option value={300}>5 hours</option>
                </select>
              </label>
              <label>
                Planning provider
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="auto">Use configured intelligence provider</option>
                  <option value="local">Local evidence rules</option>
                </select>
              </label>
            </div>
            <button className="btn primary" onClick={generate} disabled={busy}>
              {busy ? 'Reviewing evidence…' : 'Generate today’s plan'}
            </button>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <p>
              Draft actions use stored company knowledge, subscriber pace, channels, experiments,
              decisions and memory. Generation does not trigger a sync. Use Sync all first if the
              data is stale.
            </p>
          </div>
        </section>
      )}
      {plan && (
        <>
          <div className="today-stats">
            <div>
              <small>DAILY BUDGET</small>
              <strong>{plan.budgetMinutes} min</strong>
            </div>
            <div>
              <small>ACTIVE TASK ESTIMATES</small>
              <strong>{planned} min</strong>
            </div>
            <div>
              <small>REVIEW + CHECK-IN</small>
              <strong>40 min</strong>
            </div>
            <div>
              <small>REPORTED ACTUAL WORK</small>
              <strong>{actual} min</strong>
            </div>
          </div>
          <section className="panel">
            <div className="panel-head">
              <h3>
                {historical ? 'Past workday' : 'Today’s proposed plan'} · {plan.date}
              </h3>
              <span className={`badge ${plan.isDemo ? 'demo' : 'green'}`}>
                {plan.isDemo ? 'INCLUDES DEMO CONTEXT' : 'STORED EVIDENCE'}
              </span>
            </div>
            <div className="record-body">
              <p>{plan.summary}</p>
              <small>
                {plan.provider} · Evidence read {new Date(plan.dataAsOf).toLocaleString()}. Outcomes
                are user reports; completion does not independently prove a growth result.
              </small>
              {plan.warnings.map((w, i) => (
                <p className="today-warning" key={i}>
                  {w}
                </p>
              ))}
              <p>
                Approval here accepts an internal work item. Publishing, spending or contacting
                people still requires a separate explicit approval and manual execution.
              </p>
            </div>
          </section>
          {plan.tasks.map((task) => (
            <TaskCard
              key={`${task.id}:${plan.version}`}
              task={task}
              plan={plan}
              historical={historical}
              mutate={mutate}
              sources={sources}
            />
          ))}
          <section className="panel">
            <div className="panel-head">
              <div>
                <h3>End-of-day check-in</h3>
                <p>Save outcomes, lessons and blockers to institutional memory for tomorrow.</p>
              </div>
            </div>
            <CheckIn
              key={`${plan.id}:${plan.version}`}
              plan={plan}
              historical={historical}
              mutate={mutate}
            />
          </section>
        </>
      )}
    </>
  );
}
function TaskCard({
  task,
  plan,
  historical,
  mutate,
  sources,
}: {
  task: Task;
  sources: Record<string, { label: string; url?: string }>;
  plan: Plan;
  historical: boolean;
  mutate: Mutate;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState('');
  const [minutes, setMinutes] = useState('');
  async function save(values: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      await mutate('today', { planId: plan.id, version: plan.version, taskId: task.id, ...values });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update task.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">
            PRIORITY {task.position + 1} · {task.minutes} MIN
          </span>
          <h3 className="today-task-title">{task.title}</h3>
        </div>
        <span className="badge">{task.status}</span>
      </div>
      <div className="record-body">
        <p>
          <strong>Deliverable:</strong> {task.deliverable}
        </p>
        <p>
          <strong>Success measure:</strong> {task.successMetric}
        </p>
        <p>
          <strong>Draft rationale:</strong> {task.rationale}
        </p>
        <p className="today-evidence">
          <small>
            Evidence:{' '}
            {task.evidence.map((id, i) => (
              <span key={id}>
                {i > 0 ? ' · ' : ''}
                {sources[id]?.url ? (
                  <a href={sources[id].url} target="_blank" rel="noopener noreferrer">
                    {sources[id].label}
                  </a>
                ) : (
                  sources[id]?.label || id
                )}
              </span>
            ))}
          </small>
        </p>
        {task.guide ? (
          <TaskGuide guide={task.guide} />
        ) : !historical && task.status !== 'COMPLETED' ? (
          <div className="today-guide">
            <h4>Step-by-step instructions & AI help</h4>
            <p>
              Generate practical steps, input requirements and copy-ready prompts for this task.
            </p>
            <button className="btn" disabled={busy} onClick={() => save({ action: 'guide' })}>
              {busy ? 'Preparing instructions…' : 'Generate AI instructions'}
            </button>
          </div>
        ) : null}
        {task.status === 'COMPLETED' && (
          <div className="review-result">
            <strong>Reported outcome</strong>
            <p>{task.outcome}</p>
            <small>Actual time: {task.actualMinutes ?? 'not recorded'} minutes</small>
          </div>
        )}
        {!historical && task.status !== 'COMPLETED' && (
          <>
            <div className="inline-buttons">
              {task.status !== 'APPROVED' && (
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => save({ action: 'task', status: 'APPROVED' })}
                >
                  Approve task
                </button>
              )}
              {task.status !== 'DEFERRED' && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => save({ action: 'task', status: 'DEFERRED' })}
                >
                  Defer task
                </button>
              )}
              <button className="btn" disabled={busy} onClick={() => setEditing(!editing)}>
                {editing ? 'Cancel edit' : 'Edit task'}
              </button>
            </div>
            {editing && (
              <form
                className="today-task-form"
                onSubmit={async (e: FormEvent<HTMLFormElement>) => {
                  e.preventDefault();
                  const values = Object.fromEntries(new FormData(e.currentTarget));
                  await save({
                    action: 'edit',
                    title: values.title,
                    minutes: Number(values.minutes),
                    deliverable: values.deliverable,
                    successMetric: values.successMetric,
                  });
                }}
              >
                <div className="form-grid">
                  <label>
                    Task title
                    <input name="title" defaultValue={task.title} maxLength={160} required />
                  </label>
                  <label>
                    Estimated minutes
                    <input
                      name="minutes"
                      type="number"
                      min={15}
                      max={180}
                      defaultValue={task.minutes}
                      required
                    />
                  </label>
                  <label className="wide">
                    Deliverable
                    <textarea
                      name="deliverable"
                      defaultValue={task.deliverable}
                      maxLength={800}
                      required
                    />
                  </label>
                  <label className="wide">
                    Success measure
                    <textarea
                      name="successMetric"
                      defaultValue={task.successMetric}
                      maxLength={800}
                      required
                    />
                  </label>
                </div>
                <button className="btn primary" disabled={busy}>
                  Save task edits
                </button>
                <p>Edits return the task to Proposed so you can review the changed work item.</p>
              </form>
            )}
            {task.status === 'APPROVED' && !editing && (
              <div className="today-task-form">
                <label>
                  Observed outcome
                  <textarea
                    value={outcome}
                    onChange={(e) => setOutcome(e.target.value)}
                    placeholder="What happened? Record the result, not just that you finished."
                    maxLength={3000}
                  />
                </label>
                <label>
                  Actual minutes (optional)
                  <input
                    value={minutes}
                    onChange={(e) => setMinutes(e.target.value)}
                    type="number"
                    min={0}
                    max={1440}
                  />
                </label>
                <button
                  className="btn primary"
                  disabled={busy || !outcome.trim()}
                  onClick={() =>
                    save({
                      action: 'task',
                      status: 'COMPLETED',
                      outcome,
                      ...(minutes === '' ? {} : { actualMinutes: Number(minutes) }),
                    })
                  }
                >
                  Complete and record outcome
                </button>
              </div>
            )}
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
function CheckIn({
  plan,
  historical,
  mutate,
}: {
  plan: Plan;
  historical: boolean;
  mutate: Mutate;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="editor"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        const values = Object.fromEntries(new FormData(e.currentTarget));
        try {
          await mutate('today', {
            action: 'checkin',
            planId: plan.id,
            version: plan.version,
            ...values,
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Check-in failed.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form-grid">
        <label className="wide">
          What did you do, and what happened?
          <textarea
            name="checkIn"
            defaultValue={plan.checkIn}
            required
            maxLength={4000}
            disabled={historical}
          />
        </label>
        <label className="wide">
          What did you learn?
          <textarea
            name="learning"
            defaultValue={plan.learning}
            required
            maxLength={4000}
            disabled={historical}
          />
        </label>
        <label className="wide">
          Blockers or work to carry forward
          <textarea
            name="blockers"
            defaultValue={plan.blockers}
            maxLength={2000}
            disabled={historical}
          />
        </label>
      </div>
      {!historical && (
        <button className="btn primary" disabled={busy}>
          Save check-in to memory
        </button>
      )}
      {plan.checkedInAt && (
        <p className="success" role="status">
          Check-in saved · {new Date(plan.checkedInAt).toLocaleString()}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function TaskGuide({ guide }: { guide: NonNullable<Task['guide']> }) {
  const [copied, setCopied] = useState<number | null>(null);
  const [copyError, setCopyError] = useState('');
  return (
    <div className="today-guide">
      <h4>Step-by-step instructions</h4>
      <details>
        <summary>What you need before starting</summary>
        <ul>
          {guide.inputs.map((input, i) => (
            <li key={i}>{input}</li>
          ))}
        </ul>
      </details>
      <ol className="today-steps">
        {guide.steps.map((step, i) => (
          <li key={i}>
            <strong>
              {step.title} <span className="badge">{step.minutes} min</span>
            </strong>
            <p>{step.instruction}</p>
          </li>
        ))}
      </ol>
      <h4>Let AI do the heavy lifting</h4>
      <p>
        Copy a prompt into the named tool. Attach any listed inputs; a new chat cannot automatically
        access your private Drive or CMO workspace.
      </p>
      {guide.aiPrompts.map((prompt, i) => (
        <section className="today-ai-prompt" key={i}>
          <strong>{prompt.title}</strong>
          <p>
            <span className="badge">{prompt.tool}</span>
          </p>
          {prompt.requiredInputs.length > 0 && (
            <>
              <small>Attach or provide:</small>
              <ul>
                {prompt.requiredInputs.map((input, j) => (
                  <li key={j}>{input}</li>
                ))}
              </ul>
            </>
          )}
          <button
            className="btn"
            aria-label={`Copy AI prompt: ${prompt.title}`}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(prompt.prompt);
                setCopied(i);
                setCopyError('');
              } catch {
                setCopyError('Clipboard unavailable. Select and copy the prompt below.');
              }
            }}
          >
            {copied === i ? 'Copied' : 'Copy prompt'}
          </button>
          <details>
            <summary>View prompt</summary>
            <pre>{prompt.prompt}</pre>
          </details>
        </section>
      ))}
      {copyError && <p role="status">{copyError}</p>}
      <h4>Definition of done</h4>
      <ul>
        {guide.definitionOfDone.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
      <p className="today-warning">
        <strong>Your approval:</strong> {guide.approvalBoundary}
      </p>
    </div>
  );
}
