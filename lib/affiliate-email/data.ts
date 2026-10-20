import { z } from 'zod';
import { parse } from 'csv-parse/sync';
import { db } from '../db';
import { defaultTemplates, settingsId } from './templates';
export async function initializeAffiliateEmail() {
  await db.affiliateMailSettings.upsert({
    where: { id: settingsId },
    create: { id: settingsId },
    update: {},
  });
  await db.memory.upsert({
    where: { id: 'affiliate-email-owner-preferences-2026-10-19' },
    create: {
      id: 'affiliate-email-owner-preferences-2026-10-19',
      title: 'Owner-confirmed affiliate email workflow',
      kind: 'CONSTRAINT',
      content:
        'Confirmed by owner on October 19, 2026: use experience@peakbot.com on Google Workspace (replaces tradelink@peakbot.com). Keep editable affiliate communication templates in the CMO database/dashboard. Owner wants automatic affiliate emails under explicitly approved template versions and trigger rules, rather than per-email approval. This is a scoped exception to V1 manual external execution for affiliate email only. Gmail connection, verified competition rules, recipient email permissions and fresh referral data are prerequisites. All templates begin as drafts and automation begins paused. No template, competition date, commission rate or recipient has been approved by these preferences.',
      isDemo: false,
    },
    update: {},
  });
  for (const template of defaultTemplates)
    await db.affiliateMailTemplate.upsert({
      where: { id: template.id },
      create: template,
      update: {},
    });
}
const httpsUrl = z
  .string()
  .url()
  .max(2000)
  .refine((s) => {
    const u = new URL(s);
    return u.protocol === 'https:' && !u.username && !u.password;
  }, 'Use an HTTPS URL without credentials');
export const contactSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9_-]{1,100}$/),
    email: z.string().trim().toLowerCase().email().max(254),
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine((s) => !/[\r\n]/.test(s)),
    affiliate_url: httpsUrl,
    qualifying_referrals: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.coerce.number().int().min(0).max(10000000),
    ),
    rank: z.preprocess(
      (v) => (v === '' || v == null ? null : v),
      z.coerce.number().int().positive().nullable(),
    ),
    gap: z.preprocess(
      (v) => (v === '' || v == null ? null : v),
      z.coerce.number().int().min(0).max(10000000).nullable(),
    ),
    email_permission: z.literal('yes'),
  })
  .strict();
export interface AffiliateSnapshotProvider {
  name: string;
  read(): Promise<{ capturedAt: Date; contacts: z.infer<typeof contactSchema>[] }>;
}
export function parseAffiliateCsv(csv: string) {
  const rows = contactSchema
    .array()
    .min(1)
    .max(2000)
    .parse(
      parse(csv, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
        trim: true,
        max_record_size: 12000,
      }),
    );
  if (
    new Set(rows.map((r) => r.code)).size !== rows.length ||
    new Set(rows.map((r) => r.email)).size !== rows.length
  )
    throw Error('Duplicate affiliate codes or email addresses in CSV.');
  return rows;
}
export async function importAffiliateSnapshot(
  actor: string,
  csv: string,
  capturedAt: Date,
  now = new Date(),
) {
  if (
    !Number.isFinite(capturedAt.getTime()) ||
    capturedAt > now ||
    now.getTime() - capturedAt.getTime() > 36 * 3600000
  )
    throw Error('Snapshot must be verified, no more than 36 hours old, and not in the future.');
  const rows = parseAffiliateCsv(csv);
  await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(74182365)`;
      const last = await tx.affiliateMailContact.findFirst({ orderBy: { snapshotAt: 'desc' } });
      if (last && last.snapshotAt >= capturedAt)
        throw Error('Import a newer snapshot; counts and ordering were preserved.');
      await tx.affiliateMailContact.updateMany({ data: { eligible: false } });
      for (const row of rows) {
        const previous = await tx.affiliateMailContact.findUnique({ where: { code: row.code } });
        if (previous && previous.email !== row.email) {
          throw Error('Affiliate email changed. Review identity before replacing a recipient.');
        }
        const value = {
          email: row.email,
          name: row.name,
          affiliateUrl: row.affiliate_url,
          count: row.qualifying_referrals,
          previousCount: previous?.count ?? row.qualifying_referrals,
          rank: row.rank,
          gap: row.gap,
          snapshotAt: capturedAt,
          eligible: true,
        };
        await tx.affiliateMailContact.upsert({
          where: { code: row.code },
          create: { code: row.code, baselineCount: row.qualifying_referrals, ...value },
          update: value,
        });
      }
      await tx.auditLog.create({
        data: {
          actor,
          action: 'AFFILIATE_SNAPSHOT_IMPORTED',
          entityType: 'AffiliateMailContact',
          entityId: settingsId,
          details: `Imported ${rows.length} explicitly permitted affiliate contacts; full snapshot; no emails sent. Source counts are owner-verified competition-qualified referrals, not inferred from Stripe.`,
        },
      });
    },
    { timeout: 30000 },
  );
  return rows.length;
}

export async function affiliateEmailEvidence() {
  const [settings, account, templates, contacts] = await Promise.all([
    db.affiliateMailSettings.findUnique({ where: { id: settingsId } }),
    db.affiliateMailAccount.findUnique({
      where: { id: settingsId },
      select: { email: true, connectedAt: true },
    }),
    db.affiliateMailTemplate.findMany({
      select: {
        id: true,
        name: true,
        trigger: true,
        milestone: true,
        subject: true,
        body: true,
        version: true,
        approvedVersion: true,
        approvedAt: true,
      },
    }),
    db.affiliateMailContact.aggregate({
      where: { eligible: true, unsubscribedAt: null },
      _count: true,
      _max: { snapshotAt: true },
    }),
  ]);
  if (!settings) return null;
  return {
    sender: 'experience@peakbot.com',
    settings,
    mailboxConnected: !!account,
    templates,
    eligibleAffiliateCount: contacts._count,
    snapshotAt: contacts._max.snapshotAt,
    dataSource:
      'Verified affiliate snapshots from PeakBot Reporting API or owner-imported CSV; recipients and credentials excluded from AI evidence.',
    boundary:
      'Only approved template versions and rules can send when automation is explicitly enabled. CMO chat itself cannot send, change templates or enable automation. No recipients or credentials included in this evidence.',
  };
}
