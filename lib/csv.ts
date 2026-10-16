import { parse } from 'csv-parse/sync';
import { metricSchema } from './validation';
export const csvHeader = 'date,subscribers,newSubs,churned,visitors,mrr,spend';
export function parseMetricsCsv(input: string) {
  if (Buffer.byteLength(input, 'utf8') > 500000) throw new Error('CSV exceeds 500 KB.');
  const records = parse(input, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true,
    max_record_size: 2000,
  });
  if (!Array.isArray(records) || records.length === 0 || records.length > 1000)
    throw new Error('CSV must contain 1–1000 rows.');
  const seen = new Set<string>();
  return records.map((record, i) => {
    if (!record || typeof record !== 'object' || Array.isArray(record))
      throw new Error(`Row ${i + 2}: invalid record.`);
    if (Object.keys(record).sort().join(',') !== csvHeader.split(',').sort().join(','))
      throw new Error('CSV headers must be: ' + csvHeader);
    if (Object.values(record).some((v) => v === ''))
      throw new Error(`Row ${i + 2}: empty fields are not permitted.`);
    const result = metricSchema.safeParse(record);
    if (!result.success)
      throw new Error(
        `Row ${i + 2}: ${result.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')}`,
      );
    if (seen.has(result.data.date)) throw new Error(`Duplicate date at row ${i + 2}.`);
    seen.add(result.data.date);
    return result.data;
  });
}
