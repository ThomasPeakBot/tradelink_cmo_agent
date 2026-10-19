import { afterAll, afterEach, expect, it } from 'vitest';
import { db } from '../lib/db';
import { discussTask } from '../lib/task-discussion';
import { getWorkspace } from '../lib/workspace';
import type { IntelligenceRequest } from '../lib/intelligence';
let planId = '';
const actorEmail = 'task-chat-fixture@example.invalid';
afterEach(async () => {
  await db.chatMessage.deleteMany({ where: { taskId: { startsWith: 'discussion-fixture-' } } });
  if (planId) await db.dailyPlan.deleteMany({ where: { id: planId } });
  await db.auditLog.deleteMany({ where: { actor: actorEmail } });
});
afterAll(() => db.$disconnect());
it('persists an isolated per-user task conversation with instructions and follow-up context without modifying the plan', async () => {
  const user = await db.user.findUniqueOrThrow({ where: { email: 'admin@tradelink.local' } });
  const actor = { id: user.id, email: actorEmail };
  const plan = await db.dailyPlan.create({
    data: {
      date: new Date('2026-10-13'),
      budgetMinutes: 270,
      summary: 'Task chat fixture',
      warnings: [],
      provider: 'fixture',
      dataAsOf: new Date(),
      tasks: {
        create: {
          id: 'discussion-fixture-task',
          position: 0,
          title: 'Draft a referral experiment',
          minutes: 60,
          deliverable: 'Reviewable brief',
          successMetric: 'One measurable hypothesis',
          rationale: 'Verify referral growth',
          evidence: ['growth'],
          status: 'PROPOSED',
        },
      },
    },
    include: { tasks: true },
  });
  planId = plan.id;
  await db.chatMessage.create({
    data: {
      userId: 'different-user',
      taskId: plan.tasks[0].id,
      role: 'user',
      content: 'PRIVATE OTHER USER CONTENT',
    },
  });
  await db.chatMessage.create({
    data: {
      userId: user.id,
      taskId: 'discussion-fixture-other',
      role: 'assistant',
      content: 'UNRELATED TASK CONTENT',
    },
  });
  const requests: IntelligenceRequest[] = [];
  const provider = {
    async generate(request: IntelligenceRequest) {
      requests.push(request);
      return {
        content: 'Start by drafting a measurable referral hypothesis.',
        provider: 'fixture',
      };
    },
  };
  await discussTask(actor, plan.tasks[0].id, 'What does the first step mean?', 'auto', provider);
  await discussTask(actor, plan.tasks[0].id, 'Can you give me an example?', 'auto', provider);
  expect(requests[0].taskDiscussion?.task.title).toBe('Draft a referral experiment');
  expect(requests[0].taskDiscussion?.messages).toEqual([]);
  expect(requests[1].taskDiscussion?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  const workspace = await getWorkspace(user.id);
  const thread = workspace.today.history.find((p) => p.id === plan.id)?.tasks[0].discussion;
  expect(thread).toHaveLength(4);
  expect(JSON.stringify(thread)).not.toContain('PRIVATE OTHER USER CONTENT');
  expect(JSON.stringify(thread)).not.toContain('UNRELATED TASK CONTENT');
  expect(workspace.messages.some((m) => m.taskId)).toBe(false);
  expect(await db.dailyPlan.findUnique({ where: { id: planId } })).toMatchObject({ version: 1 });
  expect(await db.todayTask.findUnique({ where: { id: plan.tasks[0].id } })).toMatchObject({
    status: 'PROPOSED',
    outcome: '',
  });
  const count = await db.chatMessage.count({ where: { taskId: plan.tasks[0].id } });
  await expect(
    discussTask(actor, plan.tasks[0].id, 'Retry?', 'auto', {
      async generate() {
        throw Error('Provider failed');
      },
    }),
  ).rejects.toThrow('Provider failed');
  expect(await db.chatMessage.count({ where: { taskId: plan.tasks[0].id } })).toBe(count);
  await expect(discussTask(actor, 'missing-task', 'Explain?', 'auto', provider)).rejects.toThrow(
    'no longer',
  );
});
