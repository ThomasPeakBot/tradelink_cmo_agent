import { syncXAds } from '@/lib/x-ads-sync';
import { XAdsReadError } from '@/lib/x-ads';
import { todayAction, TodayError } from '@/lib/today-actions';
import { syncAll, SyncBusyError } from '@/lib/sync-all';
import { syncDrive } from '@/lib/drive-sync';
import { DriveReadError } from '@/lib/drive';
import { syncSocial } from '@/lib/social-sync';
import { socialProviderSchema, SocialReadError } from '@/lib/social';
import { syncStripe } from '@/lib/stripe-sync';
import { StripeReadError } from '@/lib/stripe';
import { readJson, PayloadTooLarge } from '@/lib/http';
import { hasDemoContext } from '@/lib/demo';
import { NextResponse } from 'next/server';
import { openAIKey } from '@/lib/config';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { currentUser, assertOrigin } from '@/lib/auth';
import { db } from '@/lib/db';
import { getWorkspace } from '@/lib/workspace';
import {
  metricSchema,
  channelSchema,
  experimentSchema,
  knowledgeSchema,
  memorySchema,
  approvalSchema,
  companySchema,
} from '@/lib/validation';
import { parseMetricsCsv } from '@/lib/csv';
import { intelligenceProvider } from '@/lib/intelligence';
import { refreshAlerts } from '@/lib/alerts';
export const dynamic = 'force-dynamic';
type Route = { params: Promise<{ resource: string }> };
export async function GET(_request: Request, { params }: Route) {
  const { resource } = await params;
  if (resource === 'health') {
    try {
      await db.$queryRaw`SELECT 1`;
      return NextResponse.json({ status: 'ok' });
    } catch {
      return NextResponse.json({ status: 'unavailable' }, { status: 503 });
    }
  }
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  if (resource !== 'workspace') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(
    {
      ...(await getWorkspace(user.id)),
      user,
      provider: openAIKey() ? 'OpenAI' : 'Local evidence',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
export async function POST(request: Request, { params }: Route) {
  try {
    assertOrigin(request);
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    if (user.role !== 'ADMIN')
      return NextResponse.json({ error: 'Administrator access required' }, { status: 403 });
    const body = z.record(z.unknown()).parse(await readJson(request, 600000));
    const { resource } = await params;
    const audit = (
      tx: Prisma.TransactionClient,
      action: string,
      entityType: string,
      entityId: string,
      details: string,
    ) => tx.auditLog.create({ data: { actor: user.email, action, entityType, entityId, details } });
    if (resource === 'today') {
      await todayAction(user, body);
    } else if (resource === 'sync-all') {
      z.object({}).strict().parse(body);
      return NextResponse.json(await syncAll(user.email, 'MANUAL'));
    } else if (resource === 'x-ads-sync') {
      z.object({}).strict().parse(body);
      await syncXAds(user.email);
    } else if (resource === 'drive-sync') {
      z.object({}).strict().parse(body);
      await syncDrive(user.email);
    } else if (resource === 'social-sync') {
      const { provider } = z.object({ provider: socialProviderSchema }).strict().parse(body);
      await syncSocial(user.email, provider);
    } else if (resource === 'stripe-sync') {
      await syncStripe(user.email);
    } else if (resource === 'metrics') {
      const input = metricSchema.parse(body);
      await db.$transaction(async (tx) => {
        const result = await tx.dailyMetric.upsert({
          where: { date: new Date(input.date) },
          create: { ...input, date: new Date(input.date), source: 'manual' },
          update: { ...input, date: new Date(input.date), source: 'manual', isDemo: false },
        });
        await audit(tx, 'UPSERT', 'DailyMetric', result.id, JSON.stringify(input));
      });
    } else if (resource === 'channels') {
      const { name, date, ...input } = channelSchema.parse(body);
      await db.$transaction(async (tx) => {
        const channel = await tx.channel.upsert({ where: { name }, update: {}, create: { name } });
        const result = await tx.channelMetric.upsert({
          where: { channelId_date: { channelId: channel.id, date: new Date(date) } },
          create: { ...input, date: new Date(date), channelId: channel.id },
          update: { ...input, isDemo: false },
        });
        await audit(tx, 'UPSERT', 'ChannelMetric', result.id, `${name}, ${date}`);
      });
    } else if (resource === 'experiments') {
      if (body.id) {
        const input = z
          .object({
            id: z.string(),
            status: z.enum(['BACKLOG', 'RUNNING', 'COMPLETED', 'CANCELLED']),
            result: z.string().max(10000).default(''),
          })
          .parse(body);
        await db.$transaction(async (tx) => {
          const result = await tx.experiment.update({
            where: { id: input.id },
            data: { status: input.status, result: input.result },
          });
          if (input.status === 'COMPLETED')
            await tx.memory.create({
              data: {
                title: `Experiment: ${result.title}`,
                kind: 'LEARNING',
                content: input.result || 'Completed; outcome needs documentation.',
                isDemo: result.isDemo,
              },
            });
          await audit(
            tx,
            'UPDATE',
            'Experiment',
            result.id,
            `Status ${input.status}; result: ${input.result}`,
          );
        });
      } else {
        const input = experimentSchema.parse(body);
        await db.$transaction(async (tx) => {
          const result = await tx.experiment.create({ data: input });
          await audit(tx, 'CREATE', 'Experiment', result.id, result.title);
        });
      }
    } else if (resource === 'knowledge') {
      const input = knowledgeSchema.parse(body);
      const id = body.id ? z.string().parse(body.id) : undefined;
      await db.$transaction(async (tx) => {
        const result = id
          ? await tx.knowledge.update({ where: { id }, data: { ...input, isDemo: false } })
          : await tx.knowledge.create({ data: input });
        await audit(tx, id ? 'UPDATE' : 'CREATE', 'Knowledge', result.id, JSON.stringify(input));
      });
    } else if (resource === 'memories') {
      const input = memorySchema.parse(body);
      await db.$transaction(async (tx) => {
        const result = await tx.memory.create({ data: input });
        await audit(tx, 'CREATE', 'Memory', result.id, result.title);
      });
    } else if (resource === 'approvals') {
      if (body.id) {
        const input = z
          .object({
            id: z.string(),
            status: z.enum(['APPROVED', 'REJECTED']),
            reviewNote: z.string().trim().min(1).max(5000),
          })
          .parse(body);
        await db.$transaction(async (tx) => {
          const changed = await tx.approval.updateMany({
            where: { id: input.id, status: 'PENDING' },
            data: {
              status: input.status,
              reviewNote: input.reviewNote,
              reviewedAt: new Date(),
              reviewedBy: user.email,
            },
          });
          if (changed.count !== 1)
            throw new Error('This request has already been reviewed or does not exist.');
          const item = await tx.approval.findUniqueOrThrow({ where: { id: input.id } });
          await tx.memory.create({
            data: {
              title: item.title,
              kind: 'DECISION',
              content: `${input.status} by ${user.email}: ${input.reviewNote}. Action remains unexecuted.`,
              isDemo: item.isDemo,
            },
          });
          await audit(
            tx,
            input.status,
            'Approval',
            input.id,
            input.reviewNote + ' — No action executed.',
          );
        });
      } else {
        const input = approvalSchema.parse(body);
        await db.$transaction(async (tx) => {
          const result = await tx.approval.create({ data: { ...input, requestedBy: user.email } });
          await audit(tx, 'REQUEST', 'Approval', result.id, input.title);
        });
      }
    } else if (resource === 'alerts') {
      const input = z.object({ id: z.string() }).parse(body);
      await db.$transaction(async (tx) => {
        await tx.alert.update({ where: { id: input.id }, data: { acknowledged: true } });
        await audit(tx, 'ACKNOWLEDGE', 'Alert', input.id, 'Acknowledged by human');
      });
    } else if (resource === 'company') {
      const input = companySchema.parse(body);
      await db.$transaction(async (tx) => {
        await tx.company.update({
          where: { id: 'tradelink' },
          data: {
            ...input,
            goalStartDate: new Date(input.goalStartDate),
            goalEndDate: new Date(input.goalEndDate),
          },
        });
        await audit(tx, 'UPDATE', 'Company', 'tradelink', JSON.stringify(input));
      });
    } else if (resource === 'import') {
      const input = z
        .object({ csv: z.string().max(500000), overwrite: z.boolean().default(false) })
        .parse(body);
      const records = parseMetricsCsv(input.csv);
      await db.$transaction(
        async (tx) => {
          if (!input.overwrite) {
            const exists = await tx.dailyMetric.count({
              where: { date: { in: records.map((r) => new Date(r.date)) } },
            });
            if (exists)
              throw new Error(
                'Existing dates found. Explicitly enable overwrite to replace those observations.',
              );
          }
          for (const row of records)
            await tx.dailyMetric.upsert({
              where: { date: new Date(row.date) },
              create: { ...row, date: new Date(row.date), source: 'csv' },
              update: { ...row, date: new Date(row.date), source: 'csv', isDemo: false },
            });
          await audit(
            tx,
            'IMPORT',
            'DailyMetric',
            'csv',
            `${records.length} rows; overwrite=${input.overwrite}`,
          );
        },
        { timeout: 20000 },
      );
    } else if (resource === 'chat' || resource === 'reports') {
      const input = z
        .object({
          prompt: z.string().trim().min(1).max(4000),
          type: z.enum(['CHAT', 'DAILY', 'WEEKLY', 'MONTHLY']),
          mode: z.enum(['local', 'auto']).default('auto'),
        })
        .parse(body);
      if ((resource === 'chat') !== (input.type === 'CHAT'))
        throw new Error('Invalid generation type.');
      const since = new Date(Date.now() - 60000);
      const count = await db.auditLog.count({
        where: { actor: user.email, action: 'GENERATE_REQUEST', createdAt: { gte: since } },
      });
      if (count >= 10)
        return NextResponse.json(
          { error: 'Generation limit reached. Try again in a minute.' },
          { status: 429 },
        );
      await db.auditLog.create({
        data: {
          actor: user.email,
          action: 'GENERATE_REQUEST',
          entityType: input.type,
          entityId: user.id,
          details: 'Requested grounded briefing',
        },
      });
      const workspace = await getWorkspace(user.id);
      const result = await intelligenceProvider(input.mode).generate({
        type: input.type,
        prompt: input.prompt,
        context: workspace,
      });
      const isDemo = hasDemoContext(workspace);
      await db.$transaction(async (tx) => {
        if (input.type === 'CHAT') {
          await tx.chatMessage.create({
            data: { role: 'user', content: input.prompt, userId: user.id, isDemo },
          });
          const msg = await tx.chatMessage.create({
            data: {
              role: 'assistant',
              content: result.content,
              provider: result.provider,
              userId: user.id,
              isDemo,
            },
          });
          await audit(tx, 'GENERATE', 'ChatMessage', msg.id, result.provider);
        } else {
          const report = await tx.report.create({
            data: {
              type: input.type,
              title: `${input.type === 'DAILY' ? 'Daily Growth Brief' : input.type === 'WEEKLY' ? 'Weekly CMO Review' : 'Monthly Growth Plan'} · ${new Date().toISOString().slice(0, 10)}`,
              content: result.content,
              provider: result.provider,
              isDemo,
            },
          });
          await audit(tx, 'GENERATE', 'Report', report.id, result.provider);
        }
      });
    } else return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (['metrics', 'import', 'company', 'stripe-sync'].includes(resource))
      await refreshAlerts(user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof XAdsReadError)
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === 'busy' ? 429 : 400 },
      );
    if (error instanceof TodayError)
      return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof SyncBusyError)
      return NextResponse.json({ error: error.message }, { status: 429 });
    if (error instanceof DriveReadError)
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === 'busy' ? 429 : 400 },
      );
    if (error instanceof SocialReadError)
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === 'busy' || error.code === 'rate_limit' ? 429 : 400 },
      );
    if (error instanceof StripeReadError)
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === 'busy' ? 429 : 400 },
      );
    if (error instanceof PayloadTooLarge)
      return NextResponse.json({ error: 'Request exceeds 600 KB' }, { status: 413 });
    if (error instanceof z.ZodError)
      return NextResponse.json(
        { error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
        { status: 400 },
      );
    if (error instanceof Error && error.message === 'INVALID_ORIGIN')
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
    if (error instanceof Prisma.PrismaClientKnownRequestError)
      return NextResponse.json(
        {
          error:
            error.code === 'P2025'
              ? 'Record not found'
              : 'Database operation could not be completed',
        },
        { status: 400 },
      );
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    const message = error instanceof Error ? error.message : 'Request failed';
    const safe =
      /^(CSV |Row |Duplicate date|Existing dates|This request|The OpenAI|Invalid generation)/.test(
        message,
      );
    if (!safe)
      console.error(
        'Workspace request failed:',
        error instanceof Error ? error.name : 'Unknown error',
      );
    return NextResponse.json(
      {
        error: safe
          ? message
          : 'Request could not be completed. Check the submitted data and server configuration.',
      },
      { status: safe ? 400 : 500 },
    );
  }
}
