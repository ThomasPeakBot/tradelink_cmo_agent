import 'dotenv/config';
import { Client } from 'pg';
import { spawnSync } from 'node:child_process';
import { db } from '../lib/db';
import { bootstrapConfig } from '../lib/bootstrap-config';
import { hashPassword } from '../lib/password';
async function main() {
  const connection = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
  });
  await connection.connect();
  try {
    // Serialize first-boot setup across multiple replicas using a dedicated connection.
    await connection.query('SELECT pg_advisory_lock(74182355)');
    const [company, admin] = await Promise.all([
      db.company.findUnique({ where: { id: 'tradelink' } }),
      db.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } }),
    ]);
    if (company && admin) {
      console.log('Workspace already initialized; existing data and credentials preserved.');
      return;
    }
    if (company || admin)
      throw new Error(
        'Partially initialized database. Review company and administrator records before retrying; no data was overwritten.',
      );
    const config = bootstrapConfig(process.env);
    if (config.mode === 'demo') {
      const result = spawnSync('npm', ['run', 'db:seed'], {
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_ENV: 'production',
          ADMIN_EMAIL: config.email,
          ADMIN_PASSWORD: config.password,
        },
      });
      if (result.status !== 0)
        throw new Error('Demo workspace initialization failed. Inspect seed logs before retrying.');
    } else {
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + 365 * 86400000);
      await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: config.email,
            name: 'TradeLink Operator',
            passwordHash: hashPassword(config.password),
          },
        });
        await tx.company.create({
          data: {
            description:
              'TradeLink internal growth workspace. Add approved company facts and daily observations before making business decisions.',
            goalStart: 50,
            goalTarget: 5000,
            goalStartDate: start,
            goalEndDate: end,
          },
        });
        await tx.knowledge.create({
          data: {
            title: 'Human approval boundary',
            category: 'Constraints',
            content:
              'V1 cannot execute external actions. Campaigns, spending, publishing, and integrations require explicit human approval and manual execution.',
          },
        });
        await tx.auditLog.create({
          data: {
            actor: 'system',
            action: 'BOOTSTRAP',
            entityType: 'Workspace',
            entityId: 'tradelink',
            details: `Initialized an empty internal workspace and administrator ${user.email}. No demo performance was inserted.`,
          },
        });
      });
    }
    console.log(`Production workspace initialized (${config.mode} mode).`);
  } finally {
    await connection.query('SELECT pg_advisory_unlock(74182355)').catch(() => {});
    await connection.end();
  }
}
main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Workspace initialization failed');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
