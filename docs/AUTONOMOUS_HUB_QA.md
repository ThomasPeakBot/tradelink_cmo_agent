# Autonomous Hub experiment preparation

This isolated QA process submits one fixed synthetic preparation request and receives Email Creator's verified result. It does not invoke a model, send mail, publish, trade, spend, or read production leads. The normal application remains disabled by default.

## Run

Use Node 24/npm 11 and a dedicated PostgreSQL database. Install the checked-in lockfile with `npm ci`, then run `DATABASE_URL=... npm run db:migrate`. This applies the additive `202610200001_autonomous_hub_qa` migration using the existing transactional SQL migration runner. No native Prisma engine is needed for this runner or the standalone QA process.

Configure these server-side variables through environment settings, never browser variables:

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Dedicated CMO QA database; never a production database |
| `CMO_ENVIRONMENT` | Exactly `isolated_qa` |
| `CMO_HUB_QA_ENABLED` | Exactly `true`; otherwise no new proposals |
| `CMO_HUB_QA_RUN_ID` | Stable identifier for this approved QA run, 1–64 letters/digits/underscores/hyphens; first character alphanumeric |
| `CMO_HUB_ORIGIN` | Authorized isolated Hub origin; HTTP loopback or HTTPS Railway subdomain only in isolated QA |
| `CMO_HUB_AGENT_TOKEN` | Scoped `tradelink-cmo` agent credential supplied securely |
| `CMO_HUB_QA_INTERVAL_SECONDS` | Poll interval, clamped to 1–60 seconds; default 5 |
| `CMO_HUB_QA_MAX_TICKS` | Bounded lifetime, clamped to 1–600 ticks; default 120 |

Start `npm run qa:agent-hub`. This independent process works without anyone opening a dashboard or approving the synthetic request during execution. Hub must separately enable its exact synthetic QA policy in an isolated environment. Other requests still require normal human approval.

The immutable fixture is the existing 24 `.example` creator records with start date `2026-10-27`, business-day cadence **for QA only**, and version `v1`. Its request fingerprint is `69bdc0f90592a80d720cef943d722ca0b57333054e27a88fb6f87f6edd0b4414`. The three existing sender identifiers are planning allocations, never recipients or permission to send. A different run ID changes only the idempotency key. Reusing the same ID cannot create a second task after a process restart.

## State and verification

`cmo_hub_qa_runs` records trigger identity, fingerprint, Hub task/workflow, last/next attempt, result, failures, and delivery confirmation. `cmo_hub_qa_events` is append-only execution history. A PostgreSQL session advisory lock prevents competing CMO processes from starting the same run concurrently. Hub's immutable idempotency key covers a crash after remote submission but before local persistence.

The CMO polls source-scoped Hub submissions, verifies task ID/hash, Email Creator identity, capability, experiment/version, synthetic audience counts, validation, durable artifact hash, and the explicit no-send approval flags. It saves the result before calling the source-only Hub delivery-acknowledgment endpoint. A failed acknowledgment is retried after restart without resubmission or losing the result. HTTP 200 alone never means preparation succeeded.

Transient errors retry with exponential backoff up to six consecutive failures. Invalid identity/evidence or terminal blocked/cancelled/rejected Hub state requires intervention. The process exits nonzero for failed/blocked results or exhausted polling bounds. It reports authenticated heartbeats while running; it reports paused on graceful exit instead of pretending to remain online.

The authenticated administrator Experiments panel shows the stored run and result, polling every five seconds. Opening the panel initiates no workflow. `GET /api/agent-hub/autonomous` returns bounded stored status. Its POST accepts only `{ "paused": true }` or `{ "paused": false }`, uses existing session/origin checks, and cannot choose a URL, agent, payload, or run ID. It records the pause actor in the run audit history.

## Stop and resume

Pause CMO QA requests in the panel or set `CMO_HUB_QA_ENABLED=false` before restarting the process. SIGTERM/SIGINT stops the runner gracefully. Hub emergency pause separately blocks new requests and worker claims. Existing results and audit history remain intact. Resume only after resolving the reported cause; reuse the same run ID to continue safely. A blocked run needs operator review, not a new random run ID to conceal the error.

The full web application additionally requires `npm run db:generate` and its normal build/auth setup. A restricted network must allow verified downloads from `binaries.prisma.sh`; do not disable TLS or Prisma artifact checksums. Standalone orchestration verification is distinct from a successful web build or Railway deployment.
