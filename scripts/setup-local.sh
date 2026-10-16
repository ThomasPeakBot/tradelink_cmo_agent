#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then cp .env.example .env; fi
npm ci
npm run db:generate
if [ "${START_LOCAL_POSTGRES:-1}" = "1" ]; then docker compose up -d --wait postgres; fi
npm run db:migrate
npm run db:seed
printf '\nSetup complete. Start with: npm run dev\n'
