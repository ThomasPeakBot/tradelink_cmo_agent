import { z } from 'zod';
const text = z.string().trim().min(1).max(10000);
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Invalid calendar date',
  );
const count = z.coerce.number().int().min(0).max(100000000);
const money = z.coerce.number().min(0).max(1000000000);
export const metricSchema = z.object({
  date,
  subscribers: count,
  newSubs: count,
  churned: count,
  visitors: count,
  mrr: money,
  spend: money,
});
export const channelSchema = z.object({
  date,
  name: text.max(100),
  visitors: count,
  leads: count,
  subscribers: count,
  spend: money,
});
export const experimentSchema = z.object({
  title: text.max(200),
  hypothesis: text,
  channel: text.max(100),
  owner: text.max(100),
  impact: z.coerce.number().int().min(1).max(10),
  confidence: z.coerce.number().int().min(1).max(10),
  ease: z.coerce.number().int().min(1).max(10),
  successMetric: text,
});
export const knowledgeSchema = z.object({
  title: text.max(200),
  category: z.enum(['Company', 'Audience', 'Product', 'Positioning', 'Constraints', 'Other']),
  content: text,
});
export const memorySchema = z.object({
  title: text.max(200),
  kind: z.enum(['DECISION', 'LEARNING', 'CONSTRAINT', 'OBSERVATION']),
  content: text,
});
export const approvalSchema = z.object({
  title: text.max(200),
  actionType: z.enum(['CAMPAIGN', 'BUDGET', 'CONTENT', 'INTEGRATION', 'OTHER']),
  details: text,
});
export const companySchema = z
  .object({
    name: text.max(100),
    description: text,
    goalStart: count.min(1),
    goalTarget: count.min(1),
    goalStartDate: date,
    goalEndDate: date,
  })
  .refine(
    (v) => v.goalTarget > v.goalStart && v.goalEndDate > v.goalStartDate,
    'Target must exceed starting subscribers; end date must follow start date',
  );
