import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { db } from '../lib/db';
import { archiveDemoRecords } from '../lib/go-live';
async function main() {
  if (!process.argv.includes('--apply'))
    throw Error(
      'Explicit --apply required. This archives marked demo data and removes it from active context.',
    );
  if (process.argv.includes('--migrate')) {
    const result = spawnSync('npm', ['run', 'db:migrate'], { stdio: 'inherit' });
    if (result.status !== 0) throw Error('Migration failed; no cleanup attempted');
  }
  const launchDate = process.argv
    .find((s) => s.startsWith('--launch-date='))
    ?.slice('--launch-date='.length);
  const result = await archiveDemoRecords(db, 'owner-authorized-go-live', launchDate);
  console.log('GO_LIVE_COMPLETE ' + JSON.stringify(result));
  const remaining = await db.$queryRaw<
    { count: bigint }[]
  >`SELECT COUNT(*) AS count FROM "DemoArchive"`;
  console.log(
    'GO_LIVE_ARCHIVE_VERIFIED ' + JSON.stringify({ archivedRecords: Number(remaining[0].count) }),
  );
}
main()
  .catch(() => {
    console.error(
      'Go-live transition failed; inspect deployment status. Cleanup transaction is atomic.',
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
