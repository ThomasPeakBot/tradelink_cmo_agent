import type { StripeSnapshot } from './stripe';
import type { Metric } from './growth';
export function stripeMetrics(snapshots: StripeSnapshot[]) {
  const sorted = [...snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  return sorted.map((snapshot, index) => {
    const previous = sorted[index - 1];
    const date = snapshot.capturedAt.slice(0, 10);
    const comparable =
      previous &&
      previous.scopeId === snapshot.scopeId &&
      Date.parse(date) - Date.parse(previous.capturedAt.slice(0, 10)) === 86400000;
    const currentIds = new Set(snapshot.customerIds);
    const priorIds = new Set(comparable ? previous.customerIds : []);
    return {
      id: `stripe:${snapshot.scopeId}:${date}`,
      date,
      subscribers: currentIds.size,
      newSubs: comparable ? [...currentIds].filter((id) => !priorIds.has(id)).length : null,
      churned: comparable ? [...priorIds].filter((id) => !currentIds.has(id)).length : null,
      visitors: null,
      spend: null,
      mrr: snapshot.grossMrr,
      source: 'stripe',
      isDemo: false,
    } satisfies Metric & { id: string; source: string };
  });
}
