'use client';
import { useState } from 'react';
import { MarkdownText } from './markdown-text';
export function TaskDiscussion({
  task,
  mutate,
}: {
  task: {
    id: string;
    title: string;
    discussion: { id: string; role: string; content: string; provider: string; isDemo: boolean }[];
  };
  mutate: (resource: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [learning, setLearning] = useState('');
  const [saved, setSaved] = useState(false);
  async function ask(question: string) {
    if (busy || !question.trim()) return;
    setBusy(true);
    setError('');
    try {
      await mutate('chat', { type: 'CHAT', taskId: task.id, prompt: question, mode: 'auto' });
      setPrompt('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the CMO.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="today-guide task-discussion">
      <button
        className="btn"
        aria-expanded={open}
        aria-controls={`discussion-${task.id}`}
        onClick={() => setOpen(!open)}
      >
        {open ? 'Hide CMO conversation' : 'Discuss with CMO'}
        {!open && task.discussion.length > 0 ? ` (${task.discussion.length} messages)` : ''}
      </button>
      {open && (
        <div id={`discussion-${task.id}`}>
          <h4>Talk through this task</h4>
          <p>
            The CMO has this task, its instructions, your conversation and stored company evidence.
            Ask why it matters, what a step means, or how to make it more practical.
          </p>
          <div className="inline-buttons">
            {[
              'Why is this a priority today?',
              'Walk me through the first step with an example.',
              'What do you need from me to help draft this?',
            ].map((q) => (
              <button key={q} className="btn" disabled={busy} onClick={() => ask(q)}>
                {q}
              </button>
            ))}
          </div>
          <div
            className="task-thread"
            role="log"
            aria-label={`CMO discussion: ${task.title}`}
            aria-live="polite"
          >
            {task.discussion.map((m) => (
              <div key={m.id} className={`message ${m.role}`}>
                <div className="message-meta">
                  {m.role === 'user' ? 'YOU' : 'CMO'}{' '}
                  <span>
                    {m.provider !== 'manual' && m.provider}
                    {m.isDemo ? ' · DEMO CONTEXT' : ''}
                  </span>
                </div>
                <MarkdownText content={m.content} />
              </div>
            ))}
            {busy && <p role="status">Thinking through this with your stored evidence…</p>}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(prompt);
            }}
          >
            <label>
              Ask about this task
              <textarea
                autoFocus
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                maxLength={4000}
                required
                rows={3}
                placeholder="I’m not sure how to do step two. Can you explain it and help me draft it?"
              />
            </label>
            <button className="btn primary" disabled={busy || !prompt.trim()}>
              Ask CMO about this task
            </button>
          </form>
          <p>
            Conversation history is saved. Talking does not change or approve the task. Save
            confirmed clarifications below so future plans can use them.
          </p>
          <details>
            <summary>Save a confirmed clarification to CMO memory</summary>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError('');
                try {
                  await mutate('memories', {
                    title: `Task clarification: ${task.title}`.slice(0, 200),
                    kind: 'LEARNING',
                    content: `Source task ${task.id}: ${task.title}. Owner-confirmed clarification: ${learning}`,
                  });
                  setLearning('');
                  setSaved(true);
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Could not save clarification.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Confirmed clarification
                <textarea
                  value={learning}
                  onChange={(e) => {
                    setLearning(e.target.value);
                    setSaved(false);
                  }}
                  maxLength={4000}
                  required
                  placeholder="Record the specific decision, preference or learning you want the CMO to remember."
                />
              </label>
              <button className="btn" disabled={busy || !learning.trim()}>
                Save clarification to memory
              </button>
              {saved && <p role="status">Clarification saved to CMO memory.</p>}
            </form>
          </details>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
