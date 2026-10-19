import 'dotenv/config';
import { spawnSync } from 'node:child_process';
// One-time owner-requested transition. Keep each step observable and stop on failure.
for (const [script, args] of [
  ['scripts/go-live.ts', ['--apply', '--migrate', '--launch-date=2026-10-01']],
  ['scripts/refresh-today-from-drive.ts', ['--apply']],
] as const) {
  const result = spawnSync('node', ['--import', 'tsx', script, ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
