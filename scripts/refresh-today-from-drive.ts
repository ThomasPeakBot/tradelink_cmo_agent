import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { syncDrive } from '../lib/drive-sync';
import { tradeLinkFolderId } from '../lib/drive';
import { reviewDriveDocument } from '../lib/drive-review';
import { getWorkspace } from '../lib/workspace';
import { generateTodayDraft } from '../lib/today-plan';
import { easternSchedule } from '../lib/sync-state';
import { hasDemoContext } from '../lib/demo';
async function main() {
  if (!process.argv.includes('--apply')) throw Error('Explicit --apply required');
  const admin = await db.user.findFirstOrThrow({
    where: { role: 'ADMIN' },
    select: { id: true, email: true },
  });
  await syncDrive(admin.email);
  const state = await db.driveSync.findUniqueOrThrow({ where: { folderId: tradeLinkFolderId } });
  if (!state.active) throw Error('Drive import inactive');
  const documents = await db.driveDocument.findMany({
    where: { folderId: tradeLinkFolderId },
    orderBy: { fileId: 'asc' },
  });
  if (!documents.length) throw Error('No readable Drive documents');
  const reviews: {
    document: (typeof documents)[number];
    review: Awaited<ReturnType<typeof reviewDriveDocument>>;
  }[] = [];
  for (const document of documents) {
    const review = await reviewDriveDocument(document);
    reviews.push({ document, review });
  }
  await db.$transaction(async (tx) => {
    const latestSync = await tx.driveSync.findUniqueOrThrow({
      where: { folderId: tradeLinkFolderId },
    });
    if (!latestSync.active || latestSync.syncedAt.getTime() !== state.syncedAt.getTime())
      throw Error('Drive changed during review; retry');
    const ids = reviews.map(({ document }) => `drive-review:${document.fileId}`);
    await tx.memory.deleteMany({ where: { id: { startsWith: 'drive-review:', notIn: ids } } });
    for (const { document, review } of reviews) {
      const data = {
        title: `Drive review: ${document.name}`,
        kind: 'REFERENCE',
        isDemo: false,
        content: JSON.stringify({
          source: `https://drive.google.com/file/d/${document.fileId}/view`,
          modifiedAt: document.modifiedAt.toISOString(),
          syncedAt: document.syncedAt.toISOString(),
          reviewedAt: new Date().toISOString(),
          coverage: document.truncated
            ? 'Imported text truncated at 20,000 characters'
            : 'All imported document text reviewed',
          ...review,
        }),
      };
      await tx.memory.upsert({
        where: { id: `drive-review:${document.fileId}` },
        create: { id: `drive-review:${document.fileId}`, ...data },
        update: data,
      });
    }
    await tx.memory.upsert({
      where: { id: 'drive-folder-review-coverage' },
      create: {
        id: 'drive-folder-review-coverage',
        title: 'Drive folder review coverage',
        kind: 'REFERENCE',
        content: `Reviewed all ${documents.length} imported text documents. ${state.skipped} unsupported files were not read. ${documents.filter((d) => d.truncated).length} imports were truncated. This is not a review of unsupported media or full text beyond import limits.`,
        isDemo: false,
      },
      update: {
        content: `Reviewed all ${documents.length} imported text documents. ${state.skipped} unsupported files were not read. ${documents.filter((d) => d.truncated).length} imports were truncated. This is not a review of unsupported media or full text beyond import limits.`,
        isDemo: false,
      },
    });
    await tx.auditLog.create({
      data: {
        actor: admin.email,
        action: 'DRIVE_FOLDER_REVIEW',
        entityType: 'DriveSync',
        entityId: tradeLinkFolderId,
        details: JSON.stringify({
          reviewed: documents.length,
          skipped: state.skipped,
          truncated: documents.filter((d) => d.truncated).length,
          noExternalActions: true,
        }),
      },
    });
  });
  const workspace = await getWorkspace(admin.id);
  if (hasDemoContext(workspace)) throw Error('Demo evidence remains; new plan not generated');
  const date = new Date(easternSchedule().day);
  const previous = await db.dailyPlan.findUnique({ where: { date }, include: { tasks: true } });
  const budget = previous?.budgetMinutes ?? 270;
  const { draft, provider } = await generateTodayDraft(workspace, budget, 'auto');
  if (!provider.startsWith('openai:')) throw Error('Live OpenAI review required');
  if (easternSchedule().day !== date.toISOString().slice(0, 10))
    throw Error('Eastern date changed during review; retry');
  const batch = randomUUID();
  const plan = await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(74182360)`;
      const current = await tx.dailyPlan.findUnique({ where: { date } });
      if (current?.id !== previous?.id || current?.version !== previous?.version)
        throw Error('Today plan changed during review; not replaced');
      if (current) {
        await tx.$executeRaw`INSERT INTO "DemoArchive" ("id","batchId","recordType","recordId","data","archivedAt") SELECT ${batch} || ':DailyPlan:' || t."id",${batch},'DailyPlan',t."id",to_jsonb(t),NOW() FROM "DailyPlan" t WHERE t."id"=${current.id}`;
        await tx.$executeRaw`INSERT INTO "DemoArchive" ("id","batchId","recordType","recordId","data","archivedAt") SELECT ${batch} || ':TodayTask:' || t."id",${batch},'TodayTask',t."id",to_jsonb(t),NOW() FROM "TodayTask" t WHERE t."planId"=${current.id}`;
        await tx.dailyPlan.delete({ where: { id: current.id } });
      }
      const result = await tx.dailyPlan.create({
        data: {
          date,
          budgetMinutes: budget,
          summary: draft.summary,
          warnings: draft.warnings,
          provider,
          isDemo: false,
          dataAsOf: new Date(),
          tasks: { create: draft.tasks.map((task, position) => ({ ...task, position })) },
        },
      });
      await tx.auditLog.create({
        data: {
          actor: admin.email,
          action: 'TODAY_REGENERATED_AFTER_DRIVE_REVIEW',
          entityType: 'DailyPlan',
          entityId: result.id,
          details: JSON.stringify({
            batch,
            reviewedDocuments: documents.length,
            skippedFiles: state.skipped,
            budget,
            previousPlanArchived: !!current,
            noExternalActions: true,
          }),
        },
      });
      return result;
    },
    { timeout: 30000, isolationLevel: 'Serializable' },
  );
  const importAudit = await db.auditLog.findFirst({
    where: { action: 'DRIVE_SYNC_SUCCESS', entityId: `drive-sync:${tradeLinkFolderId}` },
    orderBy: { createdAt: 'desc' },
    select: { details: true },
  });
  console.log(
    'DRIVE_TODAY_REFRESHED ' +
      JSON.stringify({
        date: date.toISOString().slice(0, 10),
        planId: plan.id,
        reviewedDocuments: documents.length,
        skippedFiles: state.skipped,
        truncatedDocuments: documents.filter((d) => d.truncated).length,
        budget,
        provider,
        tasks: 3,
        isDemo: false,
        importCoverage: importAudit?.details,
      }),
  );
}
main()
  .catch(() => {
    console.error(
      'Drive review/Today refresh failed. No secrets logged. Check Drive permissions, cooldown, OpenAI and current plan status. A previous non-demo plan is preserved on generation failure.',
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
