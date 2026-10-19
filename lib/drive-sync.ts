import { db } from './db';
import {
  DriveReadOnlyProvider,
  DriveReadError,
  driveConfiguration,
  tradeLinkFolderId,
} from './drive';
export async function syncDrive(actor: string, provider = new DriveReadOnlyProvider()) {
  if (!driveConfiguration().configured)
    throw new DriveReadError(
      'configuration',
      'Configure the dedicated Google Drive service account and folder Viewer permission before syncing.',
    );
  const entityId = `drive-sync:${tradeLinkFolderId}`;
  const acquired = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(74182357)`;
    const prior = await tx.auditLog.findFirst({
      where: {
        entityId,
        action: 'DRIVE_SYNC_REQUEST',
        createdAt: { gte: new Date(Date.now() - 180000) },
      },
    });
    if (prior) return false;
    await tx.auditLog.create({
      data: {
        actor,
        action: 'DRIVE_SYNC_REQUEST',
        entityType: 'DriveSync',
        entityId,
        details: 'Requested read-only import of the approved TradeLink folder.',
      },
    });
    return true;
  });
  if (!acquired)
    throw new DriveReadError(
      'busy',
      'A Drive sync was requested recently. Wait three minutes before retrying.',
    );
  try {
    const result = await provider.fetchData();
    if (result.folderId !== tradeLinkFolderId) throw Error('Wrong folder');
    await db.$transaction(async (tx) => {
      await tx.driveDocument.deleteMany({ where: { folderId: tradeLinkFolderId } });
      if (result.documents.length)
        await tx.driveDocument.createMany({
          data: result.documents.map((d) => ({
            ...d,
            folderId: tradeLinkFolderId,
            modifiedAt: new Date(d.modifiedAt),
            syncedAt: new Date(result.capturedAt),
          })),
        });
      const data = {
        folderName: result.folderName,
        syncedAt: new Date(result.capturedAt),
        active: true,
        skipped: result.skipped,
      };
      await tx.driveSync.upsert({
        where: { folderId: tradeLinkFolderId },
        create: { folderId: tradeLinkFolderId, ...data },
        update: data,
      });
      await tx.auditLog.create({
        data: {
          actor,
          action: 'DRIVE_SYNC_SUCCESS',
          entityType: 'DriveSync',
          entityId,
          details: `Imported ${result.documents.length} text documents; skipped ${result.skipped} unsupported files. Types: ${JSON.stringify(result.skippedByMime ?? {})}. No Drive writes.`,
        },
      });
    });
  } catch (error) {
    await db.$transaction(async (tx) => {
      await tx.driveSync.updateMany({
        where: { folderId: tradeLinkFolderId },
        data: { active: false },
      });
      await tx.auditLog.create({
        data: {
          actor,
          action: 'DRIVE_SYNC_FAILED',
          entityType: 'DriveSync',
          entityId,
          details:
            'Import failed; cached documents retained; direct Drive reference retrieval paused until a successful sync.',
        },
      });
    });
    if (error instanceof DriveReadError) throw error;
    throw new DriveReadError(
      'unavailable',
      'Drive import failed. Cached documents are retained; direct Drive reference retrieval is paused until a successful sync.',
    );
  }
}
