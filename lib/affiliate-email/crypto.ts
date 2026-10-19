import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
function key() {
  const value = process.env.AFFILIATE_EMAIL_ENCRYPTION_KEY || '';
  const result = Buffer.from(value, 'base64');
  if (result.length !== 32 || result.toString('base64') !== value)
    throw Error('A 32-byte base64 affiliate email encryption key is required.');
  return result;
}
export function hasEmailEncryptionKey() {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from('tradelink-affiliate-email-v1'));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    encrypted.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('.');
}
export function decrypt(value: string) {
  const [version, iv, ciphertext, tag] = value.split('.');
  if (version !== 'v1' || !iv || !ciphertext || !tag) throw Error('Invalid encrypted credential');
  const cipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  cipher.setAAD(Buffer.from('tradelink-affiliate-email-v1'));
  cipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    cipher.update(Buffer.from(ciphertext, 'base64url')),
    cipher.final(),
  ]).toString('utf8');
}
export function unsubscribeToken(id: string) {
  return (
    Buffer.from(id).toString('base64url') +
    '.' +
    createHmac('sha256', key())
      .update('unsubscribe:' + id)
      .digest('base64url')
  );
}
export function unsubscribeContact(token: string) {
  if (token.length > 300) throw Error('Invalid link');
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) throw Error('Invalid link');
  const id = Buffer.from(encoded, 'base64url').toString('utf8');
  const expected = unsubscribeToken(id);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw Error('Invalid link');
  return id;
}
