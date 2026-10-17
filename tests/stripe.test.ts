import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  StripeReadOnlyProvider,
  stripeScope,
  STRIPE_API_VERSION,
  type StripeSnapshot,
} from '../lib/stripe';
import { stripeMetrics } from '../lib/stripe-evidence';
import { growthSummary } from '../lib/growth';

const key = ['rk', 'live', 'fixtureNotARealCredential'].join('_');
const now = new Date('2026-10-16T12:00:00Z');
const price = (id = 'price_Month', product = 'prod_TradeLink', overrides = {}) => ({
  id,
  livemode: true,
  product,
  currency: 'usd',
  unit_amount: 4000,
  billing_scheme: 'per_unit',
  recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
  ...overrides,
});
const item = (p = price(), quantity = 1) => ({ id: `si_${p.id}`, price: p, quantity });
const subscription = (
  id: string,
  customer: string,
  items = [item()],
  status = 'active',
  extra = {},
) => ({ id, customer, items: { data: items, has_more: false }, status, livemode: true, ...extra });
const line = (product = 'prod_TradeLink', priceId = 'price_Month') => ({
  id: `il_${product}`,
  pricing: { price_details: { product, price: priceId } },
});
const invoice = (id: string, lines = [line()], extra = {}) => ({
  id,
  status: 'paid',
  livemode: true,
  currency: 'usd',
  amount_paid: 4000,
  created: 1,
  status_transitions: { paid_at: now.getTime() / 1000 - 86400 },
  lines: { data: lines, has_more: false },
  ...extra,
});
const page = (data: unknown[], has_more = false) => ({ data, has_more });
type Respond = (url: URL) => unknown | Response;
function transport(respond?: Respond) {
  return vi.fn<typeof fetch>(async (input, options) => {
    const url = new URL(String(input));
    expect(url.origin).toBe('https://api.stripe.com');
    expect(options?.method).toBe('GET');
    expect(options?.redirect).toBe('error');
    expect(options?.cache).toBe('no-store');
    expect((options?.headers as Record<string, string>)['Stripe-Version']).toBe(STRIPE_API_VERSION);
    if (url.pathname === '/v1/subscriptions') expect(url.searchParams.get('price')).toBeTruthy();
    if (url.pathname === '/v1/invoices') expect(url.searchParams.get('customer')).toBeTruthy();
    expect(url.pathname).not.toBe('/v1/customers');
    let result = respond?.(url);
    if (result === undefined) {
      result = url.pathname.startsWith('/v1/products/')
        ? { id: 'prod_TradeLink', livemode: true }
        : url.pathname === '/v1/prices'
          ? page([price()])
          : url.pathname === '/v1/subscriptions'
            ? page([subscription('sub_A', 'cus_A')])
            : url.pathname.startsWith('/v1/customers/')
              ? {
                  id: url.pathname.split('/').at(-1),
                  livemode: true,
                  email: 'private@example.invalid',
                }
              : url.pathname === '/v1/invoices'
                ? page([invoice('in_A')])
                : page([]);
    }
    return result instanceof Response ? result : Response.json(result);
  });
}
beforeEach(() => vi.stubEnv('STRIPE_PRODUCT_IDS', 'prod_TradeLink'));
afterEach(() => vi.unstubAllEnvs());

