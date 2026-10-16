import { readJson, PayloadTooLarge } from '@/lib/http';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { assertOrigin, newSession } from '@/lib/auth';
import { hashPassword, verifyPassword } from '@/lib/password';
const dummyHash = hashPassword('not-a-real-login-password');
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { email, password } = z
      .object({
        email: z
          .string()
          .email()
          .max(254)
          .transform((v) => v.toLowerCase()),
        password: z.string().min(1).max(256),
      })
      .parse(await readJson(request, 2048));
    // Account-scoped throttling does not trust user-controlled forwarding headers.
    const key = createHash('sha256').update(email).digest('hex');
    const since = new Date(Date.now() - 15 * 60000);
    const allowed = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`;
      const attempts = await tx.loginAttempt.count({ where: { key, createdAt: { gte: since } } });
      if (attempts >= 8) return false;
      await tx.loginAttempt.create({ data: { key } });
      return true;
    });
    if (!allowed)
      return NextResponse.json(
        { error: 'Too many attempts. Try again in 15 minutes.' },
        { status: 429, headers: { 'Retry-After': '900' } },
      );
    const user = await db.user.findUnique({ where: { email } });
    const valid = verifyPassword(password, user?.passwordHash ?? dummyHash);
    if (!user || !valid)
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    await newSession(user.id);
    await db.loginAttempt.deleteMany({ where: { key } });
    await db.auditLog.create({
      data: {
        actor: user.email,
        action: 'LOGIN',
        entityType: 'User',
        entityId: user.id,
        details: 'Authenticated internal session',
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PayloadTooLarge)
      return NextResponse.json({ error: 'Request too large' }, { status: 413 });
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === 'INVALID_ORIGIN'
            ? 'Invalid request origin'
            : 'Unable to sign in',
      },
      { status: error instanceof Error && error.message === 'INVALID_ORIGIN' ? 403 : 400 },
    );
  }
}
