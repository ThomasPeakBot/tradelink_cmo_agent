import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { IntegrationProvider } from './intelligence';

export const STRIPE_API_VERSION = '2026-09-30.endive';
export class StripeReadError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StripeReadError';
  }
}
export function stripeScope(env: NodeJS.ProcessEnv = process.env) {
  const products = [
    ...new Set(
      (env.STRIPE_PRODUCT_IDS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].sort();
  if (
    !products.length ||
    products.length > 20 ||
    products.some((id) => !/^prod_[a-zA-Z0-9]+$/.test(id))
  )
    throw new StripeReadError(
      'scope_required',
      'Configure STRIPE_PRODUCT_IDS with verified TradeLink product IDs before syncing.',
    );
  return { products, id: createHash('sha256').update(JSON.stringify(products)).digest('hex') };
}
export function stripeConfiguration() {
  try {
    const scope = stripeScope();
    return {
      configured: /^rk_live_[a-zA-Z0-9]+$/.test(process.env.STRIPE_SECRET_KEY || ''),
      products: scope.products,
      scopeId: scope.id,
    };
  } catch {
    return { configured: false, products: [] as string[], scopeId: null };
  }
}
const ref = z.union([z.string(), z.object({ id: z.string() })]);
const live = z.object({ id: z.string(), livemode: z.literal(true) });
const priceSchema = live.extend({
  product: ref,
  currency: z.string(),
  unit_amount: z.number().int().nullable(),
  unit_amount_decimal: z.string().nullable().optional(),
  billing_scheme: z.string(),
  transform_quantity: z.unknown().optional(),
  recurring: z
    .object({
      interval: z.enum(['day', 'week', 'month', 'year']),
      interval_count: z.number().int().positive(),
      usage_type: z.string().optional(),
    })
    .nullable(),
});
const itemSchema = z.object({
  id: z.string(),
  price: priceSchema,
  quantity: z.number().int().nonnegative().nullable(),
  discounts: z.array(z.unknown()).nullish(),
});
const subscriptionSchema = live.extend({
  customer: ref,
  status: z.string(),
  pause_collection: z.unknown().optional(),
  discounts: z.array(z.unknown()).nullish(),
  items: z.object({ data: z.array(itemSchema), has_more: z.boolean() }),
});
const invoiceSchema = live.extend({
  currency: z.string(),
  status: z.string(),
  amount_paid: z.number().int().nonnegative(),
  status_transitions: z.object({ paid_at: z.number().nullable() }),
  lines: z.object({
    data: z.array(
      z.object({
        id: z.string(),
        pricing: z
          .object({ price_details: z.object({ product: ref, price: ref }).nullable().optional() })
          .nullable()
          .optional(),
      }),
    ),
    has_more: z.boolean(),
  }),
});
const idOf = (value: z.infer<typeof ref>) => (typeof value === 'string' ? value : value.id);
export const stripeSnapshotSchema = z.object({
  capturedAt: z.string().datetime(),
  scopeId: z.string(),
  productIds: z.array(z.string()),
  customerIds: z.array(z.string()),
  activeSubscriptions: z.number().int(),
  trialingSubscriptions: z.number().int(),
  pastDueSubscriptions: z.number().int(),
  grossMrr: z.number().nullable(),
  paidInvoiceAmountMonthToDate: z.number(),
  paidInvoicesMonthToDate: z.number().int(),
  warnings: z.array(z.string()),
});
export type StripeSnapshot = z.infer<typeof stripeSnapshotSchema>;

/** GET-only, fixed Stripe origin and paths. No raw responses or credentials escape this adapter. */
export class StripeReadOnlyProvider implements IntegrationProvider<StripeSnapshot> {
  name = 'Stripe read-only';
  mode = 'live' as const;
  private deadline = 0;
  private requests = 0;
  constructor(
    private readonly key: string = process.env.STRIPE_SECRET_KEY || '',
    private readonly transport: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
    private readonly sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}
  private async get(path: string, params: Record<string, string> = {}): Promise<unknown> {
    if (
      !/^\/v1\/(products(?:\/prod_[a-zA-Z0-9]+)?|prices|customers(?:\/cus_[a-zA-Z0-9]+)?|subscriptions|subscription_items|invoices(?:\/in_[a-zA-Z0-9]+\/lines)?)$/.test(
        path,
      )
    )
      throw new StripeReadError('invalid_path', 'Unsupported Stripe read resource.');
    const url = new URL(path, 'https://api.stripe.com');
    url.search = new URLSearchParams(params).toString();
    for (let attempt = 0; attempt < 3; attempt++) {
      if (++this.requests > 500 || Date.now() >= this.deadline)
        throw new StripeReadError(
          'limit',
          'Stripe read limit reached; no partial snapshot was saved.',
        );
      let response: Response;
      try {
        response = await this.transport(url.toString(), {
          method: 'GET',
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(Math.max(1, Math.min(15000, this.deadline - Date.now()))),
          headers: { Authorization: `Bearer ${this.key}`, 'Stripe-Version': STRIPE_API_VERSION },
        });
      } catch {
        if (Date.now() >= this.deadline)
          throw new StripeReadError(
            'limit',
            'Stripe scan exceeded its time limit; no partial snapshot was saved.',
          );
        throw new StripeReadError(
          'network',
          'Stripe could not be reached; no partial snapshot was saved.',
        );
      }
      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw new StripeReadError('response', 'Stripe returned an unreadable response.');
        }
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        const retry = Number(response.headers.get('retry-after'));
        const delay = Number.isFinite(retry) && retry > 0 ? retry * 1000 : 250 * 2 ** attempt;
        if (delay > 5000 || Date.now() + delay >= this.deadline) break;
        await this.sleep(delay);
        continue;
      }
      if (response.status === 401 || response.status === 403)
        throw new StripeReadError(
          'permission',
          'Stripe rejected access. Verify the restricted live key and the five required Read permissions.',
        );
      break;
    }
    throw new StripeReadError(
      'unavailable',
      'Stripe read failed; the last successful snapshot is unchanged.',
    );
  }
  private async list(path: string, params: Record<string, string> = {}): Promise<unknown[]> {
    const rows: unknown[] = [];
    const seen = new Set<string>();
    let cursor = '';
    while (true) {
      const page = z
        .object({
          data: z.array(z.object({ id: z.string() }).passthrough()),
          has_more: z.boolean(),
        })
        .parse(
          await this.get(path, {
            ...params,
            limit: '100',
            ...(cursor ? { starting_after: cursor } : {}),
          }),
        );
      for (const row of page.data) {
        if (seen.has(row.id))
          throw new StripeReadError(
            'pagination',
            'Stripe pagination repeated records; no partial snapshot was saved.',
          );
        seen.add(row.id);
        rows.push(row);
      }
      if (!page.has_more) return rows;
      cursor = page.data.at(-1)?.id || '';
      if (!cursor)
        throw new StripeReadError(
          'pagination',
          'Stripe pagination was incomplete; no partial snapshot was saved.',
        );
    }
  }
  async fetchData(): Promise<StripeSnapshot[]> {
    if (!/^rk_live_[a-zA-Z0-9]+$/.test(this.key))
      throw new StripeReadError(
        'key_required',
        'A restricted LIVE Stripe key is required in server configuration.',
      );
    const scope = stripeScope();
    this.deadline = Date.now() + 120000;
    this.requests = 0;
    try {
      const captured = this.now();
      for (const product of scope.products) live.parse(await this.get(`/v1/products/${product}`));
      const scopedPrices = new Set<string>();
      for (const product of scope.products) {
        for (const active of ['true', 'false']) {
          for (const raw of await this.list('/v1/prices', { product, active })) {
            const price = priceSchema.parse(raw);
            if (idOf(price.product) !== product)
              throw new StripeReadError(
                'scope',
                'Stripe returned a price outside the configured scope.',
              );
            scopedPrices.add(price.id);
          }
        }
      }
      // Apply scope at Stripe, not after reading the shared PeakBot account's entire history.
      const subscriptionMap = new Map<string, z.infer<typeof subscriptionSchema>>();
      for (const price of scopedPrices) {
        for (const raw of await this.list('/v1/subscriptions', { status: 'all', price })) {
          const subscription = subscriptionSchema.parse(raw);
          subscriptionMap.set(subscription.id, subscription);
        }
      }
      const subscriptions = [...subscriptionMap.values()];
      const billingCustomers = new Set<string>();
      const customers = new Set<string>();
      let active = 0,
        trialing = 0,
        pastDue = 0,
        mrr = 0;
      const warnings = new Set<string>();
      let supported = true;
      for (const sub of subscriptions) {
        if (sub.items.has_more)
          sub.items.data = (
            await this.list('/v1/subscription_items', { subscription: sub.id })
          ).map((i) => itemSchema.parse(i));
        const items = sub.items.data.filter((i) => scope.products.includes(idOf(i.price.product)));
        if (!items.length) continue;
        billingCustomers.add(idOf(sub.customer));
        // The list includes historical/inactive prices; embedded prices remain the authority for legacy subscriptions.
        for (const item of items) scopedPrices.add(item.price.id);
        if (sub.status === 'trialing') trialing++;
        if (sub.status === 'past_due') pastDue++;
        if (sub.status !== 'active' || sub.pause_collection) continue;
        active++;
        let positive = false;
        for (const item of items) {
          const p = item.price,
            recurring = p.recurring;
          if (
            p.currency !== 'usd' ||
            p.billing_scheme !== 'per_unit' ||
            p.transform_quantity ||
            !recurring ||
            recurring.usage_type === 'metered' ||
            p.unit_amount === null ||
            item.quantity === null
          ) {
            supported = false;
            warnings.add(
              'Gross MRR unavailable: a scoped active price uses unsupported currency, metering, tiers, quantity transformation, or a missing amount/quantity.',
            );
            continue;
          }
          const amount = Number(p.unit_amount_decimal ?? p.unit_amount) * item.quantity;
          if (!Number.isFinite(amount) || amount < 0)
            throw new StripeReadError('amount', 'Stripe returned an invalid recurring amount.');
          const months =
            recurring.interval_count *
            { month: 1, year: 12, week: 12 / 52, day: 12 / 365 }[recurring.interval];
          mrr += amount / 100 / months;
          if (amount > 0) positive = true;
          if (sub.discounts?.length || item.discounts?.length)
            warnings.add(
              'Gross MRR is before discounts, refunds, credits, and fees; tax treatment follows the price; it is not Stripe net MRR.',
            );
        }
        if (positive) customers.add(idOf(sub.customer));
      }
      if (!supported)
        throw new StripeReadError(
          'unsupported_price',
          'A scoped active subscription uses unsupported pricing. Reconcile currency, metered/tiered prices, or quantity transformations before syncing.',
        );
      // Verify only eligible customers. Five concurrent reads keep scans bounded without account-wide lists.
      const customerIds = [...customers];
      for (let i = 0; i < customerIds.length; i += 5) {
        await Promise.all(
          customerIds.slice(i, i + 5).map(async (customer) => {
            if (!/^cus_[a-zA-Z0-9]+$/.test(customer))
              throw new StripeReadError('customer', 'Invalid Stripe customer reference.');
            const value = live.parse(await this.get(`/v1/customers/${customer}`));
            if (value.id !== customer)
              throw new StripeReadError(
                'customer',
                'Scoped customer identity could not be verified.',
              );
          }),
        );
      }
      // Include historical scoped subscription customers so late payments and churned customers are retained.
      const invoiceMap = new Map<string, z.infer<typeof invoiceSchema>>();
      const billingIds = [...billingCustomers];
      for (let i = 0; i < billingIds.length; i += 5) {
        const pages = await Promise.all(
          billingIds.slice(i, i + 5).map(async (customer) => {
            if (!/^cus_[a-zA-Z0-9]+$/.test(customer))
              throw new StripeReadError('customer', 'Invalid Stripe customer reference.');
            return this.list('/v1/invoices', { status: 'paid', customer });
          }),
        );
        for (const rows of pages)
          for (const raw of rows) {
            const invoice = invoiceSchema.parse(raw);
            invoiceMap.set(invoice.id, invoice);
          }
      }
      let paidAmount = 0,
        paidCount = 0;
      const monthStart = Date.UTC(captured.getUTCFullYear(), captured.getUTCMonth(), 1) / 1000;
      // No created-date cutoff: old invoices can be paid in the current month.
      for (const invoice of invoiceMap.values()) {
        const paidAt = invoice.status_transitions.paid_at;
        if (
          invoice.status !== 'paid' ||
          paidAt === null ||
          paidAt < monthStart ||
          paidAt > captured.getTime() / 1000
        )
          continue;
        if (invoice.lines.has_more)
          invoice.lines.data = z
            .array(invoiceSchema.shape.lines.shape.data.element)
            .parse(await this.list(`/v1/invoices/${invoice.id}/lines`));
        const matched = invoice.lines.data.map((line) => {
          const details = line.pricing?.price_details;
          return (
            details &&
            scope.products.includes(idOf(details.product)) &&
            scopedPrices.has(idOf(details.price))
          );
        });
        if (!matched.some(Boolean)) continue;
        if (!matched.every(Boolean)) {
          warnings.add(
            'Mixed-product invoices excluded from month-to-date paid invoice amount; reconcile manually.',
          );
          continue;
        }
        if (invoice.currency !== 'usd')
          throw new StripeReadError(
            'currency',
            'A scoped paid invoice is not USD. Currency conversion is not implemented.',
          );
        paidAmount += invoice.amount_paid / 100;
        paidCount++;
      }
      return [
        {
          capturedAt: captured.toISOString(),
          scopeId: scope.id,
          productIds: scope.products,
          customerIds: [...customers].sort(),
          activeSubscriptions: active,
          trialingSubscriptions: trialing,
          pastDueSubscriptions: pastDue,
          grossMrr: Math.round(mrr * 100) / 100,
          paidInvoiceAmountMonthToDate: Math.round(paidAmount * 100) / 100,
          paidInvoicesMonthToDate: paidCount,
          warnings: [...warnings],
        },
      ];
    } catch (error) {
      if (error instanceof StripeReadError) throw error;
      throw new StripeReadError(
        'response',
        'Stripe returned unsupported or non-live data; no partial snapshot was saved.',
      );
    }
  }
}
