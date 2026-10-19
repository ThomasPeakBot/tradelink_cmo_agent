import { z } from 'zod';
import { db } from '../db';
import {
  settingsId,
  sender,
  templateInput,
  validatePlaceholders,
  render,
  sampleValues,
} from './templates';
import { googleEmailConfiguration, beginGoogleEmail } from './google';
import { initializeAffiliateEmail, importAffiliateSnapshot } from './data';
import { emailReadiness, runAffiliateEmail } from './automation';
export async function affiliateEmailState() {
  const [settings, account, templates, contactCount, suppressed, deliveries, lastSnapshot] =
    await Promise.all([
      db.affiliateMailSettings.findUnique({ where: { id: settingsId } }),
      db.affiliateMailAccount.findUnique({
        where: { id: settingsId },
        select: { email: true, connectedAt: true },
      }),
      db.affiliateMailTemplate.findMany({ orderBy: { id: 'asc' } }),
      db.affiliateMailContact.count({ where: { eligible: true, unsubscribedAt: null } }),
      db.affiliateMailContact.count({ where: { unsubscribedAt: { not: null } } }),
      db.affiliateMailDelivery.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          templateId: true,
          status: true,
          recipient: true,
          subject: true,
          error: true,
          createdAt: true,
          sentAt: true,
        },
      }),
      db.affiliateMailContact.findFirst({
        orderBy: { snapshotAt: 'desc' },
        select: { snapshotAt: true },
      }),
    ]);
  const config = googleEmailConfiguration();
  return {
    sender,
    settings,
    account,
    templates: templates.map((t) => ({
      ...t,
      preview: { subject: render(t.subject, sampleValues), body: render(t.body, sampleValues) },
    })),
    contactCount,
    suppressed,
    deliveries,
    lastSnapshot: lastSnapshot?.snapshotAt ?? null,
    oauthConfigured: config.configured,
    redirectUri: config.redirectUri,
  };
}
const https = z
  .string()
  .url()
  .max(2000)
  .refine((s) => {
    const u = new URL(s);
    return u.protocol === 'https:' && !u.username && !u.password;
  }, 'Use an HTTPS URL');
