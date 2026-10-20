import { z } from 'zod';
import { db } from '../db';

export const reportUrl =
  'https://app.peakbot.com/api/reporting/v1/affiliate-leaderboard?limit=1000';
export const permissionId = 'affiliate-program-email-permission';
const snapshotId = 'peakbot-affiliate-reporting';
const entry = z.object({
  affiliateId: z.string().uuid(),
  code: z.string().min(1).max(100),
  rank: z.number().int().positive(),
  activeReferralCount: z.number().int().min(0).max(10000000),
  name: z.string().trim().min(1).max(120).nullable(),
  email: z.string().trim().toLowerCase().email().max(254).nullable(),
  referralLink: z
    .string()
    .url()
    .refine((value) => {
      const u = new URL(value);
      return u.protocol === 'https:' && !u.username && !u.password;
    })
    .nullable(),
});
const reportSchema = z.object({
  asOf: z.string().datetime(),
  product: z.enum(['TradeLink', 'TradeLink by PeakBot']),
  campaignId: z.string().uuid(),
  countingRuleVersion: z.literal('v1'),
  totalAffiliates: z.number().int().min(0).max(1000),
  affiliates: z.array(entry).max(1000),
  nextCursor: z.null(),
});
export function validateReport(value: unknown, now = new Date()) {
  const report = reportSchema.parse(value);
  const time = new Date(report.asOf).getTime();
  if (time > now.getTime() + 60000 || now.getTime() - time > 36 * 3600000)
    throw Error('Affiliate report timestamp is not current.');
  if (
    report.totalAffiliates !== report.affiliates.length ||
    new Set(report.affiliates.map((a) => a.affiliateId)).size !== report.totalAffiliates ||
    new Set(report.affiliates.map((a) => a.code)).size !== report.totalAffiliates
  )
    throw Error('Affiliate report is incomplete or contains duplicate identities.');
  const sorted = [...report.affiliates].sort(
    (a, b) => b.activeReferralCount - a.activeReferralCount,
  );
  for (const a of report.affiliates) {
    if (a.rank !== 1 + sorted.filter((b) => b.activeReferralCount > a.activeReferralCount).length)
      throw Error('Affiliate report rank does not match its counts.');
  }
  return report;
}
export function referralGap(count: number, allCounts: number[]) {
  const above = allCounts.filter((n) => n > count);
  return above.length ? Math.min(...above) - count + 1 : null;
}
export async function readAffiliateReport(key: string, request: typeof fetch = fetch) {
  let response: Response;
  try {
    response = await request(reportUrl, {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw Error('Affiliate API could not be reached. Previous snapshot retained.');
  }
  if (!response.ok)
    throw Error(
      `Affiliate API returned HTTP ${response.status}. Check reporting access; previous snapshot retained.`,
    );
  try {
    return validateReport(await response.json());
  } catch {
    throw Error(
      'Affiliate API returned an incomplete, stale or unsupported report. Previous snapshot retained.',
    );
  }
}
export async function affiliateReportingState() {
  const [permission, snapshot, failure] = await Promise.all([
    db.memory.findUnique({ where: { id: permissionId } }),
    db.report.findUnique({ where: { id: snapshotId } }),
    db.memory.findUnique({ where: { id: `${snapshotId}-failure` } }),
  ]);
  return {
    configured: !!process.env.PEAKBOT_REPORT_KEY?.trim(),
    permitted: !!permission,
    syncedAt: snapshot?.createdAt ?? null,
    blocked: !!failure,
  };
}
export async function syncAffiliateReport(actor: string) {
  const key = process.env.PEAKBOT_REPORT_KEY?.trim();
  if (!key) throw Error('PEAKBOT_REPORT_KEY is not configured on web.');
  if (!(await db.memory.findUnique({ where: { id: permissionId } })))
    throw Error('Confirm program email permission before syncing recipients.');
  try {
    const report = await readAffiliateReport(key);
    return await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(74182365)`;
        const previousSnapshot = await tx.report.findUnique({ where: { id: snapshotId } });
        if (previousSnapshot) {
          const previous = JSON.parse(previousSnapshot.content);
          if (previous.campaignId !== report.campaignId)
            throw Error('Affiliate campaign changed. Review the new competition before importing.');
          if (new Date(previous.asOf) >= new Date(report.asOf))
            throw Error('Affiliate report is not newer than the saved snapshot.');
        }
        await tx.affiliateMailContact.updateMany({ data: { eligible: false } });
        let imported = 0,
          held = 0;
        const emails = new Set<string>();
        for (const row of report.affiliates) {
          if (!row.email || !row.name || !row.referralLink) {
            held++;
            continue;
          }
          if (emails.has(row.email))
            throw Error('Duplicate recipient emails require identity review.');
          emails.add(row.email);
          const id = `peakbot:${row.affiliateId}`;
          const previous = await tx.affiliateMailContact.findUnique({ where: { id } });
          if (previous && previous.email !== row.email)
            throw Error('Affiliate email changed. Review identity before replacing a recipient.');
          const codeOwner = await tx.affiliateMailContact.findUnique({ where: { code: row.code } });
          const emailOwner = await tx.affiliateMailContact.findUnique({
            where: { email: row.email },
          });
          if ((codeOwner && codeOwner.id !== id) || (emailOwner && emailOwner.id !== id))
            throw Error(
              'Affiliate identity conflicts with an existing recipient. Review before importing.',
            );
          const value = {
            code: row.code,
            email: row.email,
            name: row.name,
            affiliateUrl: row.referralLink,
            count: row.activeReferralCount,
            previousCount: previous?.count ?? row.activeReferralCount,
            rank: row.rank,
            gap: referralGap(
              row.activeReferralCount,
              report.affiliates.map((a) => a.activeReferralCount),
            ),
            snapshotAt: new Date(report.asOf),
            eligible: true,
          };
          await tx.affiliateMailContact.upsert({
            where: { id },
            create: { id, baselineCount: row.activeReferralCount, ...value },
            update: value,
          });
          imported++;
        }
        const content = JSON.stringify({
          asOf: report.asOf,
          campaignId: report.campaignId,
          countingRuleVersion: report.countingRuleVersion,
          totalAffiliates: report.totalAffiliates,
          imported,
          held,
        });
        await tx.report.upsert({
          where: { id: snapshotId },
          create: {
            id: snapshotId,
            type: 'AFFILIATE_API',
            title: 'TradeLink affiliate reporting',
            provider: 'PeakBot',
            content,
          },
          update: { content, createdAt: new Date(report.asOf) },
        });
        await tx.memory.deleteMany({ where: { id: `${snapshotId}-failure` } });
        await tx.auditLog.create({
          data: {
            actor,
            action: 'AFFILIATE_API_SYNC_SUCCESS',
            entityType: 'Report',
            entityId: snapshotId,
            details: `TradeLink v1: ${imported} recipient records refreshed, ${held} held for missing contact fields. Stable affiliate IDs; existing unsubscribes preserved; first import establishes baseline. No email sent by sync.`,
          },
        });
        return {
          imported,
          held,
          capturedAt: report.asOf,
          message: `Affiliate API synced: ${imported} recipients refreshed, ${held} held. No email sent by sync.`,
        };
      },
      { timeout: 30000 },
    );
  } catch (error) {
    await db.memory.upsert({
      where: { id: `${snapshotId}-failure` },
      create: {
        id: `${snapshotId}-failure`,
        title: 'Affiliate sync blocked',
        kind: 'CONSTRAINT',
        content: 'Latest affiliate API sync failed; email sending is held until a successful sync.',
      },
      update: { createdAt: new Date() },
    });
    throw error;
  }
}
