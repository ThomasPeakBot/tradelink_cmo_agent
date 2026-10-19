import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { db } from '../lib/db';

async function main() {
  if (!process.argv.includes('--apply')) throw Error('Explicit --apply required');
  const content = await readFile(
    new URL('../docs/daily-growth-planning-preference-2026-10-19.md', import.meta.url),
    'utf8',
  );
  if (content.length > 10000) throw Error('Knowledge editor limit exceeded');
  const knowledgeId = 'daily-growth-planning-preference-2026-10-19';
  const memoryId = 'daily-growth-planning-decision-2026-10-19';
  const memory = content;
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
        title: 'Standing daily plan preference: 1–2 growth activities or experiments',
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
        title: 'Owner preference: prioritize daily growth work',
        kind: 'DECISION',
        content: memory,
        isDemo: false,
      },
      update: {},
    });
    await tx.auditLog.create({
      data: {
        actor: 'owner-daily-growth-planning-preference',
        action: 'DAILY_GROWTH_PREFERENCE_SAVED',
        entityType: 'Knowledge',
        entityId: knowledgeId,
        details: JSON.stringify({ sha256, memoryId, externalActions: false }),
      },
    });
    return true;
  });
  console.log(
    'DAILY_GROWTH_PREFERENCE_SAVED ' +
      JSON.stringify({ knowledgeId, memoryId, changed, sha256, externalActions: false }),
  );
}
main()
  .catch(() => {
    console.error(
      'Daily growth preference save failed; differing records preserved. No credentials logged.',
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
