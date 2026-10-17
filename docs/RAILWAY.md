# TradeLink Railway deployment

## Hosted application

- Application: https://web-production-7ff96.up.railway.app
- Login: https://web-production-7ff96.up.railway.app/login
- Project: `tradelink-cmo` — `5dcb62c9-93ad-4d51-a27a-6686a324b08b`
- Workspace: Thomas Adamkowski's Projects
- Environment: `production` — `ccb1fbce-a8bf-4ac9-accb-08295b699fd5`
- Web service: `web` — `81c43578-1d5f-455e-a18e-7171d7db1e4a`
- Database: `Postgres` — `c00aa1ec-d2ca-4570-9cb1-17e4200749fd`, persistent Railway volume
- Application source commit: `e5c6472` (CLI upload; no GitHub push or autodeploy source configured)

Railway successfully built and started deployment `b0534d82-a549-40c5-b23b-64bf3af855ec`. Its startup logs confirm the SQL migration applied, labeled demo data and administrator were initialized, and Next.js started. The Railway-managed domain reports `ACTIVE` and targets port 3000. Subsequent restarts have also started successfully using the same persistent PostgreSQL database. Deployment and configuration identifiers below are retained for maintenance.

## Login and credentials

The administrator email is `thomas@peakbot.com`. A unique cryptographically generated password was sent directly to Railway's `ADMIN_PASSWORD` variable through CLI stdin. It was not printed, committed, or written to a local credential file. The account owner can reveal it under **Railway → tradelink-cmo → web → Variables → ADMIN_PASSWORD**. Never use the public development password for this deployment.

`BOOTSTRAP_MODE=demo` was explicitly chosen, so sample metrics, channel attribution, experiments and unknown company facts remain labeled demo. Replace assumptions with approved company knowledge before using recommendations for business decisions. OpenAI credentials are not configured; local evidence mode is available immediately.

`DATABASE_URL` uses Railway's `${{Postgres.DATABASE_URL}}` reference. `APP_URL` is the exact public HTTPS origin above. First boot creates the workspace and administrator; repeated startup preserves existing records and credentials. Changing the Railway password variable alone does not rotate an existing database user's password: use the documented `admin:password` operation intentionally.

## Build and startup

The production Dockerfile installs OpenSSL and CA certificates, performs frozen `npm ci`, generates Prisma, builds Next.js, and runs as the unprivileged Node user. It uses ordinary system trust on Railway. Railway's builder rejects `type=secret` mounts, so any CA mount required for local verification behind the cloud proxy belongs in a temporary local-only Dockerfile variant, not the production file. No TLS, artifact checksum, or package integrity verification was disabled.

`npm run start:production` applies checked-in SQL migrations, bootstraps a fresh database, and starts Next.js on Railway's `PORT`. Database state resides in PostgreSQL rather than the application container.

The web service's deployment configuration was explicitly set and read back through Railway's API:

- Dockerfile path: `Dockerfile`
- Start command: `npm run start:production`
- Path: `/api/health` (queries PostgreSQL)
- Timeout: 120 seconds
- Restart policy: `ON_FAILURE`, maximum 5 retries

Railway's initial CLI upload used Dockerfile configuration from the repository. Its redeploy action defaulted to Railpack until explicit service configuration was stored; both compiled and started this application successfully. The repository also retains `railway.toml`. Railway currently supports it but warns of Config as Code deprecation on 2026-12-01; migrate to its supported Infrastructure as Code workflow before that deadline.

## Verification and access boundaries

The local production image passed migrations, administrator bootstrap, Secure-cookie login, authenticated workspace access, persisted local-evidence Daily Growth Brief generation, and logout. Local validation includes 34 unit tests, six database integration tests, nine browser/API tests, lint, TypeScript and production compilation.

Railway's remote build and startup succeeded against its own PostgreSQL service. This cloud environment's egress policy blocks direct HTTPS requests to the newly generated `web-production-7ff96.up.railway.app` hostname; that proxy refusal is not an application HTTP failure. Direct public browser authentication has not been claimed as tested. To perform future cloud-side HTTPS checks, add that exact hostname to environment network settings while preserving the current Railway/OpenAI/package destinations.

Railway sign-in uses the official checksum-verified CLI with browserless OAuth. The machine's home directory is read-only, so the CLI runs in a temporary container with private writable storage at `/workspace/railway-deployment-access`, outside the application checkout. Keep that personal credential directory private; do not commit it or include it in a shared environment snapshot. No OAuth credential values belong in documentation or chat.

Remote resources were created only in this new TradeLink project. No existing project was modified and no paid-plan upgrade was performed. Cloud configuration drafts and filesystem snapshots remain separate from this live Railway deployment.
