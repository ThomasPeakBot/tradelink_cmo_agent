import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { db } from '../lib/db';

async function main() {
  if (!process.argv.includes('--apply')) throw Error('Explicit --apply required');
  const content = await readFile(
    new URL('../docs/campaigns/tradelink-direct-signup-2026-10-19.md', import.meta.url),
    'utf8',
  );
  if (content.length > 10000) throw Error('Knowledge editor limit exceeded');
  const knowledgeId = 'direct-signup-campaign-2026-10-19';
  const memoryId = 'direct-signup-campaign-decision-2026-10-19';
  const memory =
    'Owner supplied edited TradeLink Direct Signup Campaign on October 19, 2026; authoritative five-email copy is in knowledge ' +
    knowledgeId +
    '. Audience: futures creators/community owners who trade multiple prop-firm accounts. Sender Gavyn, Community Leader, PeakBot. Cadence Days 1,4,8,13,20. Goal signups and product activation. Thomas manages outreach; owner plans to brief him (not confirmed delivered). Emails 1,2,4 offer a discount code by email reply; amount/code/eligibility/expiration/fulfillment unspecified. Do not inherit affiliate discount terms or invent a free trial. Other CTA is Get started with TradeLink, pointing to https://usetradelink.com. Owner edited workflow to connect prop accounts and trade in lead account. Separate alternative to affiliate recruitment for proposed A/B test, not a replacement; allocation, execution and attribution not configured and no results supplied. No outreach sent, scheduled, or emailcreator changes made by this save.';
  const sha256 = createHash('sha256').update(content).digest('hex');
  const changed = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(74182367)`;
    const k = await tx.knowledge.findUnique({ where: { id: knowledgeId } });
    const m = await tx.memory.findUnique({ where: { id: memoryId } });
    if ((k && k.content !== content) || (m && m.content !== memory))
      throw Error('Existing differing records preserved');
    if (k && m) return false;
    await tx.knowledge.upsert({
      where: { id: knowledgeId },
      create: {
        id: knowledgeId,
        title: 'TradeLink Direct Signup Campaign — owner copy, October 19, 2026',
        category: 'Other',
        content,
        isDemo: false,
      },
      update: {},
    });
    await tx.memory.upsert({
      where: { id: memoryId },
      create: {
        id: memoryId,
        title: 'Direct signup outreach: owner copy, discount reply CTA and Thomas handoff',
        kind: 'DECISION',
        content: memory,
        isDemo: false,
      },
      update: {},
    });
    await tx.auditLog.create({
      data: {
        actor: 'owner-edited-direct-signup-copy',
        action: 'DIRECT_SIGNUP_CAMPAIGN_SAVED',
        entityType: 'Knowledge',
        entityId: knowledgeId,
        details: JSON.stringify({ sha256, memoryId, externalActions: false }),
      },
    });
    return true;
  });
  console.log(
    'DIRECT_SIGNUP_CAMPAIGN_SAVED ' +
      JSON.stringify({ knowledgeId, memoryId, changed, sha256, externalActions: false }),
  );
}
main()
  .catch(() => {
    console.error('Direct signup save failed; differing records preserved. No credentials logged.');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
