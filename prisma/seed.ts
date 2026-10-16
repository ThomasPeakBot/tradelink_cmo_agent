import 'dotenv/config';
import { db } from '../lib/db';
import { refreshAlerts } from '../lib/alerts';
import { hashPassword } from '../lib/password';
const day = (offset: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
};
async function main() {
  const isProduction = process.env.NODE_ENV === 'production';
  const email = process.env.ADMIN_EMAIL || 'admin@tradelink.local';
  const password = process.env.ADMIN_PASSWORD || (isProduction ? '' : 'TradeLink-Demo-2026!');
  if (password.length < 16 || (isProduction && password === 'TradeLink-Demo-2026!'))
    throw new Error(
      'Set ADMIN_PASSWORD to a unique password of at least 16 characters before production seeding.',
    );
  const user = await db.user.upsert({
    where: { email: email.toLowerCase() },
    update: {},
    create: {
      email: email.toLowerCase(),
      name: 'TradeLink Operator',
      passwordHash: hashPassword(password),
    },
  });
  await db.company.upsert({
    where: { id: 'tradelink' },
    update: {},
    create: {
      description:
        'TradeLink growth workspace. Company positioning, audience, pricing, and constraints below are demo assumptions awaiting validation.',
      goalStartDate: day(-90),
      goalEndDate: day(275),
    },
  });
  // Stable IDs + create-only upserts preserve all manual edits on repeated seeds.
  for (let i = 0; i < 30; i++) {
    const id = `demo-metric-${i}`;
    const existing = await db.dailyMetric.findUnique({ where: { id } });
    if (existing) continue;
    const date = day(i - 29);
    await db.dailyMetric.upsert({
      where: { date },
      update: {},
      create: {
        id,
        date,
        subscribers: 106 + i * 2 + Math.floor(i / 3),
        newSubs: 3 + (i % 3),
        churned: 1 + (i % 3 === 0 ? 1 : 0),
        visitors: 220 + i * 6,
        mrr: (106 + i * 2 + Math.floor(i / 3)) * 19,
        spend: 45 + (i % 5) * 5,
        source: 'demo-seed',
        isDemo: true,
      },
    });
  }
  for (const [index, name] of [
    'Organic search',
    'LinkedIn',
    'Referral partners',
    'Email',
    'Paid search',
  ].entries()) {
    const channel = await db.channel.upsert({ where: { name }, update: {}, create: { name } });
    for (let i = 0; i < 7; i++)
      await db.channelMetric.upsert({
        where: { channelId_date: { channelId: channel.id, date: day(i - 6) } },
        update: {},
        create: {
          channelId: channel.id,
          date: day(i - 6),
          visitors: 60 + index * 25 + i * 3,
          leads: 12 + index,
          subscribers: Math.max(1, 5 - index) + (i % 2),
          spend: index === 4 ? 95 : index === 1 ? 25 : 0,
          isDemo: true,
        },
      });
  }
  const experiments = [
    {
      title: 'Activate a founding-member referral loop',
      hypothesis:
        'A personal invitation from an active member will convert better than cold acquisition.',
      channel: 'Referral partners',
      owner: 'Growth',
      impact: 9,
      confidence: 8,
      ease: 8,
      successMetric: '20 qualified referred subscribers in 14 days',
      status: 'BACKLOG',
    },
    {
      title: 'Turn product education into a weekly series',
      hypothesis: 'Practical educational content improves qualified discovery and activation.',
      channel: 'LinkedIn',
      owner: 'Content',
      impact: 8,
      confidence: 7,
      ease: 7,
      successMetric: '30 qualified signups in four weeks',
      status: 'RUNNING',
    },
    {
      title: 'Shorten the first-value onboarding journey',
      hypothesis: 'Removing one onboarding step improves activation and lowers early churn.',
      channel: 'Product',
      owner: 'Product',
      impact: 9,
      confidence: 7,
      ease: 6,
      successMetric: 'Increase seven-day activation rate by 10 percentage points',
      status: 'BACKLOG',
    },
    {
      title: 'Test a high-intent search landing page',
      hypothesis: 'A use-case landing page converts high-intent search traffic more efficiently.',
      channel: 'Paid search',
      owner: 'Growth',
      impact: 6,
      confidence: 5,
      ease: 5,
      successMetric: 'CAC below $35 with at least 20 conversions',
      status: 'BACKLOG',
    },
  ];
  for (const [i, e] of experiments.entries())
    await db.experiment.upsert({
      where: { id: `demo-exp-${i}` },
      update: {},
      create: { id: `demo-exp-${i}`, ...e, isDemo: true },
    });
  const knowledge = [
    {
      title: 'Company facts need confirmation',
      category: 'Company',
      content:
        'DEMO PLACEHOLDER: TradeLink is the company name. The 12-month ambition is growth from 50 to 5,000 subscribers. Audience, product details, pricing and positioning have not been supplied in this repository. Replace demo knowledge with approved facts before real planning.',
    },
    {
      title: 'Working audience hypothesis',
      category: 'Audience',
      content:
        'DEMO ASSUMPTION, NOT A VERIFIED FACT: target a focused professional community with recurring practical value. Validate the actual customer profile through interviews before creating campaigns.',
    },
    {
      title: 'Human approval is mandatory',
      category: 'Constraints',
      content:
        'No autonomous external actions in V1. Budget, publishing, campaigns, and live integrations require explicit human approval. Approval does not execute the action; execution is manual outside this app.',
    },
    {
      title: 'Measurement principles',
      category: 'Other',
      content:
        'Use dated subscriber observations and channel-level spend and conversions. Avoid double-counting channel attribution. Demo channel conversions illustrate UI and are not reconciled business accounting.',
    },
  ];
  for (const [i, k] of knowledge.entries())
    await db.knowledge.upsert({
      where: { id: `demo-knowledge-${i}` },
      update: {},
      create: { id: `demo-knowledge-${i}`, ...k, isDemo: true },
    });
  await db.memory.upsert({
    where: { id: 'demo-memory-1' },
    update: {},
    create: {
      id: 'demo-memory-1',
      title: 'Prioritize measurable learning over activity',
      kind: 'DECISION',
      content:
        'DEMO DECISION: focus on a small number of measurable experiments. Every completed experiment should leave a durable learning with a result and next step.',
      isDemo: true,
    },
  });
  await db.memory.upsert({
    where: { id: 'demo-memory-2' },
    update: {},
    create: {
      id: 'demo-memory-2',
      title: 'Referral efficiency needs a larger sample',
      kind: 'OBSERVATION',
      content:
        'DEMO OBSERVATION: referral partners look efficient in the illustrative data, but attribution quality and sample size must be checked before reallocating spend.',
      isDemo: true,
    },
  });
  await db.approval.upsert({
    where: { id: 'demo-approval-1' },
    update: {},
    create: {
      id: 'demo-approval-1',
      title: 'Review referral pilot proposal',
      actionType: 'CAMPAIGN',
      details:
        'DEMO REQUEST: review a two-week referral pilot with 20 qualified subscriber target. No outreach or spend will be executed by this app.',
      requestedBy: user.email,
      isDemo: true,
    },
  });
  await db.alert.upsert({
    where: { key: 'demo-initial' },
    update: {},
    create: {
      key: 'demo-initial',
      title: 'Replace demo assumptions before real decisions',
      severity: 'MEDIUM',
      detail:
        'Metrics, channel observations, experiments and company knowledge contain clearly labeled sample data.',
      isDemo: true,
    },
  });
  await db.auditLog.upsert({
    where: { id: 'demo-seed-audit' },
    update: {},
    create: {
      id: 'demo-seed-audit',
      actor: 'system',
      action: 'SEED',
      entityType: 'Workspace',
      entityId: 'tradelink',
      details: 'Created clearly labeled demo records. Repeated seeding preserves existing records.',
    },
  });
  await refreshAlerts(user.id);
  console.log('Seed complete. Demo data is labeled. Admin account:', email);
}
main().finally(() => db.$disconnect());
