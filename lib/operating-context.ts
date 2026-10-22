import { db } from './db';
export type WorkRecord = {
  id: string;
  title: string;
  status: string;
  reason: string;
  outcome: string;
  date: string;
  prerequisiteTaskIds: string[];
};
export type OperatingContext = {
  unfinishedDeferredWork: WorkRecord[];
  completedWork: WorkRecord[];
  ownerStatements: { id: string; taskId: string | null; date: string; content: string }[];
};
export async function getOperatingContext(userId: string): Promise<OperatingContext> {
  const [unfinished, completed, statements] = await Promise.all([
    db.todayTask.findMany({
      where: { status: 'DEFERRED' },
      include: { plan: { select: { date: true } } },
      orderBy: { plan: { date: 'desc' } },
    }),
    db.todayTask.findMany({
      where: { status: 'COMPLETED' },
      include: { plan: { select: { date: true } } },
      orderBy: { completedAt: 'desc' },
    }),
    db.chatMessage.findMany({
      where: { userId, role: 'user' },
      select: { id: true, taskId: true, createdAt: true, content: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const map = (t: (typeof unfinished)[number]): WorkRecord => ({
    id: t.id,
    title: t.title,
    status: t.status,
    reason: t.deferralReason || (t.status === 'DEFERRED' ? t.outcome : ''),
    outcome: t.outcome,
    date: t.plan.date.toISOString().slice(0, 10),
    prerequisiteTaskIds: Array.isArray(t.prerequisiteTaskIds)
      ? t.prerequisiteTaskIds.filter((v): v is string => typeof v === 'string')
      : [],
  });
  // Keep original owner utterances as attributed evidence, never inferred facts or approvals.
  return {
    unfinishedDeferredWork: unfinished.map(map),
    completedWork: completed.map(map),
    ownerStatements: statements.map((m) => ({
      id: m.id,
      taskId: m.taskId,
      date: m.createdAt.toISOString(),
      content: m.content,
    })),
  };
}
export function continuityEvidence(context: OperatingContext | undefined, query: string) {
  if (!context) return { unfinishedDeferredWork: [], completedWork: [], ownerStatements: [] };
  const terms = new Set(query.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
  const score = (text: string) =>
    [...terms].reduce((n, t) => n + (text.toLowerCase().includes(t) ? 1 : 0), 0);
  const relevant = context.ownerStatements.map((m, index) => ({
    m,
    index,
    score: score(m.content),
  }));
  const constraint =
    /\b(can.?t|cannot|not yet|not ready|waiting|blocked|depends|defer|budget|remember|always|never|prefer|don.t have|do not have)\b/i;
  const retained = new Map<string, OperatingContext['ownerStatements'][number]>();
  for (const x of relevant.slice(0, 12)) retained.set(x.m.id, x.m);
  for (const x of relevant.filter((x) => constraint.test(x.m.content)).slice(0, 40))
    retained.set(x.m.id, x.m);
  for (const x of relevant
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 20))
    retained.set(x.m.id, x.m);
  return {
    unfinishedDeferredWork: context.unfinishedDeferredWork,
    completedWork: context.completedWork,
    ownerStatements: [...retained.values()].map((m) => ({
      ...m,
      content: m.content.slice(0, 3000),
    })),
    note: 'Owner statements are historical owner reports, not verified completion or execution approval. Current task status overrides older deferral memories. Deferred work remains incomplete until an observed completion is recorded.',
  };
}
