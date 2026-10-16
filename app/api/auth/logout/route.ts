import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { assertOrigin, cookieName, currentUser, tokenHash } from '@/lib/auth';
import { db } from '@/lib/db';
export async function POST(request: Request) {
  try {
    assertOrigin(request);
  } catch {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  }
  const user = await currentUser();
  const jar = await cookies();
  const token = jar.get(cookieName)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
  jar.delete(cookieName);
  if (user)
    await db.auditLog.create({
      data: {
        actor: user.email,
        action: 'LOGOUT',
        entityType: 'User',
        entityId: user.id,
        details: 'Session revoked',
      },
    });
  return NextResponse.json({ ok: true });
}
