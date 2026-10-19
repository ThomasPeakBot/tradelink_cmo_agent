import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { db } from './db';

// Fixed identifiers only; never accept table names or predicates from a caller.
const tables = [
  'DailyMetric',
  'ChannelMetric',
  'Experiment',
  'Knowledge',
  'Memory',
  'Approval',
  'Alert',
  'Report',
  'ChatMessage',
  'DailyPlan',
] as const;
export async function archiveDemoRecords(client: typeof db, actor: string, launchDate?: string) {
  if (launchDate && !/^\d{4}-\d{2}-\d{2}$/.test(launchDate)) throw Error('Invalid launch date');
  return client.$transaction((tx) => archiveDemoInTransaction(tx, actor, launchDate), {
    timeout: 30000,
    isolationLevel: 'Serializable',
  });
}
export async function archiveDemoInTransaction(
  tx: Prisma.TransactionClient,
  actor: string,
  launchDate?: string,
) {
  if (launchDate && !/^\d{4}-\d{2}-\d{2}$/.test(launchDate)) throw Error('Invalid launch date');
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(74182362)`;
  const batch = randomUUID();
  const counts: Record<string, number> = {};
  const archive = async (table: string, predicate: string) => {
    const sql = Prisma.raw(
      `INSERT INTO "DemoArchive" ("id","batchId","recordType","recordId","data","archivedAt") SELECT $1 || ':' || $2 || ':' || t."id", $1, $2, t."id", to_jsonb(t), NOW() FROM "${table}" t WHERE ${predicate}`,
    );
    return tx.$executeRawUnsafe(sql.sql, batch, table);
  };
  // Preserve task edits/outcomes before removing plans generated using demo context.
  counts.TodayTask = await archive(
    'TodayTask',
    't."planId" IN (SELECT "id" FROM "DailyPlan" WHERE "isDemo" = true)',
  );
  for (const table of tables) {
    counts[table] = await archive(table, 't."isDemo" = true');
    await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "isDemo" = true`);
  }
  const company = await tx.company.findUniqueOrThrow({ where: { id: 'tradelink' } });
  const seededDescription =
    'TradeLink growth workspace. Company positioning, audience, pricing, and constraints below are demo assumptions awaiting validation.';
  if (launchDate || company.description === seededDescription) {
    await archive('Company', `t."id" = 'tradelink'`);
    const start = launchDate ? new Date(`${launchDate}T00:00:00Z`) : company.goalStartDate;
    if (
      Number.isNaN(start.getTime()) ||
      (launchDate && start.toISOString().slice(0, 10) !== launchDate)
    )
      throw Error('Invalid launch date');
    const end = new Date(start);
    end.setUTCFullYear(start.getUTCFullYear() + 1);
    await tx.company.update({
      where: { id: 'tradelink' },
      data: {
        ...(launchDate ? { goalStartDate: start, goalEndDate: end } : {}),
        ...(company.description === seededDescription
          ? {
              description:
                'TradeLink internal growth workspace. Use verified company knowledge and live or manual business evidence for planning.',
            }
          : {}),
      },
    });
  }
  await tx.auditLog.create({
    data: {
      actor,
      action: 'GO_LIVE_ARCHIVE_DEMO',
      entityType: 'Company',
      entityId: 'tradelink',
      details: JSON.stringify({
        batch,
        counts,
        launchDate: launchDate ?? null,
        note: 'Marked demo records archived before removal from active context. Live records, credentials, integrations, users, sessions and prior audits preserved. Baseline subscriber count unchanged.',
      }),
    },
  });
  const goal = await tx.company.findUniqueOrThrow({ where: { id: 'tradelink' } });
  return {
    batch,
    counts,
    goal: {
      start: goal.goalStartDate.toISOString().slice(0, 10),
      end: goal.goalEndDate.toISOString().slice(0, 10),
      baseline: goal.goalStart,
      target: goal.goalTarget,
    },
  };
}
