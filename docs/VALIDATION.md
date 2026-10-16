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
