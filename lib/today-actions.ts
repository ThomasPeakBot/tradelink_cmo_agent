import { assessTaskReadiness } from './task-readiness';
import { generateReplacement } from './today-replacement';
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
  if (body.action === 'complete-deferred') {
    const input = z
      .object({
        action: z.literal('complete-deferred'),
        taskId: id,
        outcome: z.string().trim().min(1).max(3000),
      })
      .strict()
      .parse(body);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(74182360)`;
      const task = await tx.todayTask.findUnique({
        where: { id: input.taskId },
        include: { plan: true },
      });
      if (!task || task.status !== 'DEFERRED')
        throw new TodayError('Choose unfinished deferred work. Refresh Today.');
      await tx.todayTask.update({
        where: { id: task.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          outcome: input.outcome,
          deferralReason: task.deferralReason || task.outcome,
        },
      });
      await tx.dailyPlan.update({
        where: { id: task.planId },
        data: { version: { increment: 1 } },
      });
      await tx.memory.create({
        data: {
          title: `Deferred prerequisite completed: ${task.title}`,
          kind: 'OBSERVATION',
          content: `Owner reports completion of task ${task.id}: ${input.outcome}. Earlier deferral reason: ${task.deferralReason || task.outcome}. Downstream work must still be planned and reviewed separately.`,
          isDemo: task.plan.isDemo,
        },
      });
      await tx.auditLog.create({
        data: {
          actor: actor.email,
          action: 'DEFERRED_PREREQUISITE_COMPLETED',
          entityType: 'TodayTask',
          entityId: task.id,
          details:
            'Owner recorded observed completion; no downstream task or external action executed.',
        },
      });
    });
    return;
  }
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
  let replacement: Awaited<ReturnType<typeof generateReplacement>> | undefined;
  if (body.action === 'task' && body.status === 'DEFERRED') {
    const request = z
      .object({ taskId: id, reason: z.string().trim().min(1).max(2000) })
      .parse(body);
    const plan = await db.dailyPlan.findUniqueOrThrow({
      where: { id: base.planId },
      include: { tasks: true },
    });
    if (plan.version !== base.version)
      throw new TodayError('This plan changed in another tab. Refresh before editing.');
    const task = plan.tasks.find((t) => t.id === request.taskId);
    if (
      !task ||
      task.status === 'COMPLETED' ||
      task.status === 'DEFERRED' ||
      plan.date.toISOString().slice(0, 10) !== easternSchedule().day
    )
      throw new TodayError('Choose an active unfinished task from today’s plan.');
    const available =
      plan.budgetMinutes -
      40 -
      plan.tasks.reduce(
        (n, t) =>
          n +
          (t.id === task.id || t.status === 'DEFERRED'
            ? 0
            : Math.max(t.minutes, t.actualMinutes ?? 0)),
        0,
      );
    if (available < 15)
      throw new TodayError(
        'There is less than 15 minutes left for a replacement. Adjust the plan first.',
      );
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(74182364)`;
      if (
        await tx.auditLog.findFirst({
          where: {
            action: 'TODAY_DEFER_REQUEST',
            entityId: task.id,
            createdAt: { gte: new Date(Date.now() - 60000) },
          },
        })
      )
        throw new TodayError(
          'A replacement was requested recently. Wait one minute before retrying.',
        );
      await tx.auditLog.create({
        data: {
          actor: actor.email,
          action: 'TODAY_DEFER_REQUEST',
          entityType: 'TodayTask',
          entityId: task.id,
          details: 'Requested a replacement proposal; no external action.',
        },
      });
    });
    try {
      replacement = await generateReplacement(await getWorkspace(actor.id), {
        taskId: task.id,
        title: task.title,
        reason: request.reason,
        maximumMinutes: Math.min(180, available),
        existingTitles: plan.tasks.map((t) => t.title),
      });
    } catch {
      throw new TodayError(
        'Could not prepare a replacement. Your current task is unchanged; retry in a minute.',
      );
    }
  }
  let reviewedPrerequisites: string[] | undefined;
  if (body.action === 'task' && body.status === 'APPROVED') {
    const task = await db.todayTask.findUnique({ where: { id: String(body.taskId) } });
    if (!task) throw new TodayError('Task not found.');
    const [checked] = await assessTaskReadiness(
      [
        {
          title: task.title,
          deliverable: task.deliverable,
          prerequisiteTaskIds: Array.isArray(task.prerequisiteTaskIds)
            ? task.prerequisiteTaskIds.filter((v): v is string => typeof v === 'string')
            : [],
        },
      ],
      await getWorkspace(actor.id),
    );
    reviewedPrerequisites = checked.prerequisiteTaskIds;
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
          reason: z.string().trim().min(1).max(2000).optional(),
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
          ...(reviewedPrerequisites ? { prerequisiteTaskIds: reviewedPrerequisites } : {}),
          ...(input.status === 'DEFERRED' ? { deferralReason: input.reason } : {}),
          ...(input.status === 'DEFERRED' ? { outcome: input.reason } : {}),
          ...(input.status === 'COMPLETED'
            ? {
                outcome: input.outcome,
                actualMinutes: input.actualMinutes ?? null,
                completedAt: new Date(),
              }
            : {}),
        },
      });
      if (input.status === 'DEFERRED') {
        if (!input.reason || !replacement || task.status === 'DEFERRED')
          throw new TodayError('A deferral reason and replacement are required.');
        const next = await tx.todayTask.create({
          data: {
            ...replacement.task,
            planId: plan.id,
            position: Math.max(...plan.tasks.map((t) => t.position)) + 1,
            status: 'PROPOSED',
          },
        });
        await tx.memory.create({
          data: {
            id: `today-deferral:${task.id}:${plan.version}`,
            title: `Deferred: ${task.title}`,
            kind: 'OBSERVATION',
            content: `${plan.date.toISOString().slice(0, 10)}. Owner deferred task: ${task.title}. Reason (owner report): ${input.reason}. Alternative proposed: ${next.title}. Source: ${replacement.provider}. Not a completed outcome or external authorization.`,
            isDemo: plan.isDemo,
          },
        });
        await tx.auditLog.create({
          data: {
            actor: actor.email,
            action: 'TODAY_DEFERRED_REPLACED',
            entityType: 'TodayTask',
            entityId: task.id,
            details: `Reason saved to task and memory. Proposed replacement ${next.id}; ${replacement.provider}; no external execution.`,
          },
        });
      }
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
        (n, t) => n + (t.id === task.id ? input.minutes : t.status === 'DEFERRED' ? 0 : t.minutes),
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