describe('restricted live Stripe adapter', () => {
  it('requires an explicit product scope and a restricted live key before any request', async () => {
    const fetcher = transport();
    for (const invalid of [
      '',
      ['sk', 'live', 'fullAccess'].join('_'),
      ['rk', 'test', 'sandbox'].join('_'),
    ]) {
      await expect(new StripeReadOnlyProvider(invalid, fetcher).fetchData()).rejects.toThrow(
        'restricted LIVE',
      );
    }
    vi.stubEnv('STRIPE_PRODUCT_IDS', '');
    await expect(new StripeReadOnlyProvider(key, fetcher).fetchData()).rejects.toThrow(
      'STRIPE_PRODUCT_IDS',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('returns only aggregate evidence and pseudonymous scoped customer IDs', async () => {
    const [snapshot] = await new StripeReadOnlyProvider(key, transport(), () => now).fetchData();
    expect(snapshot.customerIds).toEqual(['cus_A']);
    expect(snapshot.grossMrr).toBe(40);
    expect(snapshot.paidInvoiceAmountMonthToDate).toBe(40);
    expect(JSON.stringify(snapshot)).not.toContain(key);
    expect(JSON.stringify(snapshot)).not.toContain('private@example.invalid');
  });
  it('paginates all list endpoints and deduplicates subscribers across multiple subscriptions', async () => {
    const fetcher = transport((url) => {
      const second = url.searchParams.has('starting_after');
      if (url.pathname === '/v1/prices')
        return page(
          [
            price(
              second ? 'price_Year' : 'price_Month',
              'prod_TradeLink',
              second
                ? { unit_amount: 48000, recurring: { interval: 'year', interval_count: 1 } }
                : {},
            ),
          ],
          !second,
        );
      if (url.pathname === '/v1/subscriptions')
        return page(
          [
            subscription(second ? 'sub_B' : 'sub_A', 'cus_A', [
              item(
                second
                  ? price('price_Year', 'prod_TradeLink', {
                      unit_amount: 48000,
                      recurring: { interval: 'year', interval_count: 1 },
                    })
                  : price(),
              ),
            ]),
          ],
          !second,
        );
      if (url.pathname === '/v1/customers')
        return page([{ id: second ? 'cus_Other' : 'cus_A', livemode: true }], !second);
      if (url.pathname === '/v1/invoices')
        return page([invoice(second ? 'in_B' : 'in_A')], !second);
    });
    const [s] = await new StripeReadOnlyProvider(key, fetcher, () => now).fetchData();
    expect(s.grossMrr).toBe(80);
    expect(s.activeSubscriptions).toBe(2);
    expect(s.customerIds).toEqual(['cus_A']);
    expect(s.paidInvoicesMonthToDate).toBe(2);
    expect(
      fetcher.mock.calls.filter(([u]) => new URL(String(u)).searchParams.has('starting_after')),
    ).toHaveLength(5);
  });
  it('includes archived prices and late payments by historical scoped customers without account-wide reads', async () => {
    const fetcher = transport((url) => {
      if (url.pathname === '/v1/prices')
        return page([
          url.searchParams.get('active') === 'false'
            ? price('price_Archived', 'prod_TradeLink', { unit_amount: 3000 })
            : price(),
        ]);
      if (url.pathname === '/v1/subscriptions')
        return page([
          url.searchParams.get('price') === 'price_Archived'
            ? subscription(
                'sub_Old',
                'cus_Old',
                [item(price('price_Archived', 'prod_TradeLink', { unit_amount: 3000 }))],
                'canceled',
              )
            : subscription('sub_A', 'cus_A'),
        ]);
      if (url.pathname === '/v1/invoices' && url.searchParams.get('customer') === 'cus_Old')
        return page([
          invoice('in_OldPaidThisMonth', [line('prod_TradeLink', 'price_Archived')], {
            amount_paid: 3000,
          }),
        ]);
    });
    const [s] = await new StripeReadOnlyProvider(key, fetcher, () => now).fetchData();
    expect(s.customerIds).toEqual(['cus_A']);
    expect(s.grossMrr).toBe(40);
    expect(s.paidInvoiceAmountMonthToDate).toBe(70);
    expect(s.paidInvoicesMonthToDate).toBe(2);
    expect(
      fetcher.mock.calls.some(([u]) => new URL(String(u)).pathname === '/v1/customers/cus_Old'),
    ).toBe(false);
    expect(fetcher.mock.calls.length).toBeLessThan(15);
  });
  it('filters other products and excludes trial, past due, paused, canceled and free customers', async () => {
    const [s] = await new StripeReadOnlyProvider(
      key,
      transport((url) =>
        url.pathname === '/v1/subscriptions'
          ? page([
              subscription('sub_A', 'cus_A'),
              subscription('sub_B', 'cus_B', [item(price('price_Other', 'prod_Other'))]),
              subscription('sub_C', 'cus_C', undefined, 'trialing'),
              subscription('sub_D', 'cus_D', undefined, 'past_due'),
              subscription('sub_E', 'cus_E', undefined, 'canceled'),
              subscription('sub_F', 'cus_F', undefined, 'active', {
                pause_collection: { behavior: 'void' },
              }),
              subscription('sub_G', 'cus_G', [
                item(price('price_Free', 'prod_TradeLink', { unit_amount: 0 })),
              ]),
            ])
          : undefined,
      ),
      () => now,
    ).fetchData();
    expect(s.customerIds).toEqual(['cus_A']);
    expect(s.grossMrr).toBe(40);
    expect(s.trialingSubscriptions).toBe(1);
    expect(s.pastDueSubscriptions).toBe(1);
  });
  it('normalizes quantity and multi-month amounts and labels discounts as gross', async () => {
    const [s] = await new StripeReadOnlyProvider(
      key,
      transport((url) =>
        url.pathname === '/v1/subscriptions'
          ? page([
              subscription(
                'sub_A',
                'cus_A',
                [
                  item(
                    price('price_Quarter', 'prod_TradeLink', {
                      unit_amount: 12000,
                      recurring: { interval: 'month', interval_count: 3 },
                    }),
                    2,
                  ),
                ],
                'active',
                { discounts: ['di_private'] },
              ),
            ])
          : undefined,
      ),
      () => now,
    ).fetchData();
    expect(s.grossMrr).toBe(80);
    expect(s.warnings.join(' ')).toContain('before discounts');
  });
  it.each([
    { currency: 'eur' },
    { billing_scheme: 'tiered' },
    { transform_quantity: { divide_by: 5 } },
    { recurring: { interval: 'month', interval_count: 1, usage_type: 'metered' } },
    { unit_amount: null },
  ])('rejects unsupported price shapes without returning partial totals: %j', async (override) => {
    const fetcher = transport((url) =>
      url.pathname === '/v1/subscriptions'
        ? page([
            subscription('sub_A', 'cus_A', [item(price('price_Bad', 'prod_TradeLink', override))]),
          ])
        : undefined,
    );
    await expect(new StripeReadOnlyProvider(key, fetcher).fetchData()).rejects.toThrow(
      'unsupported pricing',
    );
  });
  it('rejects non-live responses', async () => {
    const fetcher = transport((url) =>
      url.pathname.startsWith('/v1/products/')
        ? { id: 'prod_TradeLink', livemode: false }
        : undefined,
    );
    await expect(new StripeReadOnlyProvider(key, fetcher).fetchData()).rejects.toThrow(
      'non-live data',
    );
  });
  it('paginates nested items and invoice lines instead of silently truncating', async () => {
    const fetcher = transport((url) => {
      if (url.pathname === '/v1/subscriptions')
        return page([subscription('sub_A', 'cus_A', [], 'active', { items: page([], true) })]);
      if (url.pathname === '/v1/subscription_items') return page([item()]);
      if (url.pathname === '/v1/invoices')
        return page([invoice('in_A', [], { lines: page([], true) })]);
      if (url.pathname === '/v1/invoices/in_A/lines') return page([line()]);
    });
    const [s] = await new StripeReadOnlyProvider(key, fetcher, () => now).fetchData();
    expect(s.customerIds).toHaveLength(1);
    expect(s.paidInvoicesMonthToDate).toBe(1);
  });
  it('uses payment date, excludes mixed invoices and never counts another product invoice', async () => {
    const [s] = await new StripeReadOnlyProvider(
      key,
      transport((url) =>
        url.pathname === '/v1/invoices'
          ? page([
              invoice('in_PaidLate'),
              invoice('in_Mixed', [line(), line('prod_Other', 'price_Other')]),
              invoice('in_Other', [line('prod_Other', 'price_Other')]),
              invoice('in_Old', undefined, {
                status_transitions: { paid_at: Date.parse('2026-09-01') / 1000 },
              }),
            ])
          : undefined,
      ),
      () => now,
    ).fetchData();
    expect(s.paidInvoicesMonthToDate).toBe(1);
    expect(s.paidInvoiceAmountMonthToDate).toBe(40);
    expect(s.warnings.join(' ')).toContain('Mixed-product');
  });
  it('bounds rate-limit retries and redacts upstream and network error bodies', async () => {
    const pause = vi.fn(async () => {});
    let calls = 0;
    const fetcher = transport((url) => {
      if (url.pathname.startsWith('/v1/products/') && calls++ === 0)
        return new Response(key, { status: 429, headers: { 'retry-after': '1' } });
    });
    await new StripeReadOnlyProvider(key, fetcher, () => now, pause).fetchData();
    expect(pause).toHaveBeenCalledWith(1000);
    for (const status of [401, 403, 500]) {
      const broken = transport(() => new Response(key, { status }));
      const error = await new StripeReadOnlyProvider(key, broken, () => now, pause)
        .fetchData()
        .catch((e) => e);
      expect(error.message).not.toContain(key);
      expect(broken.mock.calls.length).toBeLessThanOrEqual(3);
    }
    const error = await new StripeReadOnlyProvider(
      key,
      vi.fn(async () => {
        throw new Error(key);
      }),
    )
      .fetchData()
      .catch((e) => e);
    expect(error.message).not.toContain(key);
  });
  it('rejects repeated pagination cursors', async () => {
    const fetcher = transport((url) =>
      url.pathname === '/v1/prices' ? page([price()], true) : undefined,
    );
    await expect(new StripeReadOnlyProvider(key, fetcher).fetchData()).rejects.toThrow(
      'pagination repeated',
    );
  });
});

export const snapshot = (capturedAt: string, customerIds: string[]): StripeSnapshot => ({
  capturedAt,
  customerIds,
  scopeId: stripeScope().id,
  productIds: ['prod_TradeLink'],
  activeSubscriptions: customerIds.length,
  trialingSubscriptions: 0,
  pastDueSubscriptions: 0,
  grossMrr: customerIds.length * 40,
  paidInvoiceAmountMonthToDate: 0,
  paidInvoicesMonthToDate: 0,
  warnings: [],
});
describe('Stripe evidence for forecasts', () => {
  const goal = {
    goalStart: 50,
    goalTarget: 5000,
    goalStartDate: '2026-01-01',
    goalEndDate: '2027-01-01',
  };
  it('keeps first-day and missing-day flow unknown rather than inventing zero growth', () => {
    const metrics = stripeMetrics([
      snapshot('2026-10-14T12:00:00Z', ['cus_A']),
      snapshot('2026-10-16T12:00:00Z', ['cus_A', 'cus_B']),
    ]);
    expect(metrics.every((m) => m.newSubs === null && m.churned === null)).toBe(true);
    expect(growthSummary(goal, metrics, now).forecasts.base).toBeNull();
  });
  it('compares consecutive day sets and does not expose customer IDs in metrics', () => {
    const metrics = stripeMetrics([
      snapshot('2026-10-15T12:00:00Z', ['cus_A', 'cus_B']),
      snapshot('2026-10-16T12:00:00Z', ['cus_B', 'cus_C', 'cus_D']),
    ]);
    expect(metrics[1]).toMatchObject({
      subscribers: 3,
      newSubs: 2,
      churned: 1,
      visitors: null,
      spend: null,
    });
    expect(JSON.stringify(metrics)).not.toContain('cus_');
    expect(growthSummary(goal, metrics, now).averageNet).toBe(1);
  });
});
