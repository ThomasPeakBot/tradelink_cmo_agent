# Railway deployment runbook

Deployment has been authorized by the user. There is no public application URL until Railway accepts an upload and the deployed service passes its readiness checks. No OpenAI credential is required.

## Access required from the account owner

The cloud workspace initially had no Railway CLI session, `RAILWAY_TOKEN`, or `RAILWAY_API_TOKEN`. A read-only CLI `whoami` returned `Unauthorized`. A request to the official Railway API was rejected by the environment egress proxy (CONNECT HTTP 403).

The cloud configuration draft now declares:

- Railway network destinations: `railway.com`, `backboard.railway.com`, and `binaries.prisma.sh` (preserving `api.openai.com`).
- A personal `RAILWAY_API_TOKEN` binding, forwarded only to `backboard.railway.com`.

The owner can create an account token in Railway account settings and enter it securely in the cloud environment settings. Do not paste it into chat, commit it, or print its value. Saving the draft does not itself activate the token/network policy. After the settings are applied, recheck `railway whoami` and the API operation before requesting more credentials. A browserless sign-in is an alternative once Railway network access is working.

For this task the Railway CLI 5.69.0 was downloaded from the official GitHub release to `/tmp/tradelink-railway-bin/railway`. Its archive SHA-256 was verified against the digest published on GitHub. No TLS or checksum verification was disabled. `/tmp` tools may need reinstalling in a new task.

## Provision and deploy after authentication

Use the existing checkout; it can be uploaded directly with the CLI. A GitHub push is not necessary for a CLI upload. Use a new Railway project and a new PostgreSQL service; do not modify unrelated existing services.

1. Confirm the authenticated Railway workspace and select the intended workspace if the account has more than one.
2. Create `tradelink-cmo` and a `web` service plus PostgreSQL. Link `DATABASE_URL` via the Railway PostgreSQL service reference, not a copied credential in source code.
3. Generate a Railway service domain and set `APP_URL` to its exact HTTPS origin. Configure `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` securely in the **Railway web service's** variables. The admin password is a real server-side value, not a cloud proxy placeholder. It must not be the documented development password.
4. Choose initial data: `BOOTSTRAP_MODE=empty` (default, actual production workspace) or `BOOTSTRAP_MODE=demo` (labeled sample data, for evaluation). This is read only when the database is fresh.
5. Upload the checkout using `railway up` with explicit project, service, and environment identifiers. The Dockerfile runs the lockfile installation and production build. Startup runs `npm run start:production`: migrations → first-boot initialization → Next.js. Stop on build or bootstrap errors and inspect sanitized logs.
6. Wait for a successful deployment and HTTPS health response, then test `/login`, authentication, `/api/workspace`, pace assessment, and a persisted local-evidence briefing. If this cloud environment blocks the newly generated service hostname, add that exact hostname to the egress configuration rather than broadening to all hosts.
7. Return the verified HTTPS login URL to the user. They log in with the email/password set in Railway. Never return a made-up URL or the public development password for production.

`start:production` serializes first boot with a PostgreSQL advisory lock. A fresh empty workspace is created atomically. Existing company/admin records are left unchanged. Partially initialized databases stop for review rather than overwriting records. Repeated startup does not reset an existing administrator's password. Application state remains in Railway PostgreSQL, independent of the disposable app container.

## Current verification boundary

The application and first-boot scripts can be tested locally while Railway access is missing. A local build, cloud configuration save, or unauthenticated CLI installation is not a remote deployment. Update this record with real project/service IDs and readiness evidence after successful Railway deployment. Never store credentials in this document.

## Deployment-preparation checks

Production first-boot initialization was exercised against two disposable PostgreSQL databases: empty mode inserted no synthetic metrics, and explicit demo mode inserted 30 observations, all labeled demo. A repeated empty-mode bootstrap without password variables preserved the existing administrator and data. Lint, TypeScript, 34 unit tests, and the Next.js production build pass.

The local Docker dependency install initially failed because the stock image did not trust this cloud environment's TLS proxy. The Dockerfile now accepts an optional build-only `platform_ca` secret; using the platform's installed CA bundle restored npm installation with TLS verification intact. No proxy certificate is copied into the resulting image. The Docker build subsequently identified missing OpenSSL in the slim base image; OpenSSL and CA certificates are now installed explicitly. Full image validation remains pending because the running environment blocks the Prisma native engine/checksum download from `binaries.prisma.sh`. That exact domain was added to the configuration draft for review; checksum verification remains enabled.

The container copies source files with ownership suitable for the unprivileged Node runtime and grants that runtime access to the generated Next.js cache. Production npm uses a separate writable temporary cache. No account credentials are baked into the image.

The integrated `start:production` entrypoint was also verified against the empty disposable database on an unused local port: migration detection, existing-admin preservation, HTTP health, Secure-cookie authentication, and `NO DATA` pace behavior all succeeded.

## Recheck after environment settings were applied

The Railway API now returns HTTP 200 and the Docker image build completes. The running cloud machine still has no injected `RAILWAY_API_TOKEN`; the saved personal token requirement has no credential binding. Native `railway whoami` returned Unauthorized.

The machine's home directory is physically read-only even after a scoped filesystem write grant, so the official CLI's normal `~/.railway` credential storage cannot be used. Browserless OAuth is instead started in a temporary Node container with a private, writable credential volume at `/workspace/railway-deployment-access` (outside the application checkout). The official CLI binary remains checksum-verified. Proxy routing and the platform CA bundle are passed through without disabling TLS verification. The account owner must approve Railway's device sign-in; do not assume the approval happened merely because the URL was issued.

The image `tradelink-cmo:railway` built successfully with OpenSSL and the optional build-only platform CA bundle. Its unprivileged runtime was exercised against a fresh disposable PostgreSQL database: startup migration, administrator bootstrap, health, secure-cookie login, authenticated workspace, local-evidence Daily Growth Brief persistence and logout all passed. No API credentials or remote Railway resources were needed for these local checks.

Remote deployment remains pending Railway authentication. No public login URL is claimed until actual Railway service deployment and HTTPS verification succeed.