export async function affiliateEmailAdmin(
  actor: { id: string; email: string },
  body: Record<string, unknown>,
) {
  const action = z.string().parse(body.action);
  if (action === 'initialize') {
    await initializeAffiliateEmail();
    return { ok: true };
  }
  if (action === 'connect') return { authorizationUrl: await beginGoogleEmail(actor.id) };
  if (action === 'import') {
    const input = z
      .object({
        action: z.literal('import'),
        csv: z.string().min(1).max(400000),
        capturedAt: z.string().datetime(),
        verified: z.literal(true),
      })
      .strict()
      .parse(body);
    return {
      imported: await importAffiliateSnapshot(actor.email, input.csv, new Date(input.capturedAt)),
    };
  }
  if (action === 'run') return runAffiliateEmail(actor.email);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(74182365)`;
    if (action === 'edit') {
      const input = templateInput.parse({
        id: body.id,
        version: body.version,
        subject: body.subject,
        body: body.body,
      });
      validatePlaceholders(input.subject);
      validatePlaceholders(input.body);
      const changed = await tx.affiliateMailTemplate.updateMany({
        where: { id: input.id, version: input.version },
        data: {
          subject: input.subject,
          body: input.body,
          version: { increment: 1 },
          approvedVersion: null,
          approvedAt: null,
          approvedBy: null,
        },
      });
      if (!changed.count) throw Error('Template changed in another tab. Refresh before editing.');
      await tx.affiliateMailDelivery.updateMany({
        where: { templateId: input.id, status: 'QUEUED' },
        data: { status: 'CANCELLED', error: 'Template edited; new version requires approval.' },
      });
    } else if (action === 'approve') {
      const input = z
        .object({
          action: z.literal('approve'),
          id: z.string(),
          version: z.number().int().positive(),
          confirmAutomaticSending: z.literal(true),
        })
        .strict()
        .parse(body);
      const changed = await tx.affiliateMailTemplate.updateMany({
        where: { id: input.id, version: input.version },
        data: { approvedVersion: input.version, approvedBy: actor.email, approvedAt: new Date() },
      });
      if (!changed.count) throw Error('Template version changed. Refresh and review again.');
    } else if (action === 'unapprove') {
      const input = z
        .object({ action: z.literal('unapprove'), id: z.string() })
        .strict()
        .parse(body);
      await tx.affiliateMailTemplate.update({
        where: { id: input.id },
        data: { approvedVersion: null, approvedBy: null, approvedAt: null },
      });
      await tx.affiliateMailDelivery.updateMany({
        where: { templateId: input.id, status: 'QUEUED' },
        data: { status: 'CANCELLED', error: 'Approval withdrawn.' },
      });
    } else if (action === 'settings') {
      const input = z
        .object({
          action: z.literal('settings'),
          rulesUrl: https,
          startsAt: z.string().datetime(),
          endsAt: z.string().datetime(),
          footer: z.string().trim().min(10).max(2000),
          rulesConfirmed: z.boolean(),
        })
        .strict()
        .parse(body);
      if (new Date(input.endsAt) <= new Date(input.startsAt))
        throw Error('Competition end must follow its start.');
      await tx.affiliateMailSettings.update({
        where: { id: settingsId },
        data: {
          rulesUrl: input.rulesUrl,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          footer: input.footer,
          rulesConfirmed: input.rulesConfirmed,
          enabled: false,
        },
      });
      await tx.affiliateMailDelivery.updateMany({
        where: { status: 'QUEUED' },
        data: {
          status: 'CANCELLED',
          error: 'Competition settings changed; review before resuming.',
        },
      });
    } else if (action === 'toggle') {
      const input = z
        .object({
          action: z.literal('toggle'),
          enabled: z.boolean(),
          confirmAutomaticSending: z.boolean().optional(),
        })
        .strict()
        .parse(body);
      if (input.enabled) {
        const config = await tx.affiliateMailSettings.findUnique({ where: { id: settingsId } });
        const account = await tx.affiliateMailAccount.findUnique({ where: { id: settingsId } });
        const templates = await tx.affiliateMailTemplate.findMany();
        const contact = await tx.affiliateMailContact.findFirst({
          where: {
            eligible: true,
            unsubscribedAt: null,
            snapshotAt: { gte: new Date(Date.now() - 36 * 3600000), lte: new Date() },
          },
        });
        if (
          input.confirmAutomaticSending !== true ||
          !googleEmailConfiguration().configured ||
          account?.email !== sender ||
          !emailReadiness(config, new Date()) ||
          !contact ||
          !templates.some((t) => t.approvedVersion === t.version)
        )
          throw Error(
            'Connect the mailbox, verify current rules and a fresh permitted affiliate snapshot, and approve at least one template before enabling automatic sends.',
          );
      }
      await tx.affiliateMailSettings.update({
        where: { id: settingsId },
        data: { enabled: input.enabled },
      });
    } else if (action === 'disconnect') {
      await tx.affiliateMailSettings.update({
        where: { id: settingsId },
        data: { enabled: false },
      });
      await tx.affiliateMailAccount.deleteMany({ where: { id: settingsId } });
      await tx.affiliateMailOAuth.deleteMany({});
      await tx.affiliateMailDelivery.updateMany({
        where: { status: 'QUEUED' },
        data: { status: 'CANCELLED', error: 'Mailbox disconnected.' },
      });
    } else throw Error('Unknown affiliate email action.');
    await tx.auditLog.create({
      data: {
        actor: actor.email,
        action: `AFFILIATE_EMAIL_${action.toUpperCase()}`,
        entityType: 'AffiliateMailSettings',
        entityId: settingsId,
        details:
          'Owner changed internal affiliate email configuration. Template approvals authorize future automatic sends only while automation is enabled. No recipients or credentials logged.',
      },
    });
  });
  return { ok: true };
}
