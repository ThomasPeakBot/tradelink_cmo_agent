import { z } from 'zod';
export const todayGuideSchema = z
  .object({
    inputs: z.array(z.string().min(1).max(400)).min(1).max(5),
    steps: z
      .array(
        z
          .object({
            title: z.string().min(1).max(100),
            instruction: z.string().min(1).max(600),
            minutes: z.number().int().min(1).max(120),
          })
          .strict(),
      )
      .min(3)
      .max(6),
    aiPrompts: z
      .array(
        z
          .object({
            title: z.string().min(1).max(120),
            tool: z.enum(['ChatGPT / Codex', 'CMO chat', 'Higgsfield', 'Browser assistant']),
            prompt: z.string().min(1).max(3000),
            requiredInputs: z.array(z.string().max(300)).max(5),
          })
          .strict(),
      )
      .min(1)
      .max(2),
    definitionOfDone: z.array(z.string().min(1).max(300)).min(1).max(5),
    approvalBoundary: z.string().min(1).max(600),
  })
  .strict();
export type TodayGuide = z.infer<typeof todayGuideSchema>;
export const todayGuideJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    inputs: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string', maxLength: 400 } },
    steps: {
      type: 'array',
      minItems: 3,
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', maxLength: 100 },
          instruction: { type: 'string', maxLength: 600 },
          minutes: { type: 'integer', minimum: 1, maximum: 120 },
        },
        required: ['title', 'instruction', 'minutes'],
      },
    },
    aiPrompts: {
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', maxLength: 120 },
          tool: {
            type: 'string',
            enum: ['ChatGPT / Codex', 'CMO chat', 'Higgsfield', 'Browser assistant'],
          },
          prompt: { type: 'string', maxLength: 3000 },
          requiredInputs: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 300 } },
        },
        required: ['title', 'tool', 'prompt', 'requiredInputs'],
      },
    },
    definitionOfDone: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: { type: 'string', maxLength: 300 },
    },
    approvalBoundary: { type: 'string', maxLength: 600 },
  },
  required: ['inputs', 'steps', 'aiPrompts', 'definitionOfDone', 'approvalBoundary'],
};
export function validateGuide(guide: unknown, minutes: number) {
  const parsed = todayGuideSchema.parse(guide);
  if (parsed.steps.reduce((n, s) => n + s.minutes, 0) > minutes)
    throw Error('Step estimates exceed task budget');
  return parsed;
}
export function localTaskGuide(
  task: { title: string; minutes: number; deliverable: string; successMetric: string },
  context: string,
): TodayGuide {
  const a = Math.max(1, Math.floor(task.minutes * 0.15)),
    b = Math.max(1, Math.floor(task.minutes * 0.45)),
    c = Math.max(1, Math.floor(task.minutes * 0.25));
  return {
    inputs: [
      'The task’s cited evidence and its capture dates.',
      'Any approved company copy, assets or data required for this deliverable.',
    ],
    steps: [
      {
        title: 'Gather and verify the inputs',
        minutes: a,
        instruction:
          'Open the cited evidence. Record the source dates and missing inputs. Use verified observations; keep hypotheses and missing attribution explicit.',
      },
      {
        title: 'Ask AI for the first working draft',
        minutes: b,
        instruction:
          `Copy the drafting prompt below into your chosen AI tool. Supply the listed inputs and ask it to produce: ${task.deliverable}`.slice(
            0,
            600,
          ),
      },
      {
        title: 'Review and improve the draft',
        minutes: c,
        instruction:
          'Use the review prompt to check claims, brand fit, source accuracy and usefulness. Correct unsupported statements and choose one focused version.',
      },
      {
        title: 'Save the deliverable and record the outcome',
        minutes: task.minutes - a - b - c,
        instruction:
          `Save the reviewed work and document progress against: ${task.successMetric}. Request separate human approval before publishing, outreach or spending.`.slice(
            0,
            600,
          ),
      },
    ],
    aiPrompts: [
      {
        title: 'Create the working draft',
        tool: 'ChatGPT / Codex',
        requiredInputs: [
          'Paste the cited evidence or attach relevant files.',
          'Supply approved brand/product facts and any missing data.',
        ],
        prompt:
          `Help me complete this TradeLink task: ${task.title}.\nDeliverable: ${task.deliverable}\nSuccess criterion: ${task.successMetric}\nWork budget: ${task.minutes} minutes.\nContext: ${context}\nUse only the evidence I provide; ask for missing inputs. Separate facts, assumptions and recommendations. Produce the actual draft or analysis with a concise checklist of what I should do next. Do not invent performance, customer quotes or product claims. Draft only; do not publish, contact anyone, change campaigns, spend money or perform external actions without my explicit approval.`.slice(
            0,
            3000,
          ),
      },
      {
        title: 'Review and tighten the result',
        tool: 'ChatGPT / Codex',
        requiredInputs: ['Paste the first draft and its sources.'],
        prompt:
          `Review my draft for TradeLink task "${task.title}". The required deliverable is ${task.deliverable}. Success means ${task.successMetric}. Identify unsupported claims, attribution gaps, weak reasoning, unclear CTAs and missing inputs. Return a corrected version plus a short acceptance checklist. Do not execute any external action.`.slice(
            0,
            3000,
          ),
      },
    ],
    definitionOfDone: [
      task.deliverable.slice(0, 300),
      task.successMetric.slice(0, 300),
      'Save the reviewed artifact and record the outcome; keep any external launch separate.',
    ],
    approvalBoundary:
      'AI helps research, analyze and draft. You review and decide. Publishing, outreach, campaigns, spending and other external changes require your separate explicit approval and manual execution.',
  };
}
