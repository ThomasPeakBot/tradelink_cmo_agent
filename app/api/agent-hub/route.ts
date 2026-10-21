import { NextResponse } from 'next/server';
import { currentUser, assertOrigin } from '@/lib/auth';
import { readJson } from '@/lib/http';
import { buildSyntheticExperiment, hubRequest, HubError } from '@/lib/agent-hub';

export const dynamic = 'force-dynamic';

async function administrator() {
  const user = await currentUser();
  if (!user) return { error: 'Sign in required', status: 401 } as const;
  if (user.role !== 'ADMIN') {
    return { error: 'Administrator access required', status: 403 } as const;
  }
  return null;
}

function failure(error: unknown) {
  if (error instanceof HubError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: 'Agent Hub request failed; nothing is assumed.' }, { status: 503 });
}

export async function GET() {
  const denied = await administrator();
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });
  try {
    const data = await hubRequest('GET', '/api/v1/agent/submissions?summary=true');
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    assertOrigin(request);
  } catch {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  }
  const denied = await administrator();
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });
  let body: unknown;
  try {
    body = await readJson(request, 2048);
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      (body as Record<string, unknown>).action !== 'submit_synthetic_qa') {
    return NextResponse.json({ error: 'Only the synthetic dry-run QA action is available.' },
                             { status: 422 });
  }
  try {
    const result = await hubRequest('POST', '/api/v1/agent/proposals', buildSyntheticExperiment());
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return failure(error);
  }
}
