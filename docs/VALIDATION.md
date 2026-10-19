# V1 validation

Validated in the cloud development machine on 2026-10-16 with Node 24.19.0, npm 11.9.0, PostgreSQL 17, Next.js 16.4.2, and Prisma 7.10.1.

- `npm run setup:local`: clean lockfile installation, Prisma generation, Compose PostgreSQL readiness, migrations and seed succeeded.
- Repeated migration/seed: succeeded, preserving existing records and detecting the applied migration checksum.
- `npm run lint`: passed, no errors or warnings.
- `npm run typecheck`: passed.
- `npm test`: 30 tests passed across growth, validation/CSV/passwords, providers and bounded HTTP bodies.
- `npm run test:integration`: 6 tests passed against a separate PostgreSQL test database.
- `npm run test:e2e`: 9 Playwright browser/API tests passed using Chromium, including mobile layout and real form submissions. Fixtures were isolated from the application database.
- `npm run build`: passed, including production compilation and Next.js TypeScript checks.
- Production `next start`: database health, login with Secure/HttpOnly cookies, authenticated workspace and pace, persisted daily briefing, session revocation and production CSP verified using internal HTTP requests. The production server was stopped after this check.
- Development server restarted with the normal `.env` and local PostgreSQL. A demo daily brief is retained from the smoke check.
- `npm audit --omit=dev`: zero known vulnerabilities. The full development audit has the unresolved lint glob advisory described in README.md.

OpenAI provider behavior is tested with mocked HTTP completions and errors. No live OpenAI credentials were present or required, and no live completion is claimed. Local evidence mode was exercised against PostgreSQL through real browser/API requests.

Docker/Railway configuration and CI are checked in. No Docker application image or remote Railway deployment was executed. Cloud install/start instructions were saved to the configuration draft; saving a draft is separate from publishing a cloud environment snapshot or deploying the application.

The earlier full TradeLink business specification was unavailable. The supplied V1 requirements were implemented, and unknown company information is explicitly labeled as demo assumptions in editable knowledge records.

## Deployment preparation follow-up

After network settings were applied, the Railway-compatible Docker image built successfully and passed an end-to-end local container smoke check with fresh PostgreSQL: migrations, first-boot administrator, health, authentication, workspace access, persisted local-evidence briefing and session revocation. Production bootstrap unit coverage increased the unit total to 34. A repeated first-boot check preserved credentials and data. No checksum or TLS verification was disabled. Remote Railway authentication and deployment are separate and remain pending the account owner's sign-in.

## Railway deployment

Railway's remote production build passed, the application SQL migration and labeled demo seed completed against Railway PostgreSQL, and Next.js started successfully in deployment `b0534d82-a549-40c5-b23b-64bf3af855ec`. The managed service domain is active. Explicit `/api/health` configuration was saved and read back through the Railway API. See `docs/RAILWAY.md` for restart verification, credentials handling, and the distinction between Railway readiness and direct browser verification (the cloud proxy blocks the new public hostname).

## 2026-10-18 — Read-only social reporting

- Lint, TypeScript and production build passed.
- 69 unit/route tests passed, including seven social adapter tests and three social authorization tests.
- 10 PostgreSQL integration tests passed against the disposable local `_test` database, including two social snapshot/CMO evidence tests. The new migration adds only `SocialSnapshot`.
- All 11 browser tests passed in a sequential run, including unconfigured social cards, dark theme and mobile overflow checks. An earlier run alongside build activity had two navigation/theme failures; the clean sequential run passed. Screenshot `test-results/social-dark.png` was visually inspected and is ignored by Git.
- No live X or Instagram sync was claimed: provider credentials were absent. Expected usernames are `tradelink_pb`; real platform authorization and reconciliation remain required.

## 2026-10-18 — Scoped Google Drive references

- Lint, TypeScript and production build passed; 78 unit/route tests passed, including nine Drive adapter/evidence/authorization tests.
- All 12 PostgreSQL integration tests passed on the disposable local `_test` database. The Drive fixtures cover atomic replacement, manual-knowledge preservation, cooldown, source grounding and disabling direct retrieval after failed access.
- All 12 browser tests passed after fixing a mobile breadcrumb overflow exposed by the new Knowledge base check. The dark Knowledge base screenshot was visually inspected; screenshots remain ignored by Git.
- New tables are `DriveSync` and `DriveDocument`. No manual knowledge or existing operating records are rewritten by the migration or importer.
- Railway's Drive credential was absent. No live folder access, imported file count or account authorization is claimed. A dedicated service account, folder Viewer sharing and a verified first sync remain required.

## 2026-10-18 — Full sync and daily Eastern schedule

Lint, TypeScript, production build, 83 unit/route tests, 15 database integration tests and all 13 browser tests passed. New tests cover DST/timezone mapping, private cron authentication, provider failure isolation, durable daily deduplication, orphan recovery, PostgreSQL overlap protection and the manual Sync all UI. Local fixture tests never read live platform credentials or reset the production database. `SyncRun` is added by a new migration; existing data is preserved.
