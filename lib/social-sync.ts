import { Prisma } from '@prisma/client';
import { db } from './db';
import {
  SocialReadOnlyProvider,
  SocialReadError,
  socialConfiguration,
  socialSnapshotSchema,
  type SocialProvider,
} from './social';

export async function syncSocial(
  actor: string,
  platform: SocialProvider,
  provider = new SocialReadOnlyProvider(platform),
) {
  const config = socialConfiguration(platform);
  if (!config.configured || !config.accountId)
    throw new SocialReadError(
      'configuration',
      'Configure the social token and numeric account ID in Railway before syncing.',
    );
  const entityId = `social-sync:${platform}:${config.accountId}`;
  const acquired = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(74182356)`;
    const previous = await tx.auditLog.findFirst({
      where: {
        entityId,
        action: 'SOCIAL_SYNC_REQUEST',
        createdAt: { gte: new Date(Date.now() - 180000) },
      },
    });
    if (previous) return false;
    await tx.auditLog.create({
      data: {
        actor,
        action: 'SOCIAL_SYNC_REQUEST',
        entityType: 'SocialSnapshot',
        entityId,
        details: 'Requested human-triggered read-only social sync.',
      },
    });
    return true;
  });
  if (!acquired)
    throw new SocialReadError(
      'busy',
      'A sync was requested recently for this account. Wait three minutes before retrying.',
    );
  try {
    const [raw] = await provider.fetchData();
    const snapshot = socialSnapshotSchema.parse(raw);
    if (
      snapshot.provider !== platform ||
      snapshot.accountId !== config.accountId ||
      socialConfiguration(platform).accountId !== config.accountId
    )
      throw new Error('Account scope changed');
    const date = new Date(snapshot.capturedAt.slice(0, 10));
    const data = snapshot as Prisma.InputJsonValue;
    await db.$transaction(async (tx) => {
      await tx.socialSnapshot.upsert({
        where: {
          provider_accountId_date: { provider: platform, accountId: config.accountId!, date },
        },
        create: {
          provider: platform,
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
          action: 'SOCIAL_SYNC_SUCCESS',
          entityType: 'SocialSnapshot',
          entityId,
          details: `Saved ${platform} reporting snapshot with ${snapshot.posts.length} sampled posts. No external writes or subscriber attribution.`,
        },
      });
    });
  } catch {
    await db.auditLog.create({
      data: {
        actor,
        action: 'SOCIAL_SYNC_FAILED',
        entityType: 'SocialSnapshot',
        entityId,
        details: 'Social sync failed. Previous successful snapshot retained; no external writes.',
      },
    });
    throw new SocialReadError(
      'unavailable',
      'Social sync failed. Check the account token, permissions and API plan. The previous successful snapshot was retained.',
    );
  }
}
