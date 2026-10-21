# Isolated QA deployment

Use this same CMO branch/commit for **both** the QA web service and the separate bounded runner. Repository root remains `/`.

- Web config: `deploy/railway.web.qa.json`; existing Dockerfile migrates and bootstraps its dedicated CMO database, then starts Next.
- Runner config: `deploy/railway.runner.qa.json`; `deploy/Dockerfile.runner` starts only `npm run qa:agent-hub`, has no HTTP listener and NEVER restarts automatically. Clear inherited healthcheck, cron and start-command overrides. Do not omit npm dev dependencies: `tsx` and `dotenv` are runtime prerequisites for this entrypoint.
- Start web first to apply migrations. Web and runner share `peakbot_cmo_qa` through its dedicated owner, never the Postgres administrator or Hub/Email databases. Runner does not run bootstrap/migrations and needs no admin password.
- Set `CMO_ENVIRONMENT=isolated_qa`, `CMO_HUB_QA_ENABLED=false` until activation, the exact QA Hub HTTPS `CMO_HUB_ORIGIN`, scoped source `CMO_HUB_AGENT_TOKEN`, a distinguishable `CMO_HUB_QA_RUN_ID`, interval 5 seconds and maximum 120 ticks.
- Web needs QA `APP_URL`, `BOOTSTRAP_MODE=empty`, `ADMIN_EMAIL` and a unique 16+ character `ADMIN_PASSWORD`. No production integrations, model, CRM or sending credentials belong in either QA service.
- Runner startup refuses common provider bindings, databases without `_qa` suffix and the known production Hub, including its trailing-slash form. Rejected configuration cannot send even a shutdown heartbeat.
- After demonstration, pause QA requests, set the enable flag false and stop the bounded runner. Keep completed runs and audit.

The complete four-service variables, private three-database provisioning, deployment gates and separate V2 plan are in the Hub PR #16 branch under [`deploy/ISOLATED_QA_ACTIVATION.md`](https://github.com/ThomasPeakBot/peakbot-agent-os/blob/codex/autonomous-ab-hub/deploy/ISOLATED_QA_ACTIVATION.md). This is readiness documentation; no hosted success is claimed.

For this workspace's trusted egress proxy, local Docker builds accept optional `--secret id=build_ca,src=/etc/ssl/certs/ca-certificates.crt`. The CA is not copied into the runner image; TLS and npm integrity checks remain enabled. Normal Railway builds need no secret.
