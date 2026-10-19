import { afterAll, expect, it } from 'vitest';
import { db } from '../lib/db';
import { archiveDemoInTransaction } from '../lib/go-live';
afterAll(() => db.$disconnect());
it('archives demo context and nested outcomes, preserves live input, snapshots and audits, and anchors launch dates atomically', async () => {
  const rollback = new Error('ROLLBACK_TEST');
  const seeded = await db.dailyMetric.count({ where: { isDemo: true } });
  await expect(
    db.$transaction(
      async (tx) => {
        const live = await tx.knowledge.create({
          data: {
            title: 'Approved live fact',
            category: 'Product',
            content: 'Preserve me',
            isDemo: false,
          },
        });
        const demo = await tx.knowledge.create({
          data: { title: 'Sample fact', category: 'Demo', content: 'Recover me', isDemo: true },
        });
        const audit = await tx.auditLog.create({
          data: {
            actor: 'fixture',
            action: 'EXISTING',
            entityType: 'Knowledge',
            entityId: live.id,
            details: 'Preserve prior audit',
          },
        });
        const livePlan = await tx.dailyPlan.create({
          data: {
            date: new Date('2030-01-02'),
            budgetMinutes: 270,
            summary: 'Live work',
            warnings: [],
            provider: 'fixture',
            dataAsOf: new Date(),
            isDemo: false,
          },
        });
        const demoPlan = await tx.dailyPlan.create({
          data: {
            date: new Date('2030-01-01'),
            budgetMinutes: 270,
            summary: 'Demo context',
            warnings: [],
            provider: 'fixture',
            dataAsOf: new Date(),
            isDemo: true,
            tasks: {
              create: {
                position: 0,
                title: 'Completed work',
                minutes: 60,
                deliverable: 'Draft',
                successMetric: 'Outcome',
                rationale: 'Context',
                evidence: [],
                status: 'COMPLETED',
                outcome: 'Real observation preserved in archive',
              },
            },
          },
        });
        const task = await tx.todayTask.findFirstOrThrow({ where: { planId: demoPlan.id } });
        const users = await tx.user.count();
        const snapshots = await tx.stripeSnapshot.count();
        const result = await archiveDemoInTransaction(tx, 'fixture-go-live', '2026-10-01');
        expect(result.goal).toMatchObject({
          start: '2026-10-01',
          end: '2027-10-01',
          baseline: 50,
          target: 5000,
        });
        expect(await tx.knowledge.findUnique({ where: { id: live.id } })).not.toBeNull();
        expect(await tx.knowledge.findUnique({ where: { id: demo.id } })).toBeNull();
        expect(
          await tx.demoArchive.findFirst({ where: { batchId: result.batch, recordId: demo.id } }),
        ).toMatchObject({ data: { content: 'Recover me' } });
        expect(
          await tx.demoArchive.findFirst({ where: { batchId: result.batch, recordId: task.id } }),
        ).toMatchObject({ data: { outcome: 'Real observation preserved in archive' } });
        expect(await tx.dailyPlan.findUnique({ where: { id: demoPlan.id } })).toBeNull();
        expect(await tx.dailyPlan.findUnique({ where: { id: livePlan.id } })).not.toBeNull();
        expect(await tx.auditLog.findUnique({ where: { id: audit.id } })).not.toBeNull();
        expect(await tx.user.count()).toBe(users);
        expect(await tx.stripeSnapshot.count()).toBe(snapshots);
        expect(await tx.dailyMetric.count({ where: { isDemo: true } })).toBe(0);
        expect(await tx.knowledge.count({ where: { isDemo: true } })).toBe(0);
        const repeat = await archiveDemoInTransaction(tx, 'fixture-go-live');
        expect(Object.values(repeat.counts).every((n) => n === 0)).toBe(true);
        throw rollback;
      },
      { timeout: 30000 },
    ),
  ).rejects.toBe(rollback);
  expect(await db.dailyMetric.count({ where: { isDemo: true } })).toBe(seeded);
});
it('rolls back all archival and deletions when launch date validation fails', async () => {
  const before = await db.knowledge.count();
  const archives = await db.demoArchive.count();
  await expect(
    db.$transaction((tx) => archiveDemoInTransaction(tx, 'fixture', '2026-02-30')),
  ).rejects.toThrow('Invalid launch date');
  expect(await db.knowledge.count()).toBe(before);
  expect(await db.demoArchive.count()).toBe(archives);
});
