# Affiliate email communications

The owner explicitly authorized automatic affiliate communications from **experience@peakbot.com**, a Google Workspace mailbox. This is a scoped exception to V1's manual external action boundary: only approved template versions and trigger rules may send when this automation is explicitly enabled. Other channels remain read-only/manual. Startup initializes six draft templates and a paused configuration without overwriting edits, approvals or existing configuration. It also saves the owner's confirmed sender/workflow preferences to institutional memory, without inventing approved dates, commission terms or recipients.

## Dashboard

Open **Affiliate communications**. Edit subject/body, preview with clearly labeled sample values, save a revision, then explicitly approve the saved version for automatic use. Editing withdraws approval and cancels pending unsent deliveries for the template. Already sent emails remain unchanged. Templates and rendered delivery records are in PostgreSQL, not Drive. All admin actions require the existing authenticated ADMIN session and same-origin POST protection. The CMO receives current template content, approval versions, automation status and aggregate source freshness as evidence, without recipient emails or credentials. Dashboard responses never include OAuth client secrets, refresh tokens, encryption keys or OAuth verifier state.

## Google setup

Set these variables on Railway → tradelink-cmo → web → production:

- `GOOGLE_EMAIL_CLIENT_ID`: dedicated Web application OAuth client.
- `GOOGLE_EMAIL_CLIENT_SECRET`: that client's secret.
- `AFFILIATE_EMAIL_ENCRYPTION_KEY`: exactly 32 random bytes in canonical base64. The coding session generates this securely when absent; preserve the existing value, including sealed bindings. Never replace it casually: stored refresh tokens and unsubscribe signatures depend on it.
- Existing `APP_URL` remains `https://cmo.usetradelink.com`.

Enable Gmail API in the OAuth client's Google Cloud project. Exact redirect URI:

`https://cmo.usetradelink.com/api/affiliate-email/google/callback`

Request `openid`, `email`, and `https://www.googleapis.com/auth/gmail.send`. No Gmail inbox read, modify, contact access, Gmail password, app password, domain-wide delegation or changes to the separate Drive service account are required. Use an Internal consent app only if appropriate for the actual Workspace organization. An External app must have the appropriate consent/publishing/verification status for durable use; Google External Testing refresh tokens commonly expire after seven days for these scopes. Do not represent an external test app as production-ready.

After configuration is deployed, click **Connect Google mailbox** and authorize **experience@peakbot.com itself**. OAuth checks verified email identity, session-bound one-time state (10-minute expiry), PKCE, granted send scope and an offline refresh token. Aliases are deliberately unsupported. Refresh tokens and PKCE verifiers are AES-256-GCM encrypted in PostgreSQL. Connection/reconnection always pauses automation. Local disconnect deletes credentials and cancels queued mail; the owner may separately revoke the Google grant in Google account settings.

## Referral source

The separate private affiliate application has no confirmed API contract or credential yet. **No live affiliate data integration is claimed.** `AffiliateSnapshotProvider` defines the future adapter boundary. A complete verified CSV import is supported now:

```csv
code,email,name,affiliate_url,qualifying_referrals,rank,gap,email_permission
DEMO-CODE,alex@example.com,Alex,https://example.com/DEMO-referral,9,2,2,yes
```

This example is demo only and is never seeded as a recipient. Upload only permitted affiliate contact information, not customer data. Counts/ranks must match the official TradeLink competition rules; active paying referrals, gross signups, lifetime referrals and competition-qualified counts are not interchangeable. Permission must explicitly be `yes` for every imported row. Rank/gap may be blank, which holds templates requiring missing fields. CSV max 2,000 affiliates / 400 KB. Duplicate identities, email changes, stale/future/non-increasing snapshot times and invalid URLs are rejected atomically. Import marks missing contacts ineligible and preserves unsubscribe state; it cannot resubscribe recipients. The first snapshot establishes the historical milestone baseline.

## Sending rules and delivery safety

The settings require official rules URL, verified start/end instants (UTC input), a real sender footer/mailing address and explicit rule confirmation. These settings start blank; the app does not guess prize distribution, eligibility, commission rate or closing date. Saving settings pauses automation and cancels unsent queued drafts. Enabling also requires verified mailbox, configured OAuth/encryption, at least one approved template and fresh permitted contacts inside the competition window.

The existing 4 a.m. America/New_York morning sync and manual **Sync all** run enabled affiliate automation after reporting syncs. **Run approved automation now** does the same without a reporting sync. No additional cron is created. Weekly updates: Monday Eastern. Milestones: verified crossings of 10/25/50/100 above the initial baseline, highest eligible first. Rank: verified gap 1–3, below first place, once per Eastern Monday-based week. Missing fields hold a template. Re-engagement based on inactivity and final-day campaigns are not implemented; net active counts cannot establish absence of new referrals.

A dedicated PostgreSQL session advisory lock prevents overlapping runners. Each send claim rechecks enablement, current approval version, contact eligibility, unsubscribe status, source freshness (36 hours), competition window and trigger. Claims share a transaction lock with config edits/imports/unsubscribe. Render again from current data at claim; old queued facts never override new facts. At most one attempted delivery per affiliate per 24 hours, two per rolling seven days, 25 attempts per run and a 120-second soft runner deadline. Failed attempts do not auto-retry; failed, uncertain and in-flight attempts consume the cap. Events have unique keys. Previously cancelled unattempted drafts can be re-queued under a newly approved version; failed, sent or uncertain events cannot.

Before calling Gmail, mark the delivery SENDING durably. Timeout/network/5xx/unknown-success responses become UNKNOWN; never automatically retry. Definite rejections become FAILED, also no auto-retry. Interrupted SENDING records older than ten minutes become UNKNOWN on a later enabled run. Check Gmail Sent before any manual follow-up. SENT means Gmail accepted a message, not inbox placement or opens. OAuth failures before sending are FAILED. If the process dies after send but before DB confirmation, the record remains conservative SENDING/UNKNOWN, not retried. A pause cannot recall a send already claimed/in flight.

Every real message adds the configured footer and a signed unsubscribe URL, with RFC 8058 List-Unsubscribe headers. GET shows a confirmation form and makes no mutation (link scanners cannot unsubscribe); signed POST suppresses the contact and cancels queued messages without requiring a CMO login. Signatures use the encryption key with a separate HMAC namespace. No open-tracking pixel or fake engagement analytics.

## Verification

Unit tests cover authenticated encryption/tamper rejection, signed opt-out tokens, placeholder/header safety, CSV permission/identity validation and definite-versus-uncertain Gmail errors. PostgreSQL tests cover draft/approval versioning, fresh crossings, duplicate prevention, stale holds, pause/suppression retention and OAuth identity/state/replay. Browser tests exercise editing, preview, approval invalidation, prerequisites, CSRF rejection, persistence and mobile layout. No tests contact real affiliates or send live Gmail.
