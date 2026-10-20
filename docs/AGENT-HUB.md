# TradeLink CMO → PeakBot Agent Hub (dry-run only)

This CMO integration is deliberately limited to a synthetic, 24-record,
non-sending experiment demonstration. The CMO remains read-only except for
an explicitly clicked and admin-authorized proposal to Agent Hub.

- Endpoint: GET/POST /api/agent-hub. ADMIN session required on both methods.
- POST is one allowlisted action: submit_synthetic_qa. It creates or reuses a
  Hub proposal with 24 fake, .example creators, same B2B cohort, user-first B
  vs affiliate-first A, 40% first-month customer discount. Dry-run only.
- Only the server talks to Hub. Agent token is never in a browser response,
  stored experiment, audit entry or URL.
- Credentials are in Railway: CMO_HUB_ORIGIN must be exactly
  https://web-production-44a4c.up.railway.app and CMO_HUB_AGENT_TOKEN must be
  a unique CMO-only secret. Not set by default: UI says unavailable.
- Caller cannot override target, capability, price, cadence, lead list or URL.
- GET reads only CMO's own Hub task states and receipts. Hub approvals happen
  separately at the signed-in Hub dashboard. No CMO-local approval implies Hub
  approval or triggers Email Creator execution.
- Hub response is bounded to 64 KiB, HTTPS origin is pinned, redirects aren't
  followed, and network calls time out after 8 seconds.
- Experiment start date is the first weekday at least 7 days after submission,
  with an explicitly labeled **business** cadence for synthetic QA. Live
  experiment day mode is NOT chosen or authorized by this demonstration.
- Idempotency key includes the explicitly computed synthetic start date. Repeated
  submissions with identical terms on the same day reuse the same task, while
  a click on another day creates a separate, human-approval-required synthetic
  scenario. No submission is automatic; each click requests independent approval.
  Changing any other terms must be deliberately versioned to avoid a 409.
- Do not enable live email sending, install real lead identity access or
  connect verified signup/activation/affiliate events in this phase.

Next prerequisites: reviewed Email Creator PR #66 QA, approved copy and CTA,
verified 40% discount/affiliate commission terms, calendar/business-day choice,
minimum sample & stopping rule, CMO/Email Creator signed handoff end-to-end.
