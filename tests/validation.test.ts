import { describe, it, expect } from 'vitest';
import { metricSchema, companySchema } from '../lib/validation';
import { parseMetricsCsv, csvHeader } from '../lib/csv';
import { hashPassword, verifyPassword } from '../lib/password';
describe('metrics and CSV validation', () => {
  it('parses valid CSV and coerces numbers', () => {
    const rows = parseMetricsCsv(csvHeader + '\n2026-01-01,50,3,1,250,950,45\n');
    expect(rows[0].subscribers).toBe(50);
  });
  it.each([
    '2026-02-30,50,3,1,250,950,45',
    '2026-01-01,-1,3,1,250,950,45',
    '2026-01-01,1.5,3,1,250,950,45',
    '2026-01-01,50,,1,250,950,45',
    '2026-01-01,50,3,1,250,950,NaN',
  ])('rejects invalid row: %s', (row) =>
    expect(() => parseMetricsCsv(csvHeader + '\n' + row)).toThrow(),
  );
  it('rejects duplicate dates', () =>
    expect(() =>
      parseMetricsCsv(csvHeader + '\n2026-01-01,50,3,1,250,950,45\n2026-01-01,60,3,1,250,950,45'),
    ).toThrow('Duplicate date'));
  it('rejects unexpected or missing headers', () =>
    expect(() => parseMetricsCsv('date,subscribers\n2026-01-01,50')).toThrow('headers'));
  it('rejects oversized and empty imports', () => {
    expect(() => parseMetricsCsv('x'.repeat(500001))).toThrow('500 KB');
    expect(() => parseMetricsCsv(csvHeader)).toThrow('1–1000');
  });
  it('rejects impossible calendar dates in manual entry', () =>
    expect(
      metricSchema.safeParse({
        date: '2026-02-29',
        subscribers: 1,
        newSubs: 1,
        churned: 0,
        visitors: 1,
        mrr: 1,
        spend: 0,
      }).success,
    ).toBe(false));
  it('requires an increasing goal and time interval', () =>
    expect(
      companySchema.safeParse({
        name: 'TradeLink',
        description: 'Test',
        goalStart: 5000,
        goalTarget: 50,
        goalStartDate: '2026-01-01',
        goalEndDate: '2025-01-01',
      }).success,
    ).toBe(false));
});
describe('password security', () => {
  it('uses salted hashes and rejects incorrect passwords', () => {
    const a = hashPassword('long internal password');
    const b = hashPassword('long internal password');
    expect(a).not.toBe(b);
    expect(verifyPassword('long internal password', a)).toBe(true);
    expect(verifyPassword('wrong', a)).toBe(false);
  });
  it('rejects malformed hashes', () => expect(verifyPassword('test', 'bad')).toBe(false));
});
