import 'dotenv/config';
import { spawnSync } from 'node:child_process';
if (!process.argv.includes('--apply')) throw Error('Explicit --apply required');
for (const [binary, args] of [
  ['npm', ['run', 'db:migrate']],
  [
    'node',
    [
      '--import',
      'tsx',
      'scripts/review-drive-everything.ts',
      '--apply',
      '--skip-previously-failed-png',
    ],
  ],
  ['node', ['--import', 'tsx', 'scripts/populate-today-guides.ts', '--apply']],
] as const) {
  const result = spawnSync(binary, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
