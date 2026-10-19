import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { db } from '../lib/db';
import { attachTaskGuide } from '../lib/today-guidance';
import { easternSchedule } from '../lib/sync-state';
async function main() {
  if (!process.argv.includes('--apply')) throw Error('Explicit --apply required');
  if (process.argv.includes('--migrate')) {
    const result = spawnSync('npm', ['run', 'db:migrate'], { stdio: 'inherit' });
    if (result.status !== 0) throw Error('Migration failed');
  }
  const admin = await db.user.findFirstOrThrow({
    where: { role: 'ADMIN' },
    select: { id: true, email: true },
  });
  const date = new Date(easternSchedule().day);
  const plan = await db.dailyPlan.findUniqueOrThrow({
    where: { date },
    include: { tasks: { orderBy: { position: 'asc' } } },
  });
  for (const task of plan.tasks) {
    if (task.status === 'COMPLETED' || task.guide) continue;
    const current = await db.dailyPlan.findUniqueOrThrow({ where: { id: plan.id } });
    await attachTaskGuide(admin, plan.id, task.id, current.version);
  }
  const refreshed = await db.dailyPlan.findUniqueOrThrow({
    where: { id: plan.id },
    include: { tasks: true },
  });
  console.log(
    'TODAY_GUIDES_READY ' +
      JSON.stringify({
        date: easternSchedule().day,
        tasks: refreshed.tasks.length,
        guides: refreshed.tasks.filter((t) => t.guide).length,
        statusesPreserved: true,
        steps: refreshed.tasks.map(
          (t) => (t.guide as { steps: unknown[] } | null)?.steps.length ?? 0,
        ),
        noExternalExecution: true,
      }),
  );
}
main()
  .catch(() => {
    console.error(
      'Today guide population failed. Existing tasks, statuses and outcomes were preserved. Check OpenAI and current plan status.',
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
