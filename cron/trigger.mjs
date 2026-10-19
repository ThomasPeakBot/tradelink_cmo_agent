// Small scheduled Railway service; no provider keys or database access required.
const origin = process.env.APP_URL;
const secret = process.env.SYNC_CRON_SECRET;
if (!origin || new URL(origin).protocol !== 'https:' || !secret || secret.length < 32) {
  console.error('Scheduled sync configuration is missing.');
  process.exit(1);
}
try {
  const response = await fetch(new URL('/api/internal/sync', origin), {
    method: 'POST',
    redirect: 'error',
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(360000),
  });
  const result = await response.json();
  console.log(
    JSON.stringify({
      httpStatus: response.status,
      status: result.status,
      skipped: result.skipped,
      runId: result.runId,
      results: result.results,
    }),
  );
  if (!response.ok) process.exitCode = 1;
} catch {
  console.error('Scheduled sync request failed; check the web service and sync history.');
  process.exitCode = 1;
}
