import { afterEach, expect, it, vi } from 'vitest';
import {
  encrypt,
  decrypt,
  unsubscribeContact,
  unsubscribeToken,
} from '../lib/affiliate-email/crypto';
import { render, sampleValues } from '../lib/affiliate-email/templates';
import {
  gmailRaw,
  gmailSend,
  GmailSendError,
  googleEmailConfiguration,
} from '../lib/affiliate-email/google';
import { parseAffiliateCsv } from '../lib/affiliate-email/data';
vi.stubEnv('AFFILIATE_EMAIL_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
afterEach(() => vi.unstubAllEnvs());
it('encrypts credentials with authenticated encryption and rejects tampered unsubscribe signatures', () => {
  vi.stubEnv('AFFILIATE_EMAIL_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
  const encrypted = encrypt('private-refresh-token');
  expect(encrypted).not.toContain('private-refresh-token');
  expect(decrypt(encrypted)).toBe('private-refresh-token');
  const parts = encrypted.split('.');
  parts[3] = Buffer.alloc(16).toString('base64url');
  expect(() => decrypt(parts.join('.'))).toThrow();
  const token = unsubscribeToken('contact-123');
  expect(unsubscribeContact(token)).toBe('contact-123');
  expect(() => unsubscribeContact(token + 'x')).toThrow();
});
it('renders only approved personalization fields and rejects header injection and incomplete placeholders', () => {
  expect(render('Hi {{first_name}}', sampleValues)).toBe('Hi Alex');
  expect(() => render('{{unknown}}', sampleValues)).toThrow('Unknown');
  expect(() => render('{{rank', sampleValues)).toThrow('Invalid');
  expect(() =>
    gmailRaw(
      'victim@example.com\r\nBcc: attacker@example.com',
      'Hello',
      'test',
      'https://example.com/unsubscribe',
    ),
  ).toThrow();
  const raw = Buffer.from(
    gmailRaw('affiliate@example.com', 'Hello ✓', 'Plain text ✓', 'https://example.com/unsubscribe'),
    'base64url',
  ).toString('utf8');
  expect(raw).toContain('From: TradeLink <experience@peakbot.com>');
  expect(raw).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
  expect(raw).not.toContain('Bcc:');
});
it('requires permission, valid HTTPS links and a complete unambiguous affiliate CSV', () => {
  const header = 'code,email,name,affiliate_url,qualifying_referrals,rank,gap,email_permission\n';
  const row = 'alex,alex@example.com,Alex,https://example.com/ref,9,2,1,yes';
  expect(parseAffiliateCsv(header + row)[0].qualifying_referrals).toBe(9);
  expect(() => parseAffiliateCsv(header + row.replace(',9,', ',,'))).toThrow();
  expect(() => parseAffiliateCsv(header + row + '\n' + row)).toThrow('Duplicate');
  expect(() => parseAffiliateCsv(header + row.replace(',yes', ',no'))).toThrow();
  expect(() =>
    parseAffiliateCsv(header + row.replace('https://example.com/ref', 'http://example.com/ref')),
  ).toThrow();
});
it('distinguishes definite rejection from uncertain delivery and never retries Gmail itself', async () => {
  const denied = vi.fn().mockResolvedValue(new Response('{}', { status: 403 }));
  await expect(gmailSend('fixture', 'raw', denied)).rejects.toMatchObject({ ambiguous: false });
  expect(denied).toHaveBeenCalledTimes(1);
  const uncertain = vi.fn().mockRejectedValue(Error('network dropped'));
  await expect(gmailSend('fixture', 'raw', uncertain)).rejects.toBeInstanceOf(GmailSendError);
  expect(uncertain).toHaveBeenCalledTimes(1);
  vi.stubEnv('GOOGLE_EMAIL_CLIENT_ID', '');
  expect(googleEmailConfiguration().configured).toBe(false);
});
