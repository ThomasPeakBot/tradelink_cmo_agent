/** Apply checked-in Prisma SQL migrations atomically without native engine downloads. */
import 'dotenv/config';
import { Client } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock(74182354)');
    await client.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      id VARCHAR(36) PRIMARY KEY, checksum VARCHAR(64) NOT NULL, finished_at TIMESTAMPTZ,
      migration_name VARCHAR(255) NOT NULL, logs TEXT, rolled_back_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(), applied_steps_count INTEGER NOT NULL DEFAULT 0
    )`);
    const folders = (await readdir('prisma/migrations', { withFileTypes: true }))
      .filter((f) => f.isDirectory())
      .map((f) => f.name)
      .sort();
    for (const folder of folders) {
      const sql = await readFile(path.join('prisma/migrations', folder, 'migration.sql'), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const { rows } = await client.query(
        'SELECT checksum, finished_at, rolled_back_at FROM "_prisma_migrations" WHERE migration_name = $1',
        [folder],
      );
      const applied = rows.find((r) => !r.rolled_back_at);
      if (applied) {
        if (!applied.finished_at || applied.checksum !== checksum)
          throw new Error(
            `Migration ${folder} is unfinished or its checksum changed; manual review required.`,
          );
        console.log('Already applied:', folder);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count) VALUES ($1,$2,$3,now(),1)',
          [randomUUID(), checksum, folder],
        );
        await client.query('COMMIT');
        console.log('Applied:', folder);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(74182354)').catch(() => {});
    await client.end();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Migration failed');
  process.exitCode = 1;
});
