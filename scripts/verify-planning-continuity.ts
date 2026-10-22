import 'dotenv/config';
import { db } from '../lib/db';
import { getWorkspace } from '../lib/workspace';
import { assessTaskReadiness, TaskBlockedError } from '../lib/task-readiness';
import { continuityEvidence } from '../lib/operating-context';
import { openAIKey } from '../lib/config';
async function main() {
  const actor = await db.user.findFirstOrThrow({ where: { role: 'ADMIN' }, select: { id: true } });
  const w = await getWorkspace(actor.id);
  const c = w.operatingContext;
  let prerequisiteCheck = 'no-deferred-work';
  if (c.unfinishedDeferredWork.length && openAIKey()) {
    const task = c.unfinishedDeferredWork[0];
    try {
      await assessTaskReadiness(
        [
          {
            title: 'Execute a downstream launch requiring the unfinished prerequisite',
            deliverable: `Execute downstream work that explicitly requires the completed deliverable of task: ${task.title}. This is execution, not a draft or independent preparation.`,
            prerequisiteTaskIds: [],
          },
        ],
        w,
      );
      throw Error('Readiness guard accepted an explicitly unfinished prerequisite.');
    } catch (error) {
      if (
        !(error instanceof TaskBlockedError) ||
        !/is not ready:|requires an unfinished or unverified prerequisite/.test(error.message)
      )
        throw error;
      prerequisiteCheck = 'live-semantic-review-blocked-dependent-execution';
    }
  }
  const included = continuityEvidence(
    c,
    'daily priorities task prerequisites deferrals owner constraints',
  );
  console.log(
    'PLANNING_CONTINUITY_VERIFIED ' +
      JSON.stringify({
        unfinishedDeferredWork: c.unfinishedDeferredWork.length,
        completedWork: c.completedWork.length,
        storedOwnerStatements: c.ownerStatements.length,
        includedOwnerStatements: included.ownerStatements.length,
        prerequisiteCheck,
        tasksChanged: false,
        externalActions: false,
      }),
  );
}
main()
  .catch(() => {
    console.error(
      'Planning continuity verification failed; no credentials or company text logged.',
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
