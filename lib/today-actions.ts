import { Prisma } from '@prisma/client';
import { attachTaskGuide } from './today-guidance';
import { z } from 'zod';
import { db } from './db';
import { getWorkspace } from './workspace';
import { generateTodayDraft, todayTaskSchema } from './today-plan';
import { hasDemoContext } from './demo';
import { easternSchedule } from './sync-state';
export class TodayError extends Error {}
const id = z.string().min(1).max(100);
const version = z.number().int().min(1);
export async function todayAction(
  actor: { id: string; email: string },
  body: Record<string, unknown>,
) {
  if (body.action === 'generate') {
    const input = z
      .object({
        action: z.literal('generate'),
        budgetMinutes: z.number().int().min(240).max(300),
        mode: z.enum(['auto', 'local']).default('auto'),
      })
      .strict()
      .parse(body);
    const date = new Date(easternSchedule().day);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(74182359)`;
      if (await tx.dailyPlan.findUnique({ where: { date } }))
        throw new TodayError(
          'Today already has a plan. Edit it instead of replacing completed work.',
        );
      const recent = await tx.auditLog.findFirst({
        where: {
          action: 'TODAY_GENERATE_REQUEST',
          createdAt: { gte: new Date(Date.now() - 60000) },
        },
      });
      if (recent)
        throw new TodayError('A plan was requested recently. Wait one minute before retrying.');
      await tx.auditLog.create({
        data: {
          actor: actor.email,
          action: 'TODAY_GENERATE_REQUEST',
          entityType: 'DailyPlan',
          entityId: easternSchedule().day,
          details: 'Requested a proposed daily work plan; no external execution.',
        },
      });
    });
    const evidenceReadAt = new Date();
    const workspace = await getWorkspace(actor.id);
    let result;
    try {
      result = await generateTodayDraft(workspace, input.budgetMinutes, input.mode);
    } catch {
      throw new TodayError(
        'Today plan generation failed. Retry or choose local evidence mode. No existing plan was overwritten.',
      );
    }
    await db.$transaction(async (tx) => {
      const plan = await tx.dailyPlan.create({
        data: {
          date,
          budgetMinutes: input.budgetMinutes,
          summary: result.draft.summary,
          warnings: result.draft.warnings,
          provider: result.provider,
          isDemo: hasDemoContext(workspace),
          dataAsOf: evidenceReadAt,
          tasks: { create: result.draft.tasks.map((task, position) => ({ ...task, position })) },
        },
      });
      await tx.auditLog.create({
        data: {
          actor: actor.email,
          action: 'TODAY_CREATED',
          entityType: 'DailyPlan',
          entityId: plan.id,
          details: `Created three proposed tasks; budget ${input.budgetMinutes} minutes; no external actions.`,
        },
      });
    });
    return;
  }
  const base = z.object({ planId: id, version }).parse(body);
  if (body.action === 'guide') {
    const request = z
      .object({ action: z.literal('guide'), planId: id, version, taskId: id })
      .strict()
      .parse(body);
    await attachTaskGuide(actor, request.planId, request.taskId, request.version);
    return;
  }
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(74182360)`;
    const plan = await tx.dailyPlan.findUniqueOrThrow({
      where: { id: base.planId },
      include: { tasks: true },
    });
    if (plan.version !== base.version)
      throw new TodayError('This plan changed in another tab. Refresh before editing.');
    if (body.action === 'task') {
      const input = z
        .object({
          action: z.literal('task'),
          planId: id,
          version,
          taskId: id,
          status: z.enum(['APPROVED', 'DEFERRED', 'COMPLETED']),
          outcome: z.string().trim().max(3000).default(''),
          actualMinutes: z.number().int().min(0).max(1440).optional(),
        })
        .strict()
        .parse(body);
      const task = plan.tasks.find((t) => t.id === input.taskId);
      if (!task) throw new TodayError('Task does not belong to this plan.');
      if (task.status === 'COMPLETED')
        throw new TodayError('Completed tasks retain their recorded outcome.');
      if (input.status === 'COMPLETED' && (task.status !== 'APPROVED' || !input.outcome))
        throw new TodayError('Approve the task first and record an outcome before completing it.');
      const planned = plan.tasks.reduce(
        (n, t) => n + ((t.id === task.id ? input.status : t.status) === 'DEFERRED' ? 0 : t.minutes),
        0,
      );
      if (planned > plan.budgetMinutes - 40)
        throw new TodayError(
          'Active tasks exceed the day’s budget after reserving 40 minutes. Edit or defer a task.',
        );
      await tx.todayTask.update({
        where: { id: task.id },
        data: {
          status: input.status,
          ...(input.status === 'COMPLETED'
            ? {
                outcome: input.outcome,
                actualMinutes: input.actualMinutes ?? null,
                completedAt: new Date(),
              }
            : {}),
        },
      });
      if (input.status === 'COMPLETED')
        await tx.memory.create({
          data: {
            id: `today-task:${task.id}`,
            title: `Completed: ${task.title}`,
            kind: 'OBSERVATION',
            content: `${plan.date.toISOString().slice(0, 10)}. Success criterion: ${task.successMetric}. Observed outcome: ${input.outcome}. Actual minutes: ${input.actualMinutes ?? 'not recorded'}. Completion is a user report, not independent proof of success.`,
            isDemo: plan.isDemo,
          },
        });
    } else if (body.action === 'edit') {
      const input = z
        .object({
          action: z.literal('edit'),
          planId: id,
          version,
          taskId: id,
          title: todayTaskSchema.shape.title,
          minutes: todayTaskSchema.shape.minutes,
          deliverable: todayTaskSchema.shape.deliverable,
          successMetric: todayTaskSchema.shape.successMetric,
        })
        .strict()
        .parse(body);
      const task = plan.tasks.find((t) => t.id === input.taskId);
      if (!task || task.status === 'COMPLETED')
        throw new TodayError('Choose an unfinished task from this plan.');
      const total = plan.tasks.reduce(
        (n, t) => n + (t.status === 'DEFERRED' ? 0 : t.id === task.id ? input.minutes : t.minutes),
        0,
      );
      if (total > plan.budgetMinutes - 40)
        throw new TodayError('Edited tasks exceed the day’s work budget.');
      await tx.todayTask.update({
        where: { id: task.id },
        data: {
          title: input.title,
          minutes: input.minutes,
          deliverable: input.deliverable,
          successMetric: input.successMetric,
          status: 'PROPOSED',
          guide: Prisma.DbNull,
        },
      });
    } else if (body.action === 'checkin') {
      const input = z
        .object({
          action: z.literal('checkin'),
          planId: id,
          version,
          checkIn: z.string().trim().min(1).max(4000),
          learning: z.string().trim().min(1).max(4000),
          blockers: z.string().trim().max(2000).default(''),
        })
        .strict()
        .parse(body);
      await tx.dailyPlan.update({
        where: { id: plan.id },
        data: {
          checkIn: input.checkIn,
          learning: input.learning,
          blockers: input.blockers,
          checkedInAt: new Date(),
        },
      });
      const data = {
        title: `Daily check-in · ${plan.date.toISOString().slice(0, 10)}`,
        kind: 'LEARNING',
        content: `Outcomes: ${input.checkIn}\nLearning: ${input.learning}\nBlockers: ${input.blockers || 'None reported'}`,
        isDemo: plan.isDemo,
      };
      await tx.memory.upsert({
        where: { id: `today-checkin:${plan.id}` },
        create: { id: `today-checkin:${plan.id}`, ...data },
        update: data,
      });
    } else throw new TodayError('Unknown Today action.');
    await tx.dailyPlan.update({ where: { id: plan.id }, data: { version: { increment: 1 } } });
    await tx.auditLog.create({
      data: {
        actor: actor.email,
        action: `TODAY_${String(body.action).toUpperCase()}`,
        entityType: 'DailyPlan',
        entityId: plan.id,
        details:
          'Updated internal work plan/check-in. No external action executed; external approvals remain separate.',
      },
    });
  });
}
