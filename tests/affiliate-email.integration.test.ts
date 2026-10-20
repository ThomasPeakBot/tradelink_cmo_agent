import {
  syncAffiliateReport,
  permissionId,
  affiliateReportingState,
} from '../lib/affiliate-email/reporting';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '../lib/db';
import { initializeAffiliateEmail, importAffiliateSnapshot } from '../lib/affiliate-email/data';
import { affiliateEmailAdmin, affiliateEmailState } from '../lib/affiliate-email/admin';
import { runAffiliateEmail } from '../lib/affiliate-email/automation';
import { encrypt } from '../lib/affiliate-email/crypto';
import {
  beginGoogleEmail,
  finishGoogleEmail,
  gmailSendScope,
  GmailSendError,
} from '../lib/affiliate-email/google';
const actor = { id: 'affiliate-fixture-admin', email: 'affiliate-fixture@example.invalid' };
const now = new Date();
const header = 'code,email,name,affiliate_url,qualifying_referrals,rank,gap,email_permission\n';
const csv = (count: number) =>
  header + `alex,alex@example.invalid,Alex,https://example.invalid/ref,${count},2,2,yes`;
async function clean() {
  await db.memory.deleteMany({
    where: { id: { in: [permissionId, 'peakbot-affiliate-reporting-failure'] } },
  });
  await db.report.deleteMany({ where: { id: 'peakbot-affiliate-reporting' } });
  await db.affiliateMailDelivery.deleteMany();
  await db.affiliateMailContact.deleteMany();
  await db.affiliateMailAccount.deleteMany();
  await db.affiliateMailOAuth.deleteMany();
  await db.affiliateMailTemplate.deleteMany();
  await db.affiliateMailSettings.deleteMany();
  await db.memory.deleteMany({ where: { id: 'affiliate-email-owner-preferences-2026-10-19' } });
  await db.auditLog.deleteMany({ where: { OR: [{ actor: actor.email }, { actor: actor.id }] } });
}
beforeEach(async () => {
  vi.stubEnv('APP_URL', 'https://cmo.example.invalid');
  vi.stubEnv('GOOGLE_EMAIL_CLIENT_ID', 'fixture-id');
  vi.stubEnv('GOOGLE_EMAIL_CLIENT_SECRET', 'fixture-secret');
  vi.stubEnv('AFFILIATE_EMAIL_ENCRYPTION_KEY', Buffer.alloc(32, 9).toString('base64'));
  await clean();
  await initializeAffiliateEmail();
});
afterEach(async () => {
  await clean();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(() => db.$disconnect());
async function ready() {
  await db.affiliateMailAccount.create({
    data: { email: 'experience@peakbot.com', refreshToken: encrypt('fixture-refresh') },
  });
  await affiliateEmailAdmin(actor, {
    action: 'settings',
    rulesUrl: 'https://example.invalid/rules',
    startsAt: new Date(now.getTime() - 86400000).toISOString(),
    endsAt: new Date(now.getTime() + 30 * 86400000).toISOString(),
    footer: 'TradeLink by PeakBot — fixture sender address',
    rulesConfirmed: true,
  });
  const template = await db.affiliateMailTemplate.findUniqueOrThrow({
    where: { id: 'affiliate-milestone-10' },
  });
  await affiliateEmailAdmin(actor, {
    action: 'approve',
    id: template.id,
    version: template.version,
    confirmAutomaticSending: true,
  });
  await importAffiliateSnapshot(actor.email, csv(9), new Date(now.getTime() - 120000), now);
  await affiliateEmailAdmin(actor, {
    action: 'toggle',
    enabled: true,
    confirmAutomaticSending: true,
  });
}
it('starts paused with editable unapproved templates, version approval is withdrawn on edits, and secrets never appear in dashboard state', async () => {
  const initial = await affiliateEmailState();
  expect(initial.settings?.enabled).toBe(false);
  expect(initial.templates).toHaveLength(6);
  expect(initial.templates.every((t) => t.approvedVersion === null)).toBe(true);
  await expect(
    affiliateEmailAdmin(actor, { action: 'toggle', enabled: true, confirmAutomaticSending: true }),
  ).rejects.toThrow('Connect the mailbox');
  await ready();
  const before = await db.affiliateMailTemplate.findUniqueOrThrow({
    where: { id: 'affiliate-milestone-10' },
  });
  await affiliateEmailAdmin(actor, {
    action: 'edit',
    id: before.id,
    version: before.version,
    subject: 'Revised subject',
    body: before.body,
  });
  const after = await db.affiliateMailTemplate.findUniqueOrThrow({ where: { id: before.id } });
  expect(after.version).toBe(2);
  expect(after.approvedVersion).toBeNull();
  await expect(
    affiliateEmailAdmin(actor, {
      action: 'approve',
      id: before.id,
      version: 1,
      confirmAutomaticSending: true,
    }),
  ).rejects.toThrow('version changed');
  expect(JSON.stringify(await affiliateEmailState())).not.toContain('fixture-refresh');
  expect(JSON.stringify(await affiliateEmailState())).not.toContain('refreshToken');
});
it('uses fresh verified crossings, sends once with approved content, preserves suppressions and enforces pauses', async () => {
  await ready();
  const send = vi.fn().mockResolvedValue('gmail-fixture-message');
  const transport = { accessToken: vi.fn().mockResolvedValue('fixture-access'), send };
  await runAffiliateEmail(actor.email, now, transport);
  expect(send).not.toHaveBeenCalled(); // initial baseline is not a milestone
  await importAffiliateSnapshot(actor.email, csv(10), new Date(now.getTime() - 60000), now);
  await runAffiliateEmail(actor.email, now, transport);
  expect(send).toHaveBeenCalledTimes(1);
  const delivered = await db.affiliateMailDelivery.findFirstOrThrow();
  expect(delivered.status).toBe('SENT');
  expect(delivered.body).toContain('Unsubscribe');
  expect(delivered.subject).toContain('10');
  await runAffiliateEmail(actor.email, now, transport);
  expect(send).toHaveBeenCalledTimes(1);
  await affiliateEmailAdmin(actor, { action: 'toggle', enabled: false });
  expect((await runAffiliateEmail(actor.email, now, transport)).status).toBe('SKIPPED');
  await db.affiliateMailContact.updateMany({ data: { unsubscribedAt: now } });
  await importAffiliateSnapshot(actor.email, csv(11), new Date(now.getTime() - 30000), now);
  expect((await db.affiliateMailContact.findFirstOrThrow()).unsubscribedAt).not.toBeNull();
  await expect(
    importAffiliateSnapshot(actor.email, csv(99), new Date(now.getTime() - 60000), now),
  ).rejects.toThrow('newer snapshot');
});
it('never automatically retries an ambiguous send and holds stale data', async () => {
  await ready();
  await importAffiliateSnapshot(actor.email, csv(10), new Date(now.getTime() - 60000), now);
  const send = vi.fn().mockRejectedValue(new GmailSendError(true));
  const transport = { accessToken: vi.fn().mockResolvedValue('fixture-access'), send };
  await runAffiliateEmail(actor.email, now, transport);
  expect((await db.affiliateMailDelivery.findFirstOrThrow()).status).toBe('UNKNOWN');
  await runAffiliateEmail(actor.email, now, transport);
  expect(send).toHaveBeenCalledTimes(1);
  await db.affiliateMailDelivery.deleteMany();
  await db.affiliateMailContact.updateMany({
    data: { snapshotAt: new Date(now.getTime() - 37 * 3600000) },
  });
  await runAffiliateEmail(actor.email, now, transport);
  expect(send).toHaveBeenCalledTimes(1);
});
it('binds OAuth state to the initiating admin, rejects wrong senders and replay, and stores only encrypted offline credentials', async () => {
  const authorization = new URL(await beginGoogleEmail(actor.id));
  expect(authorization.searchParams.get('scope')).toContain(gmailSendScope);
  expect(authorization.searchParams.get('scope')).not.toContain('gmail.readonly');
  expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
  const state = authorization.searchParams.get('state')!;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'fixture-access',
          refresh_token: 'fixture-offline',
          scope: gmailSendScope,
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ email: 'experience@peakbot.com', email_verified: true })),
    );
  await expect(finishGoogleEmail('other-admin', state, 'code', fetcher)).rejects.toThrow(
    'another session',
  );
  expect(fetcher).not.toHaveBeenCalled();
  await finishGoogleEmail(actor.id, state, 'code', fetcher);
  const account = await db.affiliateMailAccount.findFirstOrThrow();
  expect(account.refreshToken).not.toContain('fixture-offline');
  expect(account.email).toBe('experience@peakbot.com');
  await expect(finishGoogleEmail(actor.id, state, 'code', fetcher)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(2);
  const wrong = new URL(await beginGoogleEmail(actor.id));
  const wrongFetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'fixture-access',
          refresh_token: 'fixture-offline',
          scope: gmailSendScope,
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ email: 'someoneelse@example.invalid', email_verified: true })),
    );
  await expect(
    finishGoogleEmail(actor.id, wrong.searchParams.get('state')!, 'code', wrongFetcher),
  ).rejects.toThrow('experience@peakbot.com');
});
it('holds a second milestone within 24 hours, sends after the cap clears, and cancels queues when approval changes', async () => {
  await ready();
  const transport = {
    accessToken: vi.fn().mockResolvedValue('fixture-access'),
    send: vi.fn().mockResolvedValue('fixture-message'),
  };
  await importAffiliateSnapshot(actor.email, csv(10), new Date(now.getTime() - 60000), now);
  await runAffiliateEmail(actor.email, now, transport);
  expect(transport.send).toHaveBeenCalledTimes(1);
  await affiliateEmailAdmin(actor, {
    action: 'approve',
    id: 'affiliate-milestone-25',
    version: 1,
    confirmAutomaticSending: true,
  });
  await importAffiliateSnapshot(actor.email, csv(25), new Date(now.getTime() - 30000), now);
  await runAffiliateEmail(actor.email, now, transport);
  expect(transport.send).toHaveBeenCalledTimes(1);
  const queued = await db.affiliateMailDelivery.findFirstOrThrow({
    where: { templateId: 'affiliate-milestone-25' },
  });
  expect(queued.status).toBe('QUEUED');
  const template = await db.affiliateMailTemplate.findUniqueOrThrow({
    where: { id: 'affiliate-milestone-25' },
  });
  await affiliateEmailAdmin(actor, {
    action: 'edit',
    id: template.id,
    version: 1,
    subject: 'Your reviewed milestone',
    body: template.body,
  });
  expect(
    (await db.affiliateMailDelivery.findUniqueOrThrow({ where: { id: queued.id } })).status,
  ).toBe('CANCELLED');
  await affiliateEmailAdmin(actor, {
    action: 'approve',
    id: template.id,
    version: 2,
    confirmAutomaticSending: true,
  });
  await runAffiliateEmail(actor.email, new Date(now.getTime() + 24 * 3600000 + 60000), transport);
  expect(transport.send).toHaveBeenCalledTimes(2);
  expect(
    (await db.affiliateMailDelivery.findUniqueOrThrow({ where: { id: queued.id } }))
      .templateVersion,
  ).toBe(2);
});
it('counts definite failed attempts toward the frequency limit so another trigger cannot immediately send', async () => {
  await ready();
  await importAffiliateSnapshot(actor.email, csv(10), new Date(now.getTime() - 60000), now);
  const send = vi.fn().mockRejectedValue(new GmailSendError(false));
  const transport = { accessToken: vi.fn().mockResolvedValue('fixture-access'), send };
  await runAffiliateEmail(actor.email, now, transport);
  expect((await db.affiliateMailDelivery.findFirstOrThrow()).status).toBe('FAILED');
  await affiliateEmailAdmin(actor, {
    action: 'approve',
    id: 'affiliate-milestone-25',
    version: 1,
    confirmAutomaticSending: true,
  });
  await importAffiliateSnapshot(actor.email, csv(25), new Date(now.getTime() - 30000), now);
  await runAffiliateEmail(actor.email, now, transport);
  expect(send).toHaveBeenCalledTimes(1);
  expect(
    (
      await db.affiliateMailDelivery.findFirstOrThrow({
        where: { templateId: 'affiliate-milestone-25' },
      })
    ).status,
  ).toBe('QUEUED');
});

