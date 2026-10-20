import { NextResponse } from 'next/server';
import { currentUser, assertOrigin } from '@/lib/auth';
import { readJson } from '@/lib/http';
import { qaStatus, setQaPaused } from '@/lib/agent-hub-autonomous';
export const dynamic = 'force-dynamic';
async function administrator() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Administrator access required' }, { status: 403 });
  return null;
}
export async function GET() {
  const denied = await administrator();
  if (denied) return denied;
  try { return NextResponse.json(await qaStatus(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ error: 'Autonomous QA state is unavailable. No success is assumed.' }, { status: 503 }); }
}
export async function POST(request: Request) {
  try { assertOrigin(request); } catch { return NextResponse.json({ error: 'Invalid origin' }, { status: 403 }); }
  const denied = await administrator();
  if (denied) return denied;
  try {
    const body = await readJson(request, 256);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
        typeof (body as Record<string, unknown>).paused !== 'boolean') {
      return NextResponse.json({ error: 'Only the QA pause switch is accepted.' }, { status: 422 });
    }
    const user = await currentUser();
    return NextResponse.json(await setQaPaused((body as { paused: boolean }).paused, user?.email || 'administrator'));
  } catch { return NextResponse.json({ error: 'QA pause state could not be saved.' }, { status: 503 }); }
}
