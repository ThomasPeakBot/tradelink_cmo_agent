import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { db } from '../lib/db';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
async function main() {
  if (!process.argv.includes('--apply')) throw Error('Explicit --apply required');
  const content = await readFile(
    new URL(
      '../docs/campaigns/tradelink-affiliate-outreach-owner-final-2026-10-19.md',
      import.meta.url,
    ),
    'utf8',
  );
  const original = await readFile(
    new URL(
      '../docs/campaigns/tradelink-affiliate-outreach-gavyn-revision-2026-10-19.txt',
      import.meta.url,
    ),
    'utf8',
  );
  const legacy = await readFile(
    new URL('../docs/campaigns/tradelink-affiliate-outreach-2026-10-19.md', import.meta.url),
    'utf8',
  );
  if (content.length > 10000) throw Error('Final copy exceeds the knowledge editor limit');
  const knowledgeId = 'affiliate-recruitment-review-2026-10-19';
  const memoryId = 'affiliate-recruitment-decisions-2026-10-19';
  const memory =
    'Owner supplied the complete FINAL affiliate recruitment sequence on October 19, 2026. Knowledge ' +
    knowledgeId +
    ' now contains the definitive copy, superseding the previous working draft and assistant-only alternatives. Preserve five email + five DM pairs on Days 1,4,8,13,20 and one contact-form fallback only when direct channels are unavailable. Automated copy without researched personalization; reliable first-name merge fields may be used. Email/DM 3 invites a yes reply for free access; email/DM 5 closes outreach. Product URL usetradelink.com; program URL peakbot.com/tradelink-affiliate/. A malformed encoded quotation mark in email 2 hyperlink was corrected mechanically; wording otherwise retained. Raw final upload and earlier draft were preserved, and previous active knowledge/memory archived. Final copy is editorial authority, not automatic-send approval or verification of commercial claims. Still unconfirmed: full $16 on discounted first month; official competition availability/qualification/scoring (original source described a 500-referred-account trigger, not a verified calendar deadline); free-access terms and fulfillment. Owner revised the five email messages to Gavyn, Community Leader of PeakBot, including correcting a leftover Dillon signature in email 2. Only email subjects and bodies were updated in emailcreator; social DMs, contact-form copy, reply playbook and business-day scheduling there remain unchanged. Those existing non-email channels may still contain previous offer terms and need separate reconciliation. Recruitment mailbox authorization is not established by copy. No conversion results supplied. Separate prospect recruitment from enrolled-affiliate automation. No outreach sent, scheduled, or recipients enrolled by this save.';
  const legacyMemoryHash = 'b1eb658938c23eb31d4548f3db1ed9915ff758eb2b88caa1a860b75ec6a07053';
  const batch = randomUUID();
  const changed = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(74182367)`;
    const k = await tx.knowledge.findUnique({ where: { id: knowledgeId } });
    const m = await tx.memory.findUnique({ where: { id: memoryId } });
    if (
      k &&
      k.content !== content &&
      hash(k.content) !== hash(legacy) &&
      hash(k.content) !== '9f6af01349c15337bc8105fc2c3ed5dd04974c038c638fe3b2e18265c03c26f5'
    )
      throw Error('Knowledge was independently edited; preserve for review.');
    if (
      m &&
      m.content !== memory &&
      hash(m.content) !== legacyMemoryHash &&
      hash(m.content) !== '07e637df107b47a7d12931df74c2cd125d0c6bcbe73fc325ff2dc24d2548f4f9'
    )
      throw Error('Memory was independently edited; preserve for review.');
    if (k?.content === content && m?.content === memory) return false;
    for (const [type, row] of [
      ['Knowledge', k],
      ['Memory', m],
    ] as const) {
      if (row)
        await tx.demoArchive.create({
          data: {
            id: `${batch}:${type}:${row.id}`,
            batchId: batch,
            recordType: type,
            recordId: row.id,
            data: JSON.parse(JSON.stringify(row)),
          },
        });
    }
    const knowledge = {
      title: 'Affiliate recruitment outreach — definitive owner copy, October 19, 2026',
      category: 'Other',
      content,
      isDemo: false,
    };
    await tx.knowledge.upsert({
      where: { id: knowledgeId },
      create: { id: knowledgeId, ...knowledge },
      update: knowledge,
    });
    const decision = {
      title: 'Owner final: affiliate recruitment sequence and execution boundaries',
      kind: 'DECISION',
      content: memory,
      isDemo: false,
    };
    await tx.memory.upsert({
      where: { id: memoryId },
      create: { id: memoryId, ...decision },
      update: decision,
    });
    await tx.auditLog.create({
      data: {
        actor: 'owner-supplied-final-upload',
        action: 'AFFILIATE_OUTREACH_FINAL_SAVED',
        entityType: 'Knowledge',
        entityId: knowledgeId,
        details: JSON.stringify({
          batch,
          finalSha256: hash(content),
          originalUploadSha256: hash(original),
          previousRecordsArchived: [k, m].filter(Boolean).length,
          mechanicalFix:
            'Email 2 encoded quote removed from hyperlink and leftover Dillon signature corrected to Gavyn',
          externalActions: false,
        }),
      },
    });
    return true;
  });
  console.log(
    'OUTREACH_FINAL_SAVED ' +
      JSON.stringify({
        knowledgeId,
        memoryId,
        changed,
        sha256: hash(content),
        externalActions: false,
      }),
  );
}
main()
  .catch(() => {
    console.error(
      'Final outreach save failed; existing differing records preserved. No credentials logged.',
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
