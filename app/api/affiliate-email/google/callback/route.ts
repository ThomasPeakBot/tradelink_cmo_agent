import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { finishGoogleEmail, googleEmailConfiguration } from '@/lib/affiliate-email/google';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const config = googleEmailConfiguration();
  if (!config.origin)
    return NextResponse.json({ error: 'Google email not configured' }, { status: 503 });
  const user = await currentUser();
  if (!user || user.role !== 'ADMIN')
    return NextResponse.redirect(new URL('/login', config.origin));
  const url = new URL(request.url);
  const state = url.searchParams.get('state'),
    code = url.searchParams.get('code');
  try {
    if (!state || !code || url.searchParams.has('error')) throw Error('Authorization cancelled');
    await finishGoogleEmail(user.id, state, code);
    return NextResponse.redirect(new URL('/?affiliateEmail=connected', config.origin));
  } catch {
    return NextResponse.redirect(new URL('/?affiliateEmail=failed', config.origin));
  }
}
