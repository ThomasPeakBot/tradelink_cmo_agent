import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '../lib/db';
import { attachTaskGuide } from '../lib/today-guidance';
import { todayAction } from '../lib/today-actions';
import { easternSchedule } from '../lib/sync-state';
let planId = '';
const actorEmail = 'guide-fixture@example.invalid';
beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('TRADELINK_OPENAI_API_KEY', '');
});
afterEach(async () => {
  if (planId) await db.dailyPlan.deleteMany({ where: { id: planId } });
  await db.auditLog.deleteMany({ where: { actor: actorEmail } });
  vi.unstubAllEnvs();
});
afterAll(() => db.$disconnect());
it('persists a task guide without changing approval/outcomes, rejects stale versions and clears stale instructions after edits', async () => {
  const user = await db.user.findUniqueOrThrow({ where: { email: 'admin@tradelink.local' } });
  const actor = { id: user.id, email: actorEmail };
  const plan = await db.dailyPlan.create({
    data: {
      date: new Date(easternSchedule().day),
      budgetMinutes: 270,
      summary: 'Guide fixture',
      warnings: [],
      provider: 'fixture',
      dataAsOf: new Date(),
      tasks: {
        create: {
          position: 0,
          title: 'Draft a growth test',
          minutes: 60,
          deliverable: 'One focused test brief',
          successMetric: 'Clear baseline and target',
          rationale: 'Verify the constraint',
          evidence: ['growth'],
          status: 'APPROVED',
          outcome: 'Retain this note',
        },
      },
    },
    include: { tasks: true },
  });
  planId = plan.id;
  const task = plan.tasks[0];
  await attachTaskGuide(actor, plan.id, task.id, 1);
  const saved = await db.todayTask.findUniqueOrThrow({ where: { id: task.id } });
  expect(saved.guide).toMatchObject({ steps: expect.any(Array), aiPrompts: expect.any(Array) });
  expect(saved.status).toBe('APPROVED');
  expect(saved.outcome).toBe('Retain this note');
  await expect(attachTaskGuide(actor, plan.id, task.id, 1)).rejects.toThrow('changed');
  await attachTaskGuide(actor, plan.id, task.id, 2);
  expect(
    await db.auditLog.count({ where: { actor: actorEmail, action: 'TODAY_GUIDE_SAVED' } }),
  ).toBe(1);
  await todayAction(actor, {
    action: 'edit',
    planId: plan.id,
    version: 2,
    taskId: task.id,
    title: 'Revise the growth test',
    minutes: 60,
    deliverable: 'Updated brief',
    successMetric: 'Updated criterion',
  });
  expect((await db.todayTask.findUniqueOrThrow({ where: { id: task.id } })).guide).toBeNull();
});
