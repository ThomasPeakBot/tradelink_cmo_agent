import { afterEach, expect, it, vi } from 'vitest';
import { localTaskGuide, validateGuide } from '../lib/today-guide';
import { generateTaskGuide } from '../lib/today-guide-ai';
import type { Workspace } from '../lib/workspace';
afterEach(() => vi.unstubAllEnvs());
const task = {
  title: 'Draft a targeted growth experiment',
  minutes: 60,
  deliverable: 'One source-backed experiment brief',
  successMetric: 'One measurable test and review date',
  rationale: 'Prioritize the constraint',
  evidence: ['growth'],
};
it('provides bounded steps, practical prompts, missing-input requirements and an explicit approval boundary without credentials', () => {
  const guide = localTaskGuide(
    task,
    'TradeLink target 5000; verified current subscriber count unavailable.',
  );
  expect(validateGuide(guide, 60).steps.reduce((n, s) => n + s.minutes, 0)).toBe(60);
  expect(guide.aiPrompts[0].prompt).toContain(task.deliverable);
  expect(guide.aiPrompts[0].prompt).toContain('Do not invent');
  expect(guide.aiPrompts[0].requiredInputs.length).toBeGreaterThan(0);
  expect(guide.approvalBoundary).toContain('separate explicit approval');
  expect(() =>
    validateGuide({ ...guide, steps: guide.steps.map((s) => ({ ...s, minutes: 60 })) }, 60),
  ).toThrow('budget');
});
it('requires usable AI output rather than silently replacing a failed live guide with generic instructions', async () => {
  vi.stubEnv('TRADELINK_OPENAI_API_KEY', 'fixture');
  const context = {
    company: {},
    summary: {},
    today: { current: null, history: [] },
    stripe: {},
    xAds: { snapshot: null },
    social: [],
    drive: { available: false, documents: [] },
    metrics: [],
    channels: [],
    experiments: [],
    priorities: [],
    knowledge: [],
    memories: [],
    approvals: [],
    alerts: [],
    messages: [],
    reports: [],
  } as unknown as Workspace;
  await expect(
    generateTaskGuide(context, task, async () => new Response('{}', { status: 503 })),
  ).rejects.toThrow('unavailable');
});
