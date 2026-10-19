import { db } from './db';
import { intelligenceProvider, type IntelligenceProvider } from './intelligence';
import { getWorkspace } from './workspace';
import { hasDemoContext } from './demo';
import { TodayError } from './today-actions';
export async function discussTask(
  actor: { id: string; email: string },
  taskId: string,
  prompt: string,
  mode: 'auto' | 'local',
  provider: IntelligenceProvider = intelligenceProvider(mode),
) {
  const task = await db.todayTask.findUnique({ where: { id: taskId }, include: { plan: true } });
  if (!task) throw new TodayError('This task is no longer on the plan. Refresh Today.');
  const messages = (
    await db.chatMessage.findMany({
      where: { userId: actor.id, taskId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 16,
    })
  ).reverse();
  const workspace = await getWorkspace(actor.id);
  const { plan, ...details } = task;
  const result = await provider.generate({
    type: 'CHAT',
    prompt,
    context: workspace,
    taskDiscussion: {
      task: {
        ...details,
        workday: plan.date.toISOString().slice(0, 10),
        planSummary: plan.summary,
        budgetMinutes: plan.budgetMinutes,
      },
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    },
  });
  const isDemo = plan.isDemo || hasDemoContext(workspace);
  await db.$transaction(async (tx) => {
    if (!(await tx.todayTask.findUnique({ where: { id: taskId } })))
      throw new TodayError(
        'This task was reset during the conversation. Refresh Today and ask again.',
      );
    await tx.chatMessage.create({
      data: { userId: actor.id, taskId, role: 'user', content: prompt, isDemo },
    });
    const answer = await tx.chatMessage.create({
      data: {
        userId: actor.id,
        taskId,
        role: 'assistant',
        content: result.content,
        provider: result.provider,
        isDemo,
      },
    });
    await tx.auditLog.create({
      data: {
        actor: actor.email,
        action: 'TASK_DISCUSSION',
        entityType: 'ChatMessage',
        entityId: answer.id,
        details: `Discussed task ${taskId}; no plan changes or external actions.`,
      },
    });
  });
}
