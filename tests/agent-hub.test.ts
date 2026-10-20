import { describe, expect, it } from 'vitest';
import { buildSyntheticExperiment, HUB_AGENT_ID } from '../lib/agent-hub';

describe('Agent Hub dry-run source contract', () => {
  it('uses only the allowed source/target and dry-run capability', () => {
    const r = buildSyntheticExperiment(new Date('2026-10-20T12:00:00Z'));
    expect(HUB_AGENT_ID).toBe('tradelink-cmo');
    expect(r.target_agent).toBe('emailcreator');
    expect(r.capability).toBe('prepare_experiment');
    expect(r.payload.mode).toBe('dry_run');
    expect(r.payload.discount_percent).toBe(40);
    expect(r.payload.price_usd).toBe(40);
    expect(r.payload.lead_source).toBe('payload');
    expect(r.payload.cadence_mode).toBe('business');
    expect(r.payload.leads).toHaveLength(24);
  });
  it('includes no real people or recipient credentials', () => {
    const r = buildSyntheticExperiment(new Date('2026-10-20T12:00:00Z'));
    const body = JSON.stringify(r);
    expect(body).not.toContain('token');
    expect(body).not.toContain('gmail.com');
    for (const lead of r.payload.leads) {
      expect(lead.identity.email).toMatch(/@sample-[0-9]+\.example$/);
    }
  });
  it('keeps retries stable for the same scenario', () => {
    const d = new Date('2026-10-20T12:00:00Z');
    const a = buildSyntheticExperiment(d);
    const b = buildSyntheticExperiment(d);
    expect(a).toEqual(b);
    expect(a.idempotency_key).toBe('tradelink-creator-ab-v1-synthetic-qa-business-24');
    expect(a.payload.start_date).toBe('2026-10-27');
  });
});
