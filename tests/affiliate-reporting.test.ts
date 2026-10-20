import { expect, it, vi } from 'vitest';
import {
  readAffiliateReport,
  referralGap,
  reportUrl,
  validateReport,
} from '../lib/affiliate-email/reporting';
const now = new Date('2026-10-20T14:00:00Z');
function fixture() {
  return {
    asOf: now.toISOString(),
    product: 'TradeLink',
    campaignId: '6f1c2a7e-0000-4000-8000-000000000000',
    countingRuleVersion: 'v1',
    totalAffiliates: 2,
    affiliates: [
      {
        affiliateId: '992f4f28-6a06-5412-b3d3-8ffd85637767',
        code: 'A',
        rank: 1,
        activeReferralCount: 10,
        name: 'Alex',
        email: 'alex@example.com',
        referralLink: 'https://example.com/ref/a',
      },
      {
        affiliateId: '53afc987-beae-512d-9008-362209d3b718',
        code: 'B',
        rank: 2,
        activeReferralCount: 0,
        name: null,
        email: null,
        referralLink: null,
      },
    ],
    nextCursor: null,
  };
}
it('accepts complete TradeLink reports including zeros and unavailable contact fields', () => {
  expect(validateReport(fixture(), now).affiliates[1].email).toBeNull();
  expect(validateReport({ ...fixture(), product: 'TradeLink by PeakBot' }, now).totalAffiliates).toBe(2);
});
it('rejects partial pages, duplicate IDs, campaign scope drift, unsupported rules and stale data', () => {
  for (const change of [
    { nextCursor: 'next' },
    { totalAffiliates: 3 },
    { product: 'PeakBot' },
    { countingRuleVersion: 'v2' },
    { asOf: '2026-10-01T00:00:00Z' },
    { affiliates: [fixture().affiliates[0], fixture().affiliates[0]] },
  ]) {
    expect(() => validateReport({ ...fixture(), ...change }, now)).toThrow();
  }
});
it('validates competition ranks and computes referrals needed to overtake, including ties', () => {
  const value = fixture();
  value.affiliates[1].rank = 1;
  expect(() => validateReport(value, now)).toThrow('rank');
  expect(referralGap(9, [10, 9, 9, 0])).toBe(2);
  expect(referralGap(10, [10, 10])).toBeNull();
});
it('keeps keys in Authorization, prohibits redirects and sanitizes provider failures without retries', async () => {
  const request = vi.fn().mockResolvedValue(new Response('private provider text', { status: 403 }));
  await expect(readAffiliateReport('fixture-secret', request)).rejects.toThrow('HTTP 403');
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][0]).toBe(reportUrl);
  expect(request.mock.calls[0][0]).not.toContain('fixture-secret');
  expect(request.mock.calls[0][1]).toMatchObject({
    redirect: 'error',
    headers: { Authorization: 'Bearer fixture-secret' },
  });
});
