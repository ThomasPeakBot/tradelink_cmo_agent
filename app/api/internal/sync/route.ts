import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { syncAll, SyncBusyError } from '@/lib/sync-all';
import { runAffiliateEmail } from '@/lib/affiliate-email/automation';
import { easternSchedule } from '@/lib/sync-state';
export const dynamic = 'force-dynamic';
export const maxDuration = 360;
export async function POST(request: Request) {
  const secret = process.env.SYNC_CRON_SECRET;
  const supplied = request.headers.get('authorization') || '';
  if (
    !secret ||
    secret.length < 32 ||
    !timingSafeEqual(
      createHash('sha256').update(supplied).digest(),
      createHash('sha256').update(`Bearer ${secret}`).digest(),
    )
  )
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const now = new Date();
    const result = easternSchedule(now, 9, true).due
      ? await runAffiliateEmail('scheduled-affiliate-email', now)
      : await syncAll('scheduled-sync', 'SCHEDULED');
    return NextResponse.json(result, {
      status: result.status === 'FAILED' || result.status === 'PARTIAL' ? 503 : 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof SyncBusyError
            ? error.message
            : 'Scheduled sync did not complete; check sync history.',
      },
      { status: 503 },
    );
  }
}
