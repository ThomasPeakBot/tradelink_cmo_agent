import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { db } from '../lib/db';
import { getWorkspace } from '../lib/workspace';
import { todayAction } from '../lib/today-actions';
import { assertDeclaredPrerequisites } from '../lib/task-readiness';
import { easternSchedule } from '../lib/sync-state';
let actor: { id: string; email: string };
async function clean() {
  await db.todayTask.deleteMany({ where: { id: 'continuity-test-dependent' } });
  await db.chatMessage.deleteMany({ where: { id: 'continuity-test-message' } });
  await db.memory.deleteMany({
    where: { title: { startsWith: 'Deferred prerequisite completed: Continuity test' } },
  });
  await db.auditLog.deleteMany({ where: { entityId: 'continuity-test-task' } });
  await db.dailyPlan.deleteMany({ where: { id: { startsWith: 'continuity-test-' } } });
}
beforeEach(async () => {
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('TRADELINK_OPENAI_API_KEY', '');
  await clean();
  actor = await db.user.findFirstOrThrow({ select: { id: true, email: true } });
  for (let i = 0; i < 9; i++)
    await db.dailyPlan.create({
      data: {
        id: `continuity-test-${i}`,
        date: new Date(`2001-01-${String(i + 1).padStart(2, '0')}`),
        budgetMinutes: 270,
        summary: 'Historical readiness fixture',
        warnings: [],
        provider: 'test',
        dataAsOf: new Date(),
        isDemo: false,
        ...(i === 0
          ? {
              tasks: {
                create: {
                  id: 'continuity-test-task',
                  position: 0,
                  title: 'Continuity test landing page',
                  minutes: 60,
                  deliverable: 'Build page',
                  successMetric: 'Page exists',
                  rationale: 'Prerequisite',
                  evidence: ['workspace'],
                  status: 'DEFERRED',
                  outcome: 'Waiting on creative assets',
                  deferralReason: 'Waiting on creative assets',
                },
              },
            }
          : {}),
      },
    });
  await db.chatMessage.create({
    data: {
      id: 'continuity-test-message',
      userId: actor.id,
      taskId: 'continuity-test-task',
      role: 'user',
      content: 'We cannot launch until the creative assets are ready.',
      createdAt: new Date('2001-01-01'),
    },
  });
});
afterAll(async () => {
  await clean();
  vi.unstubAllEnvs();
  await db.$disconnect();
});
it('retrieves deferrals and task-chat statements excluded from the seven-plan UI window', async () => {
  const w = await getWorkspace(actor.id);
  expect(
    [...w.today.history, ...(w.today.current ? [w.today.current] : [])]
      .flatMap((p) => p.tasks)
      .some((t) => t.id === 'continuity-test-task'),
  ).toBe(false);
  expect(
    w.operatingContext.unfinishedDeferredWork.find((t) => t.id === 'continuity-test-task')?.reason,
  ).toBe('Waiting on creative assets');
  expect(w.operatingContext.ownerStatements.some((m) => m.id === 'continuity-test-message')).toBe(
    true,
  );
});
it('requires owner-reported completion, preserves original reason and then clears the dependency', async () => {
  const candidate = {
    title: 'Launch downstream campaign',
    deliverable: 'Send traffic',
    prerequisiteTaskIds: ['continuity-test-task'],
  };
  const before = await getWorkspace(actor.id);
  expect(() => assertDeclaredPrerequisites([candidate], before)).toThrow('unfinished');
  await expect(
    todayAction(actor, {
      action: 'complete-deferred',
      taskId: 'continuity-test-task',
      outcome: ' ',
    }),
  ).rejects.toThrow();
  await todayAction(actor, {
    action: 'complete-deferred',
    taskId: 'continuity-test-task',
    outcome: 'Page built and verified by owner in the browser.',
  });
  const after = await getWorkspace(actor.id);
  expect(
    after.operatingContext.unfinishedDeferredWork.some((t) => t.id === 'continuity-test-task'),
  ).toBe(false);
  expect(() => assertDeclaredPrerequisites([candidate], after)).not.toThrow();
  const task = await db.todayTask.findUniqueOrThrow({ where: { id: 'continuity-test-task' } });
  expect(task.deferralReason).toBe('Waiting on creative assets');
  expect(task.status).toBe('COMPLETED');
  expect(task.outcome).toContain('verified by owner');
  await expect(
    todayAction(actor, { action: 'complete-deferred', taskId: task.id, outcome: 'Again' }),
  ).rejects.toThrow('unfinished deferred');
});

it('refuses approval of an existing task with an unfinished prerequisite', async () => {
  const date = new Date(easternSchedule().day);
  let plan = await db.dailyPlan.findUnique({ where: { date } });
  if (!plan)
    plan = await db.dailyPlan.create({
      data: {
        id: 'continuity-test-current',
        date,
        budgetMinutes: 270,
        summary: 'Approval readiness fixture',
        warnings: [],
        provider: 'test',
        isDemo: false,
        dataAsOf: new Date(),
      },
    });
  await db.todayTask.create({
    data: {
      id: 'continuity-test-dependent',
      planId: plan.id,
      position: 999,
      title: 'Launch traffic to the unfinished page',
      minutes: 15,
      deliverable: 'Launch',
      successMetric: 'Measured signups',
      rationale: 'Fixture',
      evidence: ['workspace'],
      prerequisiteTaskIds: ['continuity-test-task'],
    },
  });
  await expect(
    todayAction(actor, {
      action: 'task',
      planId: plan.id,
      version: plan.version,
      taskId: 'continuity-test-dependent',
      status: 'APPROVED',
    }),
  ).rejects.toThrow('prerequisite');
  expect(
    (await db.todayTask.findUniqueOrThrow({ where: { id: 'continuity-test-dependent' } })).status,
  ).toBe('PROPOSED');
});
