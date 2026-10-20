'use client';
import { useCallback, useEffect, useState } from 'react';
import type { affiliateEmailState } from '@/lib/affiliate-email/admin';
import { fields, render, sampleValues } from '@/lib/affiliate-email/templates';
type Json<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Json<U>[]
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T;
type State = Json<Awaited<ReturnType<typeof affiliateEmailState>>>;
export function AffiliateEmail() {
  const [data, setData] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch('/api/affiliate-email', { cache: 'no-store' });
    const value = await r.json();
    if (!r.ok) throw Error(value.error || 'Could not load affiliate email settings.');
    setData(value);
  }, []);
  useEffect(() => {
    let active = true;
    fetch('/api/affiliate-email', { cache: 'no-store' })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok) throw Error(value.error || 'Could not load affiliate email settings.');
        if (active) setData(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await fetch('/api/affiliate-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const value = await r.json();
      if (!r.ok) throw Error(value.error || 'Operation failed.');
      if (value.authorizationUrl) {
        window.location.assign(value.authorizationUrl);
        return;
      }
      await load();
      setNotice(value.message || 'Saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed.');
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <section className="panel record-body">
        <p>{error || 'Loading affiliate communications…'}</p>
      </section>
    );
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3>Affiliate communications</h3>
          <span className="badge">
            {data.settings?.enabled ? 'AUTOMATIC SENDING ENABLED' : 'PAUSED — NO AUTOMATIC SENDS'}
          </span>
        </div>
        <div className="record-body">
          <p>
            Edit, preview and approve the templates here. Only approved versions can send
            automatically, and only after you enable automation. Editing a template withdraws its
            approval.
          </p>
          {typeof window !== 'undefined' &&
            new URLSearchParams(window.location.search).get('affiliateEmail') === 'failed' && (
              <p className="error" role="alert">
                Google connection did not complete. Use experience@peakbot.com itself, grant sending
                access, and try again. Automation remains paused.
              </p>
            )}
          {typeof window !== 'undefined' &&
            new URLSearchParams(window.location.search).get('affiliateEmail') === 'connected' && (
              <p role="status">
                Google mailbox connected. Automation remains paused until you enable it.
              </p>
            )}
          <p>
            <strong>Sender:</strong> {data.sender} ·{' '}
            {data.account ? 'Google connected' : 'Google not connected'}
          </p>
          {!data.settings ? (
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => act({ action: 'initialize' })}
            >
              Initialize affiliate email workspace
            </button>
          ) : (
            <>
              <div className="inline-buttons">
                <button
                  className="btn"
                  disabled={busy || !data.oauthConfigured}
                  onClick={() => act({ action: 'connect' })}
                >
                  {data.account ? 'Reconnect Google mailbox' : 'Connect Google mailbox'}
                </button>
                {data.account && (
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => act({ action: 'disconnect' })}
                  >
                    Disconnect mailbox and pause
                  </button>
                )}
                <button className="btn" disabled={busy} onClick={() => act({ action: 'run' })}>
                  Run approved automation now
                </button>
              </div>
              {!data.oauthConfigured && (
                <p className="today-warning">
                  Google OAuth client and email encryption key are not configured yet. Templates can
                  be prepared now. Google redirect URI:{' '}
                  <code>{data.redirectUri || 'Set APP_URL first'}</code>
                </p>
              )}
              <p>
                {data.contactCount} eligible imported affiliates · {data.suppressed} unsubscribed ·
                Latest snapshot:{' '}
                {data.lastSnapshot ? new Date(data.lastSnapshot).toLocaleString() : 'none'}
              </p>
              <p>
                Sends daily at 9 a.m. Eastern, following daylight saving time. Reporting sync stays
                at 4 a.m. Data older than 36 hours holds sending. Maximum one attempted delivery per
                affiliate per 24 hours and two per seven days. At most 25 queued emails are
                attempted per run. A pause stops new send claims; an already-started send may
                finish.
              </p>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
        </div>
      </section>
      {data.settings && (
        <>
          <section className="panel">
            <div className="panel-head">
              <h3>Competition rules and automation</h3>
            </div>
            <form
              key={data.settings.updatedAt}
              className="editor"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                act({
                  action: 'settings',
                  rulesUrl: f.get('rulesUrl'),
                  startsAt: new Date(String(f.get('startsAt')) + 'Z').toISOString(),
                  endsAt: new Date(String(f.get('endsAt')) + 'Z').toISOString(),
                  footer: f.get('footer'),
                  rulesConfirmed: f.get('rulesConfirmed') === 'on',
                });
              }}
            >
              <div className="form-grid">
                <label>
                  Official rules URL
                  <input
                    name="rulesUrl"
                    type="url"
                    required
                    defaultValue={data.settings.rulesUrl}
                  />
                </label>
                <label>
                  Competition starts (UTC)
                  <input
                    name="startsAt"
                    type="datetime-local"
                    required
                    defaultValue={data.settings.startsAt?.slice(0, 16)}
                  />
                </label>
                <label>
                  Automatic email cutoff (UTC)
                  <input
                    name="endsAt"
                    type="datetime-local"
                    required
                    defaultValue={data.settings.endsAt?.slice(0, 16)}
                  />
                </label>
                <label className="wide">
                  Sender footer and mailing address
                  <textarea
                    name="footer"
                    required
                    minLength={10}
                    maxLength={2000}
                    defaultValue={data.settings.footer}
                  />
                </label>
              </div>
              <label>
                <input
                  name="rulesConfirmed"
                  type="checkbox"
                  defaultChecked={data.settings.rulesConfirmed}
                />{' '}
                I verified the competition dates, referral definition, rank scoring, recipient email
                permissions and official rules.
              </label>
              <button className="btn" disabled={busy}>
                Save rules and pause automation
              </button>
            </form>
            <div className="record-body">
              <p>
                The cutoff pauses emails for review; it does not declare the competition over. The
                competition ends only after six weeks and 500 subscribers. Weekly updates run
                Mondays. Milestones trigger only on new verified crossings of 10, 25, 50 and 100
                after the initial baseline; the highest eligible milestone is prepared first. Rank
                alerts require a verified gap of 1–3 qualifying referrals.
              </p>
              {data.settings.enabled ? (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => act({ action: 'toggle', enabled: false })}
                >
                  Pause all affiliate emails
                </button>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    act({ action: 'toggle', enabled: true, confirmAutomaticSending: true });
                  }}
                >
                  <label>
                    <input type="checkbox" required /> I authorize automatic sends from
                    experience@peakbot.com using the approved template versions and rules.
                  </label>
                  <button className="btn primary" disabled={busy}>
                    Enable automatic affiliate emails
                  </button>
                </form>
              )}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h3>Verified affiliate data</h3>
            </div>
            <div className="record-body">
              <p>
                The API uses stable affiliate IDs and TradeLink counting rule v1. Counts are
                subscriptions, including fully discounted subscriptions and paused payment
                collection under that rule. The first sync establishes a baseline; historical
                milestones are not emailed.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  act({ action: 'sync-api', confirmProgramEmailPermission: true });
                }}
              >
                <p>
                  {data.reporting.configured
                    ? 'Reporting key configured.'
                    : 'Reporting key not configured on web.'}
                  {data.reporting.blocked ? ' Last sync failed; sending held.' : ''}
                </p>
                <label>
                  <input type="checkbox" required /> I confirm TradeLink affiliates may receive
                  program emails under our agreement. Existing unsubscribes remain effective.
                </label>
                <button className="btn primary" disabled={busy || !data.reporting.configured}>
                  Sync affiliate API
                </button>
              </form>
              <p>
                Alternatively, use a verified CSV. Import a complete, owner-verified snapshot here.
                Missing affiliates are held, and existing unsubscribe choices are preserved. The
                first import establishes a milestone baseline; historical milestones are not
                emailed.
              </p>
              <p>
                CSV columns:{' '}
                <code>
                  code,email,name,affiliate_url,qualifying_referrals,rank,gap,email_permission
                </code>
                . Set email_permission to yes only for affiliates permitted to receive these
                communications. Rank and gap can be blank; other fields are required. Never upload
                customer records.
              </p>
              <form
                className="editor"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  act({
                    action: 'import',
                    csv: f.get('csv'),
                    capturedAt: new Date(String(f.get('capturedAt')) + 'Z').toISOString(),
                    verified: true,
                  });
                }}
              >
                <label>
                  Snapshot captured at (UTC)
                  <input name="capturedAt" type="datetime-local" required />
                </label>
                <label>
                  Affiliate CSV
                  <textarea name="csv" required maxLength={400000} rows={6} />
                </label>
                <label>
                  <input type="checkbox" required /> This is a complete verified snapshot, counts
                  match the official competition rules, and every included affiliate has email
                  permission.
                </label>
                <button className="btn" disabled={busy}>
                  Import verified affiliate snapshot
                </button>
              </form>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h3>Email templates</h3>
            </div>
            <div className="record-body">
              <p>
                Available personalization fields:{' '}
                {fields.map((f) => (
                  <code key={f}>{`{{${f}}} `}</code>
                ))}
              </p>
              <p>
                Preview uses labeled sample values. The sender footer and unsubscribe link are added
                automatically to real messages.
              </p>
            </div>
          </section>
          {data.templates.map((template) => (
            <TemplateEditor
              key={`${template.id}:${template.version}:${template.approvedVersion}`}
              template={template}
              busy={busy}
              act={act}
            />
          ))}
          <section className="panel">
            <div className="panel-head">
              <h3>Recent email activity</h3>
            </div>
            <div className="record-body">
              <p>
                Delivery means Gmail accepted the email, not proof it reached the inbox or was
                opened. Failed and uncertain deliveries are never automatically retried. Check Gmail
                Sent before manual follow-up.
              </p>
              {!data.deliveries.length ? (
                <p>No emails queued or sent.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Recipient</th>
                        <th>Subject</th>
                        <th>Status</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.deliveries.map((d) => (
                        <tr key={d.id}>
                          <td>{d.recipient}</td>
                          <td>{d.subject}</td>
                          <td>{d.status}</td>
                          <td>
                            {d.error || (d.sentAt ? new Date(d.sentAt).toLocaleString() : '')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
function TemplateEditor({
  template,
  busy,
  act,
}: {
  template: State['templates'][number];
  busy: boolean;
  act: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [subject, setSubject] = useState(template.subject),
    [body, setBody] = useState(template.body);
  const [confirm, setConfirm] = useState(false);
  const changed = subject !== template.subject || body !== template.body;
  let preview;
  try {
    preview = { subject: render(subject, sampleValues), body: render(body, sampleValues) };
  } catch (e) {
    preview = {
      subject: 'Preview unavailable',
      body: e instanceof Error ? e.message : 'Invalid placeholder',
    };
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>{template.name}</h3>
        <span className="badge">
          VERSION {template.version} ·{' '}
          {template.approvedVersion === template.version ? 'APPROVED' : 'DRAFT — NOT APPROVED'}
        </span>
      </div>
      <div className="record-body">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act({ action: 'edit', id: template.id, version: template.version, subject, body });
          }}
          className="editor"
        >
          <label>
            Email subject
            <input
              aria-label="Email subject"
              disabled={busy}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={180}
              required
            />
          </label>
          <label>
            Email body
            <textarea
              aria-label="Email body"
              disabled={busy}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              maxLength={10000}
              required
            />
          </label>
          <button className="btn" disabled={busy || !changed}>
            Save template revision
          </button>
        </form>
        <details>
          <summary>Preview with DEMO values</summary>
          <h4>{preview.subject}</h4>
          <pre className="affiliate-preview">{preview.body}</pre>
        </details>
        {template.approvedVersion === template.version ? (
          <>
            <p>
              Approved by {template.approvedBy}. Changing this template requires approval of the new
              version.
            </p>
            <button
              className="btn"
              disabled={busy}
              onClick={() => act({ action: 'unapprove', id: template.id })}
            >
              Withdraw template approval
            </button>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act({
                action: 'approve',
                id: template.id,
                version: template.version,
                confirmAutomaticSending: true,
              });
            }}
          >
            <label>
              <input
                type="checkbox"
                checked={confirm}
                onChange={(e) => setConfirm(e.target.checked)}
                required
              />{' '}
              I approve this exact saved version for automatic sending under its trigger rule when
              automation is enabled.
            </label>
            <button className="btn primary" disabled={busy || changed || !confirm}>
              Approve saved template for automation
            </button>
            {changed && <p>Save your edits before approving.</p>}
          </form>
        )}
      </div>
    </section>
  );
}
