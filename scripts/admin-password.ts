import 'dotenv/config';
import { db } from '../lib/db';
import { hashPassword } from '../lib/password';
async function main() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 16 || password === 'TradeLink-Demo-2026!')
    throw new Error(
      'Set ADMIN_EMAIL and a unique ADMIN_PASSWORD (16+ characters) in the environment.',
    );
  await db.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { email },
      data: { passwordHash: hashPassword(password) },
    });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.auditLog.create({
      data: {
        actor: 'admin-cli',
        action: 'ROTATE_PASSWORD',
        entityType: 'User',
        entityId: user.id,
        details: 'Password changed; existing sessions revoked.',
      },
    });
  });
  console.log('Password rotated and sessions revoked.');
}
main().finally(() => db.$disconnect());
