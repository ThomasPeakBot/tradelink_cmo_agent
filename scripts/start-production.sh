#!/bin/sh
set -eu
npm run db:migrate
npm run db:bootstrap
exec npm run start
