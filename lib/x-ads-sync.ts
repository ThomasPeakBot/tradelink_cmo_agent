import { Prisma } from '@prisma/client';
import { db } from './db';
import {
  XAdsReadOnlyProvider,
  XAdsReadError,
  xAdsConfiguration,
  xAdsSnapshotSchema,
  type XAdsProvider,
} from './x-ads';

export async function syncXAds(actor: string, provider: XAdsProvider = new XAdsReadOnlyProvider()) {
  const config = xAdsConfiguration();
  if (!config.configured || !config.accountId)
    throw new XAdsReadError(
      'configuration',
      'Configure the X Ads OAuth credentials and advertiser account ID in Railway before syncing.',
    );
  const entityId = `x-ads-sync:${config.accountId}`;
  const acquired = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(74182361)`;
    const previous = await tx.auditLog.findFirst({
      where: {
        entityId,
        action: 'X_ADS_SYNC_REQUEST',
        createdAt: { gte: new Date(Date.now() - 180000) },
      },
    });
    if (previous) return false;
    await tx.auditLog.create({
      data: {
        actor,
        action: 'X_ADS_SYNC_REQUEST',
        entityType: 'XAdsSnapshot',
        entityId,
        details: 'Requested read-only X Ads sync.',
      },
    });
    return true;
  });
  if (!acquired)
    throw new XAdsReadError(
      'busy',
      'A sync was requested recently for this account. Wait three minutes before retrying.',
    );
  try {
    const raw = await provider.fetchData();
    const snapshot = xAdsSnapshotSchema.parse(raw);
    if (
      snapshot.accountId !== config.accountId ||
      xAdsConfiguration().accountId !== config.accountId
    )
      throw new Error('Account scope changed');
    const date = new Date(snapshot.capturedAt.slice(0, 10));
    const data = snapshot as Prisma.InputJsonValue;
    await db.$transaction(async (tx) => {
      await tx.xAdsSnapshot.upsert({
        where: {
          accountId_date: { accountId: config.accountId!, date },
        },
        create: {
          accountId: config.accountId!,
          date,
          capturedAt: new Date(snapshot.capturedAt),
          data,
        },
        update: { capturedAt: new Date(snapshot.capturedAt), data },
      });
      await tx.auditLog.create({
        data: {
          actor,
          action: 'X_ADS_SYNC_SUCCESS',
          entityType: 'XAdsSnapshot',
          entityId,
          details: `Saved X Ads reporting snapshot with ${snapshot.campaigns.length} campaigns. No external writes or subscriber attribution.`,
        },
      });
    });
  } catch {
    await db.auditLog.create({
      data: {
        actor,
        action: 'X_ADS_SYNC_FAILED',
        entityType: 'XAdsSnapshot',
        entityId,
        details: 'X Ads sync failed. Previous successful snapshot retained; no external writes.',
      },
    });
    throw new XAdsReadError(
      'unavailable',
      'X Ads sync failed. Check the account token, permissions and API plan. The previous successful snapshot was retained.',
    );
  }
}
