import { Client } from 'pg';
import type {
  AffiliateMailContact,
  AffiliateMailSettings,
  AffiliateMailTemplate,
} from '@prisma/client';
import { db } from '../db';
import { easternSchedule } from '../sync-state';
import { settingsId, render, sender } from './templates';
import {
  googleEmailConfiguration,
  gmailAccessToken,
  gmailRaw,
  gmailSend,
  GmailSendError,
} from './google';
import { unsubscribeToken } from './crypto';
export function emailReadiness(settings: AffiliateMailSettings | null, now: Date) {
  if (
    !settings?.rulesConfirmed ||
    !settings.rulesUrl ||
    !settings.footer.trim() ||
    !settings.startsAt ||
    !settings.endsAt
  )
    return false;
  return settings.startsAt <= now && settings.endsAt >= now;
}
export function eventFor(
  template: AffiliateMailTemplate,
  contact: AffiliateMailContact,
  now: Date,
) {
  const day = easternSchedule(now).day;
  const monday = new Date(day);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const week = monday.toISOString().slice(0, 10);
  if (
    template.trigger === 'MILESTONE' &&
    template.milestone &&
    contact.count >= template.milestone &&
    contact.previousCount < template.milestone &&
    contact.baselineCount < template.milestone
  )
    return `milestone:${template.milestone}`;
  if (template.trigger === 'WEEKLY' && new Date(day).getUTCDay() === 1) return `weekly:${week}`;
  if (
    template.trigger === 'RANK' &&
    contact.rank &&
    contact.rank > 1 &&
    contact.gap !== null &&
    contact.gap > 0 &&
    contact.gap <= 3
  )
    return `rank:${week}`;
  return null;
}
export function contactValues(contact: AffiliateMailContact, settings: AffiliateMailSettings) {
  return {
    first_name: contact.name.split(/\s+/)[0],
    qualifying_referrals: String(contact.count),
    rank: contact.rank ? String(contact.rank) : '',
    referral_gap: contact.gap !== null ? String(contact.gap) : '',
    affiliate_url: contact.affiliateUrl,
    leaderboard_url: 'https://affiliate.peakbot.com/leaderboard',
    rules_url: settings.rulesUrl,
    closing_date:
      settings.endsAt?.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        timeZoneName: 'short',
      }) || '',
    snapshot_time: contact.snapshotAt.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      timeZoneName: 'short',
    }),
  };
}
export async function runAffiliateEmail(
  actor: string,
  now = new Date(),
  transport = { accessToken: gmailAccessToken, send: gmailSend },
) {
  const deadline = Date.now() + 120000;
  const connection = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    keepAlive: true,
  });
  let lost = false;
  connection.on('error', () => {
    lost = true;
  });
  await connection.connect();
  let locked = false;
  try {
    locked =
      (await connection.query('SELECT pg_try_advisory_lock(74182366) AS acquired')).rows[0]
        ?.acquired === true;
    if (!locked)
      return {
        status: 'SKIPPED' as const,
        message: 'Affiliate email automation is already running.',
      };
    const settings = await db.affiliateMailSettings.findUnique({ where: { id: settingsId } });
    if (!settings?.enabled)
      return { status: 'SKIPPED' as const, message: 'Affiliate email automation is paused.' };
    if (
      !emailReadiness(settings, now) ||
      !googleEmailConfiguration().configured ||
      !(await db.affiliateMailAccount.findUnique({ where: { id: settingsId } }))
    )
      return {
        status: 'SKIPPED' as const,
        message: 'Mailbox, approved rules, competition window or sender footer is not ready.',
      };
    await db.affiliateMailDelivery.updateMany({
      where: { status: 'SENDING', attemptedAt: { lt: new Date(Date.now() - 10 * 60000) } },
      data: {
        status: 'UNKNOWN',
        error: 'Interrupted send. Check Gmail Sent; never automatically retried.',
      },
    });
    const templates = (await db.affiliateMailTemplate.findMany())
      .filter((t) => t.approvedVersion === t.version)
      .sort((a, b) => (b.milestone ?? 0) - (a.milestone ?? 0));
    const contacts = await db.affiliateMailContact.findMany({
      where: {
        eligible: true,
        unsubscribedAt: null,
        snapshotAt: { gte: new Date(now.getTime() - 36 * 3600000), lte: now },
      },
      orderBy: { id: 'asc' },
      take: 2000,
    });
    let queued = 0;
    for (const contact of contacts) {
      if (Date.now() > deadline) break;
      if (lost) throw Error('Email automation lock lost.');
      for (const template of templates) {
        const event = eventFor(template, contact, now);
        if (!event) continue;
        const eventKey = `${contact.id}:${event}`;
        const existing = await db.affiliateMailDelivery.findUnique({ where: { eventKey } });
        if (existing && (existing.status !== 'CANCELLED' || existing.attemptedAt)) continue;
        const unsubscribeUrl = `${googleEmailConfiguration().origin}/api/affiliate-email/unsubscribe?token=${encodeURIComponent(unsubscribeToken(contact.id))}`;
        let subject: string, body: string;
        try {
          const values = contactValues(contact, settings);
          subject = render(template.subject, values);
          body =
            render(template.body, values) +
            `\n\n${settings.footer}\n\nUnsubscribe from affiliate emails: ${unsubscribeUrl}`;
        } catch {
          continue;
        }
        const data = {
          eventKey,
          contactId: contact.id,
          templateId: template.id,
          templateVersion: template.version,
          subject,
          body,
          recipient: contact.email,
        };
        if (existing)
          await db.affiliateMailDelivery.update({
            where: { id: existing.id },
            data: { ...data, status: 'QUEUED', error: null, createdAt: new Date() },
          });
        else await db.affiliateMailDelivery.create({ data });
        queued++;
        break;
      }
    }
    const pending = await db.affiliateMailDelivery.findMany({
      where: { status: 'QUEUED' },
      orderBy: { createdAt: 'asc' },
      take: 25,
    });
    let sent = 0,
      failed = 0;
    let accessToken: string | undefined;
    for (const delivery of pending) {
      if (Date.now() > deadline) break;
      if (lost) throw Error('Email automation lock lost.');
      const claim = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(74182365)`;
        const config = await tx.affiliateMailSettings.findUnique({ where: { id: settingsId } });
        const template = await tx.affiliateMailTemplate.findUnique({
          where: { id: delivery.templateId },
        });
        const contact = await tx.affiliateMailContact.findUnique({
          where: { id: delivery.contactId },
        });
        if (!config?.enabled || !emailReadiness(config, now)) return null;
        if (
          !contact ||
          !contact.eligible ||
          contact.unsubscribedAt ||
          contact.email !== delivery.recipient ||
          contact.snapshotAt > now ||
          now.getTime() - contact.snapshotAt.getTime() > 36 * 3600000 ||
          !template ||
          template.version !== delivery.templateVersion ||
          template.approvedVersion !== template.version ||
          delivery.createdAt < new Date(now.getTime() - 36 * 3600000) ||
          !(template.trigger === 'MILESTONE' && template.milestone
            ? contact.count >= template.milestone && contact.baselineCount < template.milestone
            : `${contact.id}:${eventFor(template, contact, now)}` === delivery.eventKey)
        ) {
          await tx.affiliateMailDelivery.updateMany({
            where: { id: delivery.id, status: 'QUEUED' },
            data: {
              status: 'CANCELLED',
              error: 'Contact, data freshness, trigger or approval changed.',
            },
          });
          return null;
        }
        const sinceDay = new Date(now.getTime() - 24 * 3600000);
        const sinceWeek = new Date(now.getTime() - 7 * 86400000);
        const attempts = await tx.affiliateMailDelivery.findMany({
          where: {
            contactId: contact.id,
            status: { in: ['SENT', 'SENDING', 'UNKNOWN', 'FAILED'] },
            attemptedAt: { gte: sinceWeek },
          },
        });
        if (attempts.length >= 2 || attempts.some((d) => d.attemptedAt! >= sinceDay)) return null;
        // Render again from current data; a queued draft never supplies outdated recipient facts.
        const values = contactValues(contact, config);
        const unsubscribeUrl = `${googleEmailConfiguration().origin}/api/affiliate-email/unsubscribe?token=${encodeURIComponent(unsubscribeToken(contact.id))}`;
        let subject: string, body: string;
        try {
          subject = render(template.subject, values);
          body =
            render(template.body, values) +
            `\n\n${config.footer}\n\nUnsubscribe from affiliate emails: ${unsubscribeUrl}`;
        } catch {
          return null;
        }
        const claimed = await tx.affiliateMailDelivery.updateMany({
          where: { id: delivery.id, status: 'QUEUED' },
          data: { status: 'SENDING', attemptedAt: new Date(), subject, body },
        });
        return claimed.count ? { contact, subject, body, unsubscribeUrl } : null;
      });
      if (!claim) continue;
      try {
        accessToken ??= await transport.accessToken();
      } catch {
        await db.affiliateMailDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'FAILED',
            error:
              'Mailbox authorization failed before sending. Reconnect Google; no automatic retry.',
          },
        });
        failed++;
        continue;
      }
      try {
        if (lost) throw new GmailSendError(false);
        const providerId = await transport.send(
          accessToken,
          gmailRaw(claim.contact.email, claim.subject, claim.body, claim.unsubscribeUrl),
        );
        await db.affiliateMailDelivery.update({
          where: { id: delivery.id },
          data: { status: 'SENT', sentAt: new Date(), providerId },
        });
        sent++;
      } catch (error) {
        await db.affiliateMailDelivery.update({
          where: { id: delivery.id },
          data: {
            status: error instanceof GmailSendError && !error.ambiguous ? 'FAILED' : 'UNKNOWN',
            error:
              error instanceof GmailSendError
                ? error.message
                : 'Delivery uncertain; inspect Gmail Sent. No automatic retry.',
          },
        });
        failed++;
      }
    }
    await db.auditLog.create({
      data: {
        actor,
        action: 'AFFILIATE_EMAIL_RUN',
        entityType: 'AffiliateMailDelivery',
        entityId: settingsId,
        details: JSON.stringify({ queued, sent, failed, sender, approvedTemplatesOnly: true }),
      },
    });
    return {
      status: failed ? ('FAILED' as const) : ('SUCCESS' as const),
      message: `Affiliate email: ${queued} queued, ${sent} sent, ${failed} failed or uncertain.`,
    };
  } finally {
    if (locked) await connection.query('SELECT pg_advisory_unlock(74182366)').catch(() => {});
    await connection.end();
  }
}
