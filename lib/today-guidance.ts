import { Prisma } from '@prisma/client';
import { db } from './db';
import { getWorkspace } from './workspace';
import { generateTaskGuide } from './today-guide-ai';
import { easternSchedule } from './sync-state';
export class TodayGuideError extends Error {}
export async function attachTaskGuide(
  actor: { id: string; email: string },
  planId: string,
  taskId: string,
  expectedVersion: number,
) {
  const plan = await db.dailyPlan.findUniqueOrThrow({
    where: { id: planId },
    include: { tasks: true },
  });
  const task = plan.tasks.find((t) => t.id === taskId);
  if (plan.version !== expectedVersion)
    throw new TodayGuideError('This plan changed. Refresh before generating instructions.');
  if (
    !task ||
    plan.date.toISOString().slice(0, 10) !== easternSchedule().day ||
    task.status === 'COMPLETED'
  )
    throw new TodayGuideError('Choose an unfinished task from today’s plan.');
  if (task.guide) return;
  const acquired = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(74182363)`;
    if (
      await tx.auditLog.findFirst({
        where: {
          action: 'TODAY_GUIDE_REQUEST',
          entityId: taskId,
          createdAt: { gte: new Date(Date.now() - 60000) },
        },
      })
    )
      return false;
    await tx.auditLog.create({
      data: {
        actor: actor.email,
        action: 'TODAY_GUIDE_REQUEST',
        entityType: 'TodayTask',
        entityId: taskId,
        details: 'Requested internal instructions and copy-ready prompts; no external action.',
      },
    });
    return true;
  });
  if (!acquired)
    throw new TodayGuideError(
      'Instructions were requested recently. Wait one minute before retrying.',
    );
  let guide;
  try {
    guide = await generateTaskGuide(await getWorkspace(actor.id), task);
  } catch {
    throw new TodayGuideError(
      'AI instructions could not be generated. The task and existing plan were preserved. Retry in a minute.',
    );
  }
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(74182360)`;
    const current = await tx.dailyPlan.findUniqueOrThrow({
      where: { id: planId },
      include: { tasks: true },
    });
    const selected = current.tasks.find((t) => t.id === taskId);
    if (current.version !== expectedVersion || !selected || selected.status === 'COMPLETED')
      throw new TodayGuideError('This task changed during generation. Refresh before retrying.');
    await tx.todayTask.update({
      where: { id: taskId },
      data: { guide: guide as Prisma.InputJsonValue },
    });
    await tx.dailyPlan.update({ where: { id: planId }, data: { version: { increment: 1 } } });
    await tx.auditLog.create({
      data: {
        actor: actor.email,
        action: 'TODAY_GUIDE_SAVED',
        entityType: 'TodayTask',
        entityId: taskId,
        details:
          'Saved inputs, timed steps, copy-ready AI prompts, acceptance checklist and human approval boundary. No external action executed.',
      },
    });
  });
}
