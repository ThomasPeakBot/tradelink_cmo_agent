import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { db } from '../lib/db';
async function main() {
  if (!process.argv.includes('--apply')) throw Error('Explicit --apply required');
  const content = await readFile(
    new URL('../docs/campaigns/tradelink-affiliate-outreach-2026-10-19.md', import.meta.url),
    'utf8',
  );
  const digest = createHash('sha256').update(content).digest('hex');
  const knowledgeId = 'affiliate-recruitment-review-2026-10-19';
  const memoryId = 'affiliate-recruitment-decisions-2026-10-19';
  const memory =
    'Owner concluded affiliate recruitment messaging review on October 19, 2026. Retain five email + five social DM touches paired on Days 1, 4, 8, 13, 20; one contact-form fallback only if direct channels are unavailable. Automated messaging without manually researched personalization. Progression: introduction, offer/bonus, free access, recurring-income examples, final close. Latest owner-selected/working copy and labeled assistant recommendations are in Knowledge ' +
    knowledgeId +
    '. Preserve owner wording; do not represent every suggested edit as approved. Product link usetradelink.com; affiliate details peakbot.com/tradelink-affiliate/ (owner-supplied links, not independently verified). Recruitment copy names Dillon; actual sending mailbox/representation still needs confirmation. Unresolved: full $16 on discounted month one vs $9.60; current competition status, exact definition/scoring of 500 referred accounts (event trigger, no verified calendar deadline); free-access duration and fulfillment. No conversion results supplied. Separate this cold-prospect campaign from enrolled-affiliate automation. No emails/DMs sent or scheduled, templates approved, or task status changed by this review.';
  await db.$transaction(async (tx) => {
    const existingKnowledge = await tx.knowledge.findUnique({ where: { id: knowledgeId } });
    const existingMemory = await tx.memory.findUnique({ where: { id: memoryId } });
    if (existingKnowledge && existingKnowledge.content !== content)
      throw Error('Existing knowledge differs; preserved for review.');
    if (existingMemory && existingMemory.content !== memory)
      throw Error('Existing memory differs; preserved for review.');
    if (!existingKnowledge)
      await tx.knowledge.create({
        data: {
          id: knowledgeId,
          title: 'Affiliate recruitment outreach — reviewed sequence and decisions',
          category: 'Other',
          content,
          isDemo: false,
        },
      });
    if (!existingMemory)
      await tx.memory.create({
        data: {
          id: memoryId,
          title: 'Owner decisions: affiliate recruitment messaging review',
          kind: 'DECISION',
          content: memory,
          isDemo: false,
        },
      });
    if (!existingKnowledge || !existingMemory)
      await tx.auditLog.create({
        data: {
          actor: 'owner-requested-chat-review',
          action: 'AFFILIATE_OUTREACH_REVIEW_SAVED',
          entityType: 'Knowledge',
          entityId: knowledgeId,
          details: JSON.stringify({
            sha256: digest,
            knowledgeId,
            memoryId,
            scope: 'Reviewed copy and decisions only; unresolved claims retained as unconfirmed.',
            externalActions: false,
          }),
        },
      });
  });
  console.log(
    'OUTREACH_REVIEW_SAVED ' +
      JSON.stringify({
        knowledgeId,
        memoryId,
        sha256: digest,
        cadence: 'Days 1,4,8,13,20; email + DM',
        externalActions: false,
      }),
  );
}
main()
  .catch(() => {
    console.error(
      'Outreach review save failed; existing differing records preserved. No credentials logged.',
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
