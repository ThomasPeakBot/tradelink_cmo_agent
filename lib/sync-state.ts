import { z } from 'zod';
export const syncResultsSchema = z.array(
  z.object({
    provider: z.enum([
      'stripe',
      'x',
      'instagram',
      'x_ads',
      'drive',
      'alerts',
      'affiliate_email',
      'affiliate_data',
    ]),
    status: z.enum(['SUCCESS', 'FAILED', 'SKIPPED']),
    message: z.string(),
  }),
);
export type SyncResult = z.infer<typeof syncResultsSchema>[number];
export function easternSchedule(now = new Date(), hour = 4, exact = false) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    due: exact ? Number(get('hour')) === hour : Number(get('hour')) >= hour,
  };
}
export function batchStatus(results: SyncResult[]) {
  const data = results.filter((r) => r.provider !== 'alerts');
  if (results.some((r) => r.status === 'FAILED'))
    return data.some((r) => r.status === 'SUCCESS') ? 'PARTIAL' : 'FAILED';
  return data.some((r) => r.status === 'SUCCESS') ? 'SUCCESS' : 'SKIPPED';
}
