import { describe, expect, it } from 'vitest';
import { assertQaRunnerConfig } from '../lib/agent-hub-runner-config';
describe('standalone QA runner boundary', () => {
  const safe = { DATABASE_URL: 'postgresql://qa:qa@localhost/cmo_qa', CMO_HUB_ORIGIN: 'https://qa-hub.up.railway.app' };
  it('accepts a dedicated database without provider bindings', () => expect(() => assertQaRunnerConfig(safe)).not.toThrow());
  it.each(['OPENAI_API_KEY', 'SUPABASE_SERVICE_KEY', 'GMAIL_TOKEN_QA_1', 'SMTP_PASSWORD', 'GHL_API_KEY'])('rejects inherited %s', (key) => {
    expect(() => assertQaRunnerConfig({ ...safe, [key]: 'not-a-real-secret' })).toThrow('provider');
  });
  it('refuses a production database and existing production Hub', () => {
    expect(() => assertQaRunnerConfig({ ...safe, DATABASE_URL: 'postgresql://localhost/production' })).toThrow('database');
    expect(() => assertQaRunnerConfig({ ...safe, CMO_HUB_ORIGIN: 'https://web-production-44a4c.up.railway.app/' })).toThrow('production Hub');
  });
});
