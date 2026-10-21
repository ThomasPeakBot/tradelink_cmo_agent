import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AutonomousQaRun, type Run } from '../components/agent-hub-autonomous';
const run: Run = { run_id: 'synthetic-ui', experiment_id: 'tradelink-creator-positioning', experiment_version: 'v1',
  task_id: '10000000-0000-4000-8000-000000000001', state: 'completed', hub_state: 'completed',
  last_run_at: '2026-10-20T00:00:00Z', next_run_at: null, submitted_at: '2026-10-20T00:00:00Z',
  result_received_at: '2026-10-20T00:00:01Z', result_delivered_at: '2026-10-20T00:00:02Z', last_error: null,
  result: { valid: true, validation: 'passed', plan_sha256: 'a'.repeat(64), warnings: [
    { rule: 'claim_unverified', where: 'offer', detail: 'Free-trial wording needs human approval.', severity: 'warning' },
    'Business days are a synthetic QA fixture only.',
  ], errors: [] } };
describe('autonomous QA result presentation', () => {
  it('renders structured real-world findings without treating objects as React children', () => {
    const html = renderToStaticMarkup(createElement(AutonomousQaRun, { run }));
    expect(html).toContain('Free-trial wording needs human approval.');
    expect(html).toContain('Business days are a synthetic QA fixture only.');
    expect(html).toContain('verified result has returned to CMO');
    expect(html).toContain('Live sending remains disabled');
  });
  it('shows pending delivery and failures truthfully and escapes untrusted finding text', () => {
    const pending: Run = { ...run, state: 'result_received', result_delivered_at: null,
      result: { ...run.result, errors: [{ rule: 'test', detail: '<script>bad()</script>' }] } };
    const html = renderToStaticMarkup(createElement(AutonomousQaRun, { run: pending }));
    expect(html).toContain('Final preparation is not yet confirmed');
    expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });
});
