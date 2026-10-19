import { createHash, randomBytes } from 'node:crypto';
import { db } from '../db';
import { decrypt, encrypt, hasEmailEncryptionKey } from './crypto';
import { sender, settingsId } from './templates';
export const gmailSendScope = 'https://www.googleapis.com/auth/gmail.send';
export const oauthScopes = ['openid', 'email', gmailSendScope];
export function googleEmailConfiguration() {
  const app = process.env.APP_URL || '';
  let origin = '';
  try {
    const u = new URL(app);
    if (
      u.protocol === 'https:' ||
      (process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(u.hostname))
    )
      origin = u.origin;
  } catch {}
  return {
    configured: !!(
      origin &&
      process.env.GOOGLE_EMAIL_CLIENT_ID &&
      process.env.GOOGLE_EMAIL_CLIENT_SECRET &&
      hasEmailEncryptionKey()
    ),
    redirectUri: origin ? `${origin}/api/affiliate-email/google/callback` : '',
    origin,
  };
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export async function beginGoogleEmail(userId: string) {
  const config = googleEmailConfiguration();
  if (!config.configured)
    throw Error('Google OAuth client and encryption key must be configured first.');
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  await db.affiliateMailOAuth.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.affiliateMailOAuth.create({
    data: {
      stateHash: hash(state),
      userId,
      verifier: encrypt(verifier),
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_EMAIL_CLIENT_ID!,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: oauthScopes.join(' '),
    access_type: 'offline',
    prompt: 'consent select_account',
    login_hint: sender,
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  return url.href;
}
async function tokenRequest(params: Record<string, string>, fetcher: typeof fetch) {
  const response = await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...params,
      client_id: process.env.GOOGLE_EMAIL_CLIENT_ID!,
      client_secret: process.env.GOOGLE_EMAIL_CLIENT_SECRET!,
    }),
  });
  if (!response.ok) throw Error('Google authorization unavailable; reconnect the mailbox.');
  const data = await response.json();
  if (typeof data.access_token !== 'string') throw Error('Google token missing');
  return data as { access_token: string; refresh_token?: string; scope?: string };
}
export async function finishGoogleEmail(
  userId: string,
  state: string,
  code: string,
  fetcher: typeof fetch = fetch,
) {
  if (!googleEmailConfiguration().configured || state.length > 200 || code.length > 4096)
    throw Error('Invalid authorization');
  const saved = await db.$transaction(async (tx) => {
    const row = await tx.affiliateMailOAuth.findUnique({ where: { stateHash: hash(state) } });
    if (!row || row.userId !== userId || row.expiresAt < new Date())
      throw Error('Authorization expired or belongs to another session.');
    await tx.affiliateMailOAuth.delete({ where: { stateHash: row.stateHash } });
    return row;
  });
  const token = await tokenRequest(
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: googleEmailConfiguration().redirectUri,
      code_verifier: decrypt(saved.verifier),
    },
    fetcher,
  );
  if (!token.scope?.split(' ').includes(gmailSendScope) || !token.refresh_token)
    throw Error('Google did not grant offline sending access.');
  const response = await fetcher('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error('Could not verify the mailbox.');
  const profile = await response.json();
  if (profile.email_verified !== true || profile.email?.toLowerCase() !== sender)
    throw Error('Sign in with experience@peakbot.com itself; aliases are not supported.');
  await db.$transaction(async (tx) => {
    await tx.affiliateMailAccount.upsert({
      where: { id: settingsId },
      create: { id: settingsId, email: sender, refreshToken: encrypt(token.refresh_token!) },
      update: {
        email: sender,
        refreshToken: encrypt(token.refresh_token!),
        connectedAt: new Date(),
      },
    });
    await tx.affiliateMailSettings.update({ where: { id: settingsId }, data: { enabled: false } });
    await tx.auditLog.create({
      data: {
        actor: userId,
        action: 'AFFILIATE_GMAIL_CONNECTED',
        entityType: 'AffiliateMailAccount',
        entityId: settingsId,
        details: `Verified ${sender}; automation remains paused. No inbox access.`,
      },
    });
  });
}
export async function gmailAccessToken(fetcher: typeof fetch = fetch) {
  if (!googleEmailConfiguration().configured) throw Error('Google email not configured');
  const account = await db.affiliateMailAccount.findUnique({ where: { id: settingsId } });
  if (!account || account.email !== sender) throw Error('Sender not connected');
  const token = await tokenRequest(
    { grant_type: 'refresh_token', refresh_token: decrypt(account.refreshToken) },
    fetcher,
  );
  if (token.refresh_token)
    await db.affiliateMailAccount.update({
      where: { id: settingsId },
      data: { refreshToken: encrypt(token.refresh_token) },
    });
  return token.access_token;
}
export function gmailRaw(to: string, subject: string, body: string, unsubscribeUrl: string) {
  if (/[\r\n]/.test(to + subject) || !/^https:\/\//.test(unsubscribeUrl))
    throw Error('Invalid message headers');
  const headers = [
    `From: TradeLink <${sender}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    `List-Unsubscribe: <${unsubscribeUrl}>`,
    'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  const encoded =
    Buffer.from(body)
      .toString('base64')
      .match(/.{1,76}/g)
      ?.join('\r\n') || '';
  return Buffer.from(headers.join('\r\n') + '\r\n\r\n' + encoded + '\r\n').toString('base64url');
}
export class GmailSendError extends Error {
  constructor(public ambiguous: boolean) {
    super(
      ambiguous
        ? 'Delivery uncertain; inspect Gmail Sent before any manual follow-up.'
        : 'Google rejected the message; no automatic retry.',
    );
  }
}
export async function gmailSend(accessToken: string, raw: string, fetcher: typeof fetch = fetch) {
  let response: Response;
  try {
    response = await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
  } catch {
    throw new GmailSendError(true);
  }
  if (!response.ok) throw new GmailSendError(response.status >= 500);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new GmailSendError(true);
  }
  if (typeof data.id !== 'string') throw new GmailSendError(true);
  return data.id;
}