it('syncs complete API snapshots by stable ID, preserves unsubscribes across code changes and holds sending on failure', async () => {
  vi.stubEnv('PEAKBOT_REPORT_KEY', 'fixture-report-key');
  const id = '992f4f28-6a06-5412-b3d3-8ffd85637767';
  const report = (code: string, count: number, seconds: number) => ({
    asOf: new Date(Date.now() - seconds * 1000).toISOString(),
    product: 'TradeLink',
    campaignId: '6f1c2a7e-0000-4000-8000-000000000000',
    countingRuleVersion: 'v1',
    totalAffiliates: 1,
    affiliates: [
      {
        affiliateId: id,
        code,
        rank: 1,
        activeReferralCount: count,
        name: 'Alex',
        email: 'alex@example.invalid',
        referralLink: 'https://example.invalid/ref',
      },
    ],
    nextCursor: null,
  });
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(report('A', 9, 60))))
    .mockResolvedValueOnce(new Response(JSON.stringify(report('B', 10, 30))))
    .mockResolvedValueOnce(new Response('{}', { status: 503 }));
  vi.stubGlobal('fetch', request);
  await expect(syncAffiliateReport(actor.email)).rejects.toThrow('Confirm permission');
  await affiliateEmailAdmin(actor, { action: 'sync-api', confirmProgramEmailPermission: true });
  let contact = await db.affiliateMailContact.findUniqueOrThrow({ where: { id: `peakbot:${id}` } });
  expect(contact.baselineCount).toBe(9);
  expect(contact.previousCount).toBe(9);
  expect((await db.affiliateMailSettings.findFirstOrThrow()).enabled).toBe(false);
  expect(await db.affiliateMailDelivery.count()).toBe(0);
  await db.affiliateMailContact.update({
    where: { id: contact.id },
    data: { unsubscribedAt: now },
  });
  await syncAffiliateReport(actor.email);
  contact = await db.affiliateMailContact.findUniqueOrThrow({ where: { id: contact.id } });
  expect(contact.code).toBe('B');
  expect(contact.count).toBe(10);
  expect(contact.unsubscribedAt).not.toBeNull();
  expect(contact.baselineCount).toBe(9);
  await expect(syncAffiliateReport(actor.email)).rejects.toThrow('HTTP 503');
  expect((await affiliateReportingState()).blocked).toBe(true);
  expect((await db.affiliateMailContact.findFirstOrThrow()).count).toBe(10);
  expect(await db.affiliateMailDelivery.count()).toBe(0);
});
