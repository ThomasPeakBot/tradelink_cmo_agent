# TradeLink CMO Operating System

An internal, single-company growth operating system built with Next.js 16, TypeScript, Tailwind 4, PostgreSQL 17 and Prisma 7. It runs without live API credentials. It is not an autonomous marketing agent: V1 cannot send, publish, launch campaigns, or spend money.

## Run locally

Prerequisites: Node.js 24, npm 11, Docker with Compose (or an existing PostgreSQL 17 database).

```sh
npm run setup:local
npm run dev
```

The setup script preserves an existing `.env`, installs the lockfile, starts local PostgreSQL, applies migrations, and seeds labeled demo data. With an existing database, set `DATABASE_URL` in `.env` and run `START_LOCAL_POSTGRES=0 npm run setup:local`. The compose password is for loopback-only local development.

Development demo login:

- Email: `admin@tradelink.local`
- Password: `TradeLink-Demo-2026!`

These are public development credentials. Production seed refuses this password. Set a unique `ADMIN_EMAIL` and `ADMIN_PASSWORD` (16+ characters) before production seeding. No public signup exists. To rotate an existing password, set those environment variables securely and run `npm run admin:password`; this also revokes existing sessions. Seed preserves existing users and does not reset passwords.

The local environment uses `APP_URL=http://localhost:3000`. Set `APP_URL` to the exact public HTTPS origin behind a production proxy; write requests use it for origin validation. Production session cookies require HTTPS. Session tokens are random, hashed in PostgreSQL, HttpOnly, SameSite=Lax, and expire after 12 hours. Passwords use salted scrypt. Login attempts are account-throttled. Put an identity-aware gateway / SSO and network-level rate limiting in front of this internal application for a wider production rollout.

## V1 workflows

- **Executive overview:** current subscribers, pace, MRR, goal countdown, 12-month trajectory, experiment priorities, channel snapshot.
- **Daily metrics:** add/update dated totals, new subscribers, churn, visitors, MRR and spend. Editing a demo observation marks it manual. UTC dates; USD currency.
- **Channels:** manual daily channel observations, last-30-calendar-day aggregates, acquisition cost and visitor conversion. Attribution may overlap; reconcile with source systems.
- **Experiments:** hypothesis, owner, channel, time-bound success measure, ICE scoring (impact × confidence × ease, each 1–10), status and results. Completion retains a learning in institutional memory.
- **Knowledge base:** editable company, audience, product, positioning, constraints and other facts. Demo assumptions are explicitly identified, not presented as verified company facts.
- **Institutional memory:** persistent decisions, learnings, constraints and observations. Approval reviews retain a decision in memory.
- **CMO intelligence:** stored company facts, metrics, channel results, experiments, memory, reviewed approvals and recent personal chat history are passed into every generation. Answers and conversations persist in PostgreSQL.
- **Briefs & plans:** daily Growth Brief, weekly CMO Review, monthly growth plan, retained as point-in-time reports.
- **Forecasts:** downside/base/upside run rates with explicit assumptions and monthly target milestones.
- **Alerts:** pace, forecast risk, stale metrics, and acquisition/churn signals, refreshed after metric/import/goal updates. Alerts are retained historical signals with acknowledgement; no background scheduler or external notifications in V1.
- **Approvals:** proposed scope, rationale and action type; explicit approve/reject with review note. Reviewed requests cannot be changed through the app. **Approval never executes an action.** One trusted internal administrator may both request and review; dual-control review is a future policy extension.
- **Audit:** authenticated changes, imports, generations, approval reviews, login/logout and password rotation. App endpoints provide no audit mutation operation. Database administrators remain able to modify database records.
- **CSV import:** exact required columns, validated rows, atomic write, duplicate-date protection and explicit overwrite. 1,000 rows / 500 KB limit. Download a template in the app.

Required CSV columns:

```csv
date,subscribers,newSubs,churned,visitors,mrr,spend
2026-01-01,50,3,1,250,950,45
```

## Intelligence modes and provider boundaries

With no `OPENAI_API_KEY`, the **local evidence** provider produces deterministic, clearly labeled evidence responses and operating briefs. It computes pace and forecasts and ranks active experiments, but is not a language model and cannot answer arbitrary questions with novel reasoning. This makes the full workflow usable without credentials.

With `OPENAI_API_KEY` (or `TRADELINK_OPENAI_API_KEY` in cloud settings that reserve `OPENAI_*` names) configured, the OpenAI adapter calls the Chat Completions API using `OPENAI_MODEL` (default `gpt-4.1-mini`). Each request includes stored company evidence and the authenticated user’s recent conversation. You may force local mode in chat or briefing generation. Live errors are surfaced; the app does not silently substitute a fabricated successful AI response. No tools or external executors are registered. Company context is sent to OpenAI only when that provider is used.

`IntelligenceProvider` separates reasoning from the application. `IntegrationProvider<T>` / `ManualIntegrationProvider<T>` define the read-only acquisition interface for future billing, analytics, CRM, email and ads adapters. No live adapter is claimed to be implemented. Keep write-capable integration execution outside V1.

## Growth math

The default goal is **50 to 5,000 over 365 days**, with demo dates beginning 90 days before the first seed. The dates and counts are editable. The target is geometric:

`target(t) = start × (goal / start) ^ clamp(elapsed days / total days, 0, 1)`

