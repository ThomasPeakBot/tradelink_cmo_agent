import 'dotenv/config';
import { db } from '../lib/db';
import { openAIKey } from '../lib/config';
import { ideaAction, ideaSchema } from '../lib/experiment-ideas';
async function main() {
  if (!process.argv.includes('--apply')) throw Error('Explicit --apply required');
  if (!openAIKey()) throw Error('Live OpenAI configuration is unavailable');
  const actor = await db.user.findFirstOrThrow({
    where: { role: 'ADMIN' },
    select: { id: true, email: true },
  });
  const row = await ideaAction(actor, {
    action: 'generate',
    focus:
      'One genuinely creative TradeLink growth experiment for owner review. Fit a small pilot within our approximate $5,000 monthly planning budget. No external execution.',
  });
  const idea = ideaSchema.parse(JSON.parse(row.content));
  if (row.provider !== 'OpenAI' || row.status !== 'DRAFT')
    throw Error('Live draft verification failed');
  console.log(
    'LIVE_EXPERIMENT_IDEA_VERIFIED ' +
      JSON.stringify({
        id: row.id,
        provider: row.provider,
        status: row.status,
        evidenceCount: idea.evidence.length,
        externalActions: false,
      }),
  );
}
main()
  .catch(() => {
    console.error(
      'LIVE_EXPERIMENT_IDEA_VERIFICATION_FAILED; sanitized diagnostics above. No credentials logged.',
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
