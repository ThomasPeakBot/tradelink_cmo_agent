import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test') ||
  process.env.TEST_DATABASE_URL === process.env.DATABASE_URL
)
  throw new Error(
    'Provide TEST_DATABASE_URL for a separate PostgreSQL database ending in _test; never use the application database.',
  );
for (const command of ['db:migrate']) {
  const result = spawnSync('npm', ['run', command], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      NODE_ENV: 'test',
      ADMIN_EMAIL: 'admin@tradelink.local',
      ADMIN_PASSWORD: 'TradeLink-Demo-2026!',
    },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function resetAndSeed() {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
    );
    const tables = rows.map(
      (row) => '"public"."' + String(row.tablename).replaceAll('"', '""') + '"',
    );
    if (tables.length)
      await client.query('TRUNCATE ' + tables.join(', ') + ' RESTART IDENTITY CASCADE');
    console.log('Reset disposable test database; production/application database is untouched.');
  } finally {
    await client.end();
  }
  const result = spawnSync('npm', ['run', 'db:seed'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      NODE_ENV: 'test',
      ADMIN_EMAIL: 'admin@tradelink.local',
      ADMIN_PASSWORD: 'TradeLink-Demo-2026!',
    },
  });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}
resetAndSeed().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Test preparation failed');
  process.exitCode = 1;
});