Pace compares the latest nonfuture stored subscriber count with today's target. The observation date and age are shown. Missing data means “NO DATA,” not a fabricated baseline. The average net additions use up to 30 calendar days ending at the latest observation and exclude missing dates. Scenario forecasts project `current + average net additions × remaining days × multiplier` (downside 0.65, base 1.0, upside 1.35), floored at zero. They are transparent linear scenarios, distinct from the geometric target curve, and do not model seasonality, causality or guaranteed results. Sparse/stale observations limit confidence.

## Database and migrations

Schema: `prisma/schema.prisma`. The checked-in SQL migration is generated by Prisma. Runtime queries use Prisma's JavaScript engine with `@prisma/adapter-pg`, avoiding native engine download dependencies.

`npm run db:migrate` runs `scripts/migrate.ts`: it applies checked-in Prisma SQL under a PostgreSQL advisory lock, checks SHA-256 against `_prisma_migrations`, and commits each migration and its ledger record in one transaction. Repeated runs are safe. This V1 runner supports transactional SQL migrations only (not `CREATE INDEX CONCURRENTLY` or manual nontransactional steps). Changed or unfinished migrations stop for human review. It does not attempt automatic drift reconciliation.

The app uses Prisma 7’s JavaScript client engine. The onboarding network blocks native Prisma binary downloads, so the tested SQL runner keeps migration application independent of native CLI engines; use **`npm run db:migrate`**. No checksum or TLS verification is disabled.

To create a future migration, edit the schema, use Prisma's `migrate diff --from-migrations` with a disposable shadow database (or a reviewed schema-to-schema diff), inspect the generated SQL, and test it against a disposable database before committing. Never rewrite applied migration SQL. `npm run db:generate` refreshes the client. Repeated demo seeds use stable IDs and preserve manual edits; they never erase your data. The seed contains sample attribution, experiments, company assumptions and decisions, all with demo flags.

## Validation

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Database/browser tests require a **separate** database ending in `_test`:

```sh
docker compose exec postgres createdb -U tradelink tradelink_test
export TEST_DATABASE_URL=postgresql://tradelink:local-development-only@localhost:5432/tradelink_test
npm run test:prepare
npm run test:integration
npx playwright install --with-deps chromium
npm run test:e2e
```

If Chromium is preinstalled, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`. The browser suite starts its own app on port 3001, with a separate `.next-e2e` output and the test database, and stops it afterwards. `test:prepare` resets application tables in the designated disposable test database before reseeding; do not store valuable data there. Never point tests at production. Unit tests cover growth math, forecasts, scoring, validation, CSV, password hashing and provider boundaries. Integration tests exercise PostgreSQL persistence and context grounding. Browser/API tests cover authentication, navigation/mobile layout, data mutations, CSV atomicity, approval boundaries, CMO context and all report cadences. CI performs the same checks without deploying.

## Railway deployment

The application is deployed at https://web-production-7ff96.up.railway.app. See [Railway deployment details](docs/RAILWAY.md) for the login, secure password location, resource identifiers and verification evidence.

The following describes the provisioning and startup configuration used for this deployment. OpenAI is optional.

1. Provision a PostgreSQL service and bind its `DATABASE_URL` to the app. Use a fresh database for real operation.
2. Set `APP_URL` to the exact HTTPS application origin, `ADMIN_EMAIL` to your chosen login, and `ADMIN_PASSWORD` to a unique 16–256 character password in Railway service variables. Never reuse the public demo password. Optionally configure OpenAI securely.
3. Build the Dockerfile; `npm run start:production` applies migrations, bootstraps a fresh workspace, and starts Next.js, honoring Railway's `PORT`.
4. First boot defaults to an empty production workspace with the 50 → 5,000 goal and administrator. Set `BOOTSTRAP_MODE=demo` explicitly before first boot to populate labeled demo observations instead. Existing company records and administrator credentials are preserved on restart; use `npm run admin:password` for an intentional credential rotation.
5. Verify `/api/health`, authenticated dashboard and a representative briefing. Add database backups, access restrictions, monitoring and SSO before broader use.

Secrets belong in environment settings, never committed files. `OPENAI_API_KEY` is optional. Future recommended connections: billing/subscriber source of truth (e.g. Stripe), product/web analytics (e.g. PostHog or GA4), CRM, and approved channel reporting. Build read-only adapters and reconcile attribution first.

## Scope and assumptions

This implementation uses the requirements provided with this task. A separate earlier “full TradeLink CMO specification” was not present in the conversation or repository. No product, market, pricing or positioning claim has been invented as verified knowledge. Replace the explicitly labeled demo knowledge with approved TradeLink material.

This is a single-company internal workspace, not multi-tenant SaaS. There is no autonomous execution, external notification service, SSO, password-reset email flow, or live marketing integration in V1. Chat history is private to each authenticated user; company operating records and reports are shared among internal users. Keep routine knowledge inputs concise; the OpenAI request includes the stored workspace context and is intended for a small internal V1 dataset.

## Dependency review

The production dependency audit reports zero known vulnerabilities at implementation time. The full development audit retains an upstream `braces` / `micromatch` / `fast-glob` stack-exhaustion advisory through Next.js lint tooling, with no compatible upstream fix available. These packages process repository glob patterns during linting; they are not part of request handling. Vitest and runtime dependencies were updated to patched releases. Recheck advisories as dependencies evolve.
