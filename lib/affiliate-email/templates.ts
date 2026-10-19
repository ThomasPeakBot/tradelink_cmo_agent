import { z } from 'zod';
export const sender = 'experience@peakbot.com';
export const settingsId = 'affiliate-email';
export const fields = [
  'first_name',
  'qualifying_referrals',
  'rank',
  'referral_gap',
  'affiliate_url',
  'leaderboard_url',
  'rules_url',
  'closing_date',
  'snapshot_time',
] as const;
export const templateInput = z
  .object({
    id: z.string().min(1).max(100),
    version: z.number().int().positive(),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .refine((s) => !/[\r\n]/.test(s), 'Subject must be one line'),
    body: z.string().trim().min(1).max(10000),
  })
  .strict();
export function validatePlaceholders(text: string) {
  const remaining = text.replace(/{{\s*([a-z_]+)\s*}}/g, (_match, field) => {
    if (!(fields as readonly string[]).includes(field))
      throw Error(`Unknown template field: ${field}`);
    return '';
  });
  if (/{{|}}/.test(remaining)) throw Error('Invalid template placeholder.');
}
export function render(text: string, values: Record<string, string>) {
  validatePlaceholders(text);
  return text.replace(/{{\s*([a-z_]+)\s*}}/g, (_match, field) => {
    if (!values[field]) throw Error(`Missing required field: ${field}`);
    return values[field];
  });
}
export const defaultTemplates = [
  {
    id: 'affiliate-weekly',
    name: 'Weekly competition update',
    trigger: 'WEEKLY',
    milestone: null,
    subject: 'Your TradeLink affiliate update: {{qualifying_referrals}} qualifying referrals',
    body: 'Hi {{first_name}},\n\nAs of {{snapshot_time}}, you have {{qualifying_referrals}} qualifying referrals and your competition position is {{rank}}.\n\nThe competition closes {{closing_date}}. Review the official rules: {{rules_url}}\n\nFor your next push, share one practical example of how you use TradeLink. Include your affiliate disclosure.\n\nYour affiliate link: {{affiliate_url}}\nLatest standings: {{leaderboard_url}}\n\nThe TradeLink team',
  },
  ...[10, 25, 50, 100].map((n) => ({
    id: `affiliate-milestone-${n}`,
    name: `${n}-referral milestone`,
    trigger: 'MILESTONE',
    milestone: n,
    subject: `You reached ${n} qualifying TradeLink referrals`,
    body: `Hi {{first_name}},\n\nYou have reached ${n} qualifying TradeLink referrals. Thank you for introducing people to TradeLink.\n\nFor your next piece of content, answer a common question from your audience or demonstrate how you use TradeLink. Include your affiliate disclosure.\n\nYour link: {{affiliate_url}}\nYour current standing: {{leaderboard_url}}\nCompetition rules: {{rules_url}}\n\nThe TradeLink team`,
  })),
  {
    id: 'affiliate-rank',
    name: 'Next position within reach',
    trigger: 'RANK',
    milestone: null,
    subject: '{{referral_gap}} qualifying referrals from the next position',
    body: 'Hi {{first_name}},\n\nAs of {{snapshot_time}}, you are {{referral_gap}} qualifying referrals behind the next competition position. Your current position is {{rank}}.\n\nStandings can change. Check the latest leaderboard before planning your next push: {{leaderboard_url}}\n\nConsider sharing a useful product demonstration or answering a common audience question, with your affiliate disclosure.\n\nYour link: {{affiliate_url}}\nOfficial competition rules: {{rules_url}}\n\nThe TradeLink team',
  },
];
export const sampleValues = {
  first_name: 'Alex',
  qualifying_referrals: '25',
  rank: '4',
  referral_gap: '2',
  affiliate_url: 'https://example.com/DEMO-affiliate-link',
  leaderboard_url: 'https://affiliate.peakbot.com/leaderboard',
  rules_url: 'https://example.com/DEMO-rules',
  closing_date: 'DEMO closing date — confirm official rules',
  snapshot_time: 'DEMO snapshot — not live performance',
};
