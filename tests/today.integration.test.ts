import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import { db } from '../lib/db';
import { todayAction } from '../lib/today-actions';
import { easternSchedule } from '../lib/sync-state';
import { getWorkspace } from '../lib/workspace';
let actor: { id: string; email: string };
async function clean() {
  const plans = await db.dailyPlan.findMany({
    select: { id: true, tasks: { select: { id: true } } },
  });
  await db.memory.deleteMany({
    where: {
      id: {
        in: plans.flatMap((p) => [
          `today-checkin:${p.id}`,
          ...p.tasks.map((t) => `today-task:${t.id}`),
        ]),
      },
    },
  });
  await db.memory.deleteMany({ where: { id: { startsWith: 'today-deferral:' } } });
  await db.dailyPlan.deleteMany({});
  await db.auditLog.deleteMany({ where: { action: { startsWith: 'TODAY_' } } });
}
beforeEach(async () => {
  const user = await db.user.findUniqueOrThrow({ where: { email: 'admin@tradelink.local' } });
  actor = { id: user.id, email: user.email };
  await clean();
});
afterEach(clean);
afterAll(() => db.$disconnect());
async function generate() {
  await todayAction(actor, { action: 'generate', budgetMinutes: 270, mode: 'local' });
  return db.dailyPlan.findUniqueOrThrow({
    where: { date: new Date(easternSchedule().day) },
    include: { tasks: { orderBy: { position: 'asc' } } },
  });
}
it('persists a bounded daily plan and refuses regeneration over existing work', async () => {
  const plan = await generate();
  expect(plan.tasks).toHaveLength(3);
  expect(plan.tasks.every((t) => t.status === 'PROPOSED')).toBe(true);
  await expect(
    todayAction(actor, { action: 'generate', budgetMinutes: 240, mode: 'local' }),
  ).rejects.toThrow('already has a plan');
  const w = await getWorkspace(actor.id);
  expect(w.today.current?.id).toBe(plan.id);
});
it('requires approval and an observed outcome, rejects stale edits and preserves completion evidence', async () => {
  const plan = await generate();
  const task = plan.tasks[0];
  const base = { action: 'task', planId: plan.id, version: 1, taskId: task.id };
  await expect(
    todayAction(actor, { ...base, status: 'COMPLETED', outcome: 'Done' }),
  ).rejects.toThrow('Approve');
  await todayAction(actor, { ...base, status: 'APPROVED' });
  await expect(todayAction(actor, { ...base, status: 'DEFERRED', reason: 'Blocked' })).rejects.toThrow('another tab');
  await todayAction(actor, {
    ...base,
    version: 2,
    status: 'COMPLETED',
    outcome: 'Measured baseline; growth result not yet known.',
    actualMinutes: 90,
  });
  expect(await db.memory.count({ where: { id: `today-task:${task.id}` } })).toBe(1);
  await expect(
    todayAction(actor, { ...base, version: 3, status: 'COMPLETED', outcome: 'Duplicate' }),
  ).rejects.toThrow('Completed tasks');
  expect(await db.approval.count({ where: { title: task.title } })).toBe(0);
});
it('enforces work budgets and updates a single end-of-day learning instead of duplicating memory', async () => {
  const plan = await generate();
  const task = plan.tasks[0];
  await expect(
    todayAction(actor, {
      action: 'edit',
      planId: plan.id,
      version: 1,
      taskId: task.id,
      title: task.title,
      minutes: 180,
      deliverable: task.deliverable,
      successMetric: task.successMetric,
    }),
  ).rejects.toThrow('budget');
  const checkin = {
    action: 'checkin',
    planId: plan.id,
    version: 1,
    checkIn: 'Ran one test',
    learning: 'Need a clearer baseline',
    blockers: 'Attribution incomplete',
  };
  await todayAction(actor, checkin);
  await todayAction(actor, {
    ...checkin,
    version: 2,
    learning: 'Reconciled baseline after review',
  });
  expect(await db.memory.count({ where: { id: `today-checkin:${plan.id}` } })).toBe(1);
  expect(
    (await db.memory.findUniqueOrThrow({ where: { id: `today-checkin:${plan.id}` } })).content,
  ).toContain('Reconciled');
});
it('requires a deferral reason and atomically proposes a distinct guided replacement within budget', async () => {
  const plan = await generate();
  const task = plan.tasks[0];
  const request = {
    action: 'task',
    planId: plan.id,
    version: 1,
    taskId: task.id,
    status: 'DEFERRED',
  };
  await expect(todayAction(actor, request)).rejects.toThrow();
  expect((await db.todayTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
    'PROPOSED',
  );
  await todayAction(actor, {
    ...request,
    reason: 'Waiting on access; need something I can draft offline.',
  });
  const updated = await db.dailyPlan.findUniqueOrThrow({
    where: { id: plan.id },
    include: { tasks: true },
  });
  expect(updated.tasks).toHaveLength(4);
  expect(updated.version).toBe(2);
  const deferred = updated.tasks.find((t) => t.id === task.id)!;
  expect(deferred.status).toBe('DEFERRED');
  expect(deferred.outcome).toContain('Waiting on access');
  const replacement = updated.tasks.find((t) => !plan.tasks.some((old) => old.id === t.id))!;
  expect(replacement.status).toBe('PROPOSED');
  expect(replacement.guide).toBeTruthy();
  expect(plan.tasks.map((t) => t.title)).not.toContain(replacement.title);
  expect(
    updated.tasks.filter((t) => t.status !== 'DEFERRED').reduce((n, t) => n + t.minutes, 0),
  ).toBeLessThanOrEqual(230);
  expect(
    (await db.memory.findUniqueOrThrow({ where: { id: `today-deferral:${task.id}:1` } })).content,
  ).toContain('Waiting on access');
  await expect(todayAction(actor, { ...request, reason: 'Repeat' })).rejects.toThrow('another tab');
  expect(await db.todayTask.count({ where: { planId: plan.id } })).toBe(4);
});
