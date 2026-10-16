import { describe, it, expect } from 'vitest';
import { bootstrapConfig } from '../lib/bootstrap-config';
describe('production first-boot configuration', () => {
  it('refuses to initialize without a unique administrator password', () => {
    expect(() => bootstrapConfig({})).toThrow('ADMIN_PASSWORD');
    expect(() => bootstrapConfig({ ADMIN_PASSWORD: 'TradeLink-Demo-2026!' })).toThrow();
  });
  it('defaults to an empty workspace and normalizes the admin email', () => {
    const config = bootstrapConfig({
      ADMIN_EMAIL: 'Operator@TradeLink.com',
      ADMIN_PASSWORD: 'unique-internal-test-password',
    });
    expect(config.email).toBe('operator@tradelink.com');
    expect(config.mode).toBe('empty');
  });
  it('requires explicit opt-in to labeled demo data', () => {
    expect(
      bootstrapConfig({ ADMIN_PASSWORD: 'unique-internal-test-password', BOOTSTRAP_MODE: 'demo' })
        .mode,
    ).toBe('demo');
    expect(() =>
      bootstrapConfig({
        ADMIN_PASSWORD: 'unique-internal-test-password',
        BOOTSTRAP_MODE: 'arbitrary',
      }),
    ).toThrow();
  });
  it('rejects an invalid email and excessive password length', () => {
    expect(() =>
      bootstrapConfig({ ADMIN_PASSWORD: 'unique-internal-test-password', ADMIN_EMAIL: 'invalid' }),
    ).toThrow();
    expect(() => bootstrapConfig({ ADMIN_PASSWORD: 'x'.repeat(257) })).toThrow();
  });
});
