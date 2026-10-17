import { Prisma } from '@prisma/client';
import { db } from './db';
import { StripeReadOnlyProvider, StripeReadError, stripeScope } from './stripe';

export async function syncStripe(actor: string, provider = new StripeReadOnlyProvider()) {
  const scope = stripeScope();
  // A durable lease prevents multiple app instances from racing or exhausting Stripe rate limits.
  const leaseId = `stripe-sync:${scope.id}`;
  const acquired = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(74182355)`;
    const previous = await tx.auditLog.findFirst({
      where: {
        entityId: leaseId,
        action: 'STRIPE_SYNC_REQUEST',
        createdAt: { gte: new Date(Date.now() - 180000) },
      },
    });
    if (previous) return false;
    await tx.auditLog.create({
      data: {
        actor,
        action: 'STRIPE_SYNC_REQUEST',
        entityType: 'StripeSnapshot',
        entityId: leaseId,
        details: 'Requested read-only billing sync; no Stripe writes.',
      },
    });
    return true;
  });
  if (!acquired)
    throw new StripeReadError(
      'busy',
      'A Stripe sync was requested recently. Wait three minutes before retrying.',
    );
  try {
    const [snapshot] = await provider.fetchData();
    if (!snapshot || snapshot.scopeId !== scope.id)
      throw new StripeReadError('scope', 'Stripe scope changed; no snapshot was saved.');
    const date = new Date(snapshot.capturedAt.slice(0, 10));
    await db.$transaction(async (tx) => {
      await tx.stripeSnapshot.upsert({
        where: { scopeId_date: { scopeId: scope.id, date } },
        create: {
          scopeId: scope.id,
          date,
          capturedAt: new Date(snapshot.capturedAt),
          data: snapshot as Prisma.InputJsonValue,
        },
        update: {
          capturedAt: new Date(snapshot.capturedAt),
          data: snapshot as Prisma.InputJsonValue,
        },
      });
      await tx.auditLog.create({
        data: {
          actor,
          action: 'STRIPE_SYNC_SUCCESS',
          entityType: 'StripeSnapshot',
          entityId: leaseId,
          details: `Saved scoped UTC snapshot; ${snapshot.customerIds.length} active paid-price customers. Gross MRR before discounts. No Stripe writes.`,
        },
      });
    });
  } catch (error) {
    // Never serialize upstream errors, URLs, headers or responses into audits or logs.
    await db.auditLog.create({
      data: {
        actor,
        action: 'STRIPE_SYNC_FAILED',
        entityType: 'StripeSnapshot',
        entityId: leaseId,
        details: 'Read-only sync failed; last successful snapshot unchanged.',
      },
    });
    throw error;
  }
}
