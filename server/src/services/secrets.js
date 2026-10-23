import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

export const randomToken = (bytes = 24) => randomBytes(bytes).toString('base64url');

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export function randomCode(length, alphabet = CROCKFORD) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/** Visitor-facing card id, e.g. D7K2M9QXA. Not secret; the claim is. */
export const newCardId = (prefix = 'D') => `${prefix}${randomCode(8)}`;

/**
 * QR claim derived from the card id with a server secret, so it can be shown
 * again without being stored (§15 C22).
 */
export function cardClaim(secret, cardId) {
  return createHmac('sha256', secret).update(`card-claim:${cardId}`).digest('base64url').slice(0, 22);
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function hashPasscode(plain) {
  if (typeof plain !== 'string' || plain.length < 8 || plain.length > 128) {
    throw new RangeError('passcode must be 8..128 characters');
  }
  const salt = randomBytes(16);
  const key = await scryptAsync(plain.normalize('NFKC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPasscode(plain, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt' || typeof plain !== 'string' || plain.length > 128) return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scryptAsync(plain.normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return timingSafeEqual(key, expected);
}

// Fixed hash used to spend the same time when a login name does not exist.
export const DUMMY_PASSCODE_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
