import { runAffiliateEmail } from './affiliate-email/automation';
import { syncXAds } from './x-ads-sync';
import { xAdsConfiguration } from './x-ads';
import { Client } from 'pg';
import { db } from './db';
import { syncStripe } from './stripe-sync';
import { stripeConfiguration } from './stripe';
import { syncSocial } from './social-sync';
import { socialConfiguration } from './social';
import { syncDrive } from './drive-sync';
import { driveConfiguration } from './drive';
import { refreshAlerts } from './alerts';
import { easternSchedule, batchStatus, syncResultsSchema, type SyncResult } from './sync-state';
export class SyncBusyError extends Error {
  constructor() {
    super('A full sync is already running. Refresh the workspace to see its progress.');
  }
}
export async function syncAll(actor: string, trigger: 'MANUAL' | 'SCHEDULED', now = new Date()) {
  const schedule = easternSchedule(now);
  if (trigger === 'SCHEDULED' && !schedule.due)
    return { skipped: true, reason: 'Waiting for 4:00 a.m. America/New_York.' };
  const connection = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    keepAlive: true,
  });
  let connectionLost = false;
  connection.on('error', () => {
    connectionLost = true;
  });
  await connection.connect();
  let acquired = false;
  try {
    const lock = await connection.query('SELECT pg_try_advisory_lock(74182358) AS acquired');
    acquired = lock.rows[0]?.acquired === true;
    if (!acquired) throw new SyncBusyError();
    const day = new Date(schedule.day);
    const previous =
      trigger === 'SCHEDULED'
        ? await db.syncRun.findUnique({ where: { scheduledDay: day } })
        : null;
    if (previous && previous.status !== 'RUNNING')
      return {
        skipped: true,
        reason: 'This Eastern calendar day already has a completed scheduled run.',
        runId: previous.id,
        status: previous.status,
      };
    await db.syncRun.updateMany({
      where: { status: 'RUNNING', ...(previous ? { id: { not: previous.id } } : {}) },
      data: { status: 'INTERRUPTED', completedAt: new Date() },
    });
    // An unfinished record can resume only after the previous process releases its database lock.
    const run =
      previous ??
      (await db.syncRun.create({
        data: { actor, trigger, scheduledDay: trigger === 'SCHEDULED' ? day : null, results: [] },
      }));
    const results = syncResultsSchema.parse(run.results);
    const tasks = [
      {
        provider: 'x_ads' as const,
        configured: xAdsConfiguration().configured,
        execute: () => syncXAds(actor),
      },
      {
        provider: 'stripe' as const,
        configured: stripeConfiguration().configured,
        execute: () => syncStripe(actor),
      },
      {
        provider: 'x' as const,
        configured: socialConfiguration('x').configured,
        execute: () => syncSocial(actor, 'x'),
      },
      {
        provider: 'instagram' as const,
        configured: socialConfiguration('instagram').configured,
        execute: () => syncSocial(actor, 'instagram'),
      },
      {
        provider: 'drive' as const,
        configured: driveConfiguration().configured,
        execute: () => syncDrive(actor),
      },
    ];
    for (const task of tasks) {
      if (connectionLost) throw new Error('Sync lock connection lost');
      if (results.some((r) => r.provider === task.provider)) continue;
      let result: SyncResult = {
        provider: task.provider,
        status: 'SKIPPED',
        message: 'Not configured; no external request was made.',
      };
      if (task.configured) {
        try {
          await task.execute();
          result = {
            provider: task.provider,
            status: 'SUCCESS',
            message: 'Read-only sync completed.',
          };
        } catch (error) {
          const busy = error instanceof Error && 'code' in error && error.code === 'busy';
          result = {
            provider: task.provider,
            status: busy ? 'SKIPPED' : 'FAILED',
            message: busy
              ? 'Recently requested; provider cooldown retained.'
              : 'Sync failed. Previous successful data was retained; check provider configuration and audit log.',
          };
        }
      }
      results.push(result);
      await db.syncRun.update({ where: { id: run.id }, data: { results } });
    }
    if (!results.some((r) => r.provider === 'alerts')) {
      const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
      try {
        if (admin) await refreshAlerts(admin.id);
        results.push({
          provider: 'alerts',
          status: admin ? 'SUCCESS' : 'SKIPPED',
          message: admin
            ? 'Growth alerts refreshed.'
            : 'No administrator available for alert refresh.',
        });
      } catch {
        results.push({
          provider: 'alerts',
          status: 'FAILED',
          message: 'Alert refresh failed; imported snapshots were retained.',
        });
      }
    }
    if (!results.some((r) => r.provider === 'affiliate_email')) {
      try {
        results.push({ provider: 'affiliate_email', ...(await runAffiliateEmail(actor)) });
      } catch {
        results.push({
          provider: 'affiliate_email',
          status: 'FAILED',
          message: 'Affiliate email automation failed; inspect delivery status before any retry.',
        });
      }
    }
    const status = batchStatus(results);
    const completed = await db.$transaction(async (tx) => {
      const value = await tx.syncRun.update({
        where: { id: run.id },
        data: { status, completedAt: new Date(), results },
      });
      await tx.auditLog.create({
        data: {
          actor,
          action: 'SYNC_ALL_COMPLETE',
          entityType: 'SyncRun',
          entityId: run.id,
          details: `${trigger} sync ${status}; ${results.map((r) => `${r.provider}: ${r.status}`).join(', ')}. Reporting sync is read-only; separately approved affiliate email automation may send.`,
        },
      });
      return value;
    });
    return { skipped: false, runId: completed.id, status, results };
  } finally {
    if (acquired) await connection.query('SELECT pg_advisory_unlock(74182358)').catch(() => {});
    await connection.end();
  }
}
