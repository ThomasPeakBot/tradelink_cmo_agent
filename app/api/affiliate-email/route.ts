import { NextResponse } from 'next/server';
import { currentUser, assertOrigin } from '@/lib/auth';
import { readJson } from '@/lib/http';
import { affiliateEmailState, affiliateEmailAdmin } from '@/lib/affiliate-email/admin';
import { z } from 'zod';
export const dynamic = 'force-dynamic';
export async function GET() {
  const user = await currentUser();
  if (!user || user.role !== 'ADMIN')
    return NextResponse.json({ error: 'Administrator sign-in required' }, { status: 401 });
  return NextResponse.json(await affiliateEmailState(), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const user = await currentUser();
    if (!user || user.role !== 'ADMIN')
      return NextResponse.json({ error: 'Administrator sign-in required' }, { status: 401 });
    const body = z.record(z.unknown()).parse(await readJson(request, 450000));
    return NextResponse.json(await affiliateEmailAdmin(user, body));
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? 'Check the form fields and confirmations.'
        : error instanceof Error && error.message === 'INVALID_ORIGIN'
          ? 'Invalid request origin'
          : error instanceof Error && !('code' in error)
            ? error.message
            : 'Affiliate email operation failed. Existing settings were preserved.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
