import { db } from '@/lib/db';
import { unsubscribeContact } from '@/lib/affiliate-email/crypto';
export const dynamic = 'force-dynamic';
function contact(request: Request) {
  const token = new URL(request.url).searchParams.get('token') || '';
  return { id: unsubscribeContact(token), token };
}
export async function GET(request: Request) {
  try {
    const { token } = contact(request);
    return new Response(
      `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>TradeLink email preferences</title><body><main><h1>TradeLink affiliate emails</h1><p>Confirm below to stop automated affiliate emails.</p><form method="POST" action="?token=${encodeURIComponent(token)}"><button type="submit">Unsubscribe</button></form></main></body></html>`,
      {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy':
            "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
        },
      },
    );
  } catch {
    return new Response('Invalid unsubscribe link', { status: 400 });
  }
}
export async function POST(request: Request) {
  try {
    const { id } = contact(request);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(74182365)`;
      await tx.affiliateMailContact.update({ where: { id }, data: { unsubscribedAt: new Date() } });
      await tx.affiliateMailDelivery.updateMany({
        where: { contactId: id, status: 'QUEUED' },
        data: { status: 'CANCELLED', error: 'Recipient unsubscribed.' },
      });
      await tx.auditLog.create({
        data: {
          actor: 'recipient',
          action: 'AFFILIATE_EMAIL_UNSUBSCRIBED',
          entityType: 'AffiliateMailContact',
          entityId: id,
          details: 'Recipient suppressed from affiliate email automation.',
        },
      });
    });
    return new Response('You have been unsubscribed from TradeLink affiliate emails.', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch {
    return new Response('Invalid unsubscribe link', { status: 400 });
  }
}
