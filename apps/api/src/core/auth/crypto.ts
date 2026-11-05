import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { env } from '../../config';

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** scrypt cost (review D20): 2^17 by default. Hashes made with a lower N verify and are re-hashed at the next login. */
export const DEFAULT_SCRYPT_LOG2_N = 17;
export const scryptN = () => 2 ** env().SCRYPT_LOG2_N;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

export async function hashPasswordWith(password: string, N: number): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, 64, {
    N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 256 * 1024 * 1024,
  });
  return `scrypt$${N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** Password hashing with scrypt (Node built-in; no native dependency). Format: scrypt$N$r$p$salt$hash */
export function hashPassword(password: string): Promise<string> {
  return hashPasswordWith(password, scryptN());
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 256 * 1024 * 1024,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** True when the stored hash uses a weaker cost than the current policy. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  return parts[0] !== 'scrypt' || Number(parts[1]) < scryptN();
}

/**
 * Indirection so the login path can be observed in tests: the same verifier runs for unknown emails
 * against a dummy hash, so "no such user" costs as much as "wrong password" (review D23).
 */
export const passwordCheck = { verify: verifyPassword };
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomToken(24));
  return dummyHash;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// ---------------------------------------------------------------------------------------------
// Keys (review D21): one derived key per purpose from APP_SECRET via HKDF, a key id in every
// ciphertext, and APP_SECRET_PREVIOUS accepted for reads so the secret can be rotated: set the new
// value as APP_SECRET, the old one as APP_SECRET_PREVIOUS, redeploy, re-encrypt at leisure, drop the old.
// ---------------------------------------------------------------------------------------------
export type KeyPurpose = 'field' | 'totp' | 'sign' | 'index';
const HKDF_SALT = 'eayni-erp-v2';

function secrets(): string[] {
  const e = env();
  return [e.APP_SECRET, ...(e.APP_SECRET_PREVIOUS ? [e.APP_SECRET_PREVIOUS] : [])];
}

/** Short, non-secret identifier of a secret (first 8 hex chars of its SHA-256). */
export function keyId(secret = env().APP_SECRET): string {
  return sha256(secret).slice(0, 8);
}

export function deriveKey(purpose: KeyPurpose, secret = env().APP_SECRET): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, HKDF_SALT, `eayni:${purpose}`, 32));
}

/** Legacy v1 key: sha256(APP_SECRET), one key for everything. Kept for reading old ciphertexts. */
function legacyKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/** HMAC for URL signing and similar (purpose 'sign' by default). */
export function hmac(value: string, purpose: KeyPurpose = 'sign'): string {
  return createHmac('sha256', deriveKey(purpose)).update(value).digest('base64url');
}

/**
 * Blind index for equality search on an encrypted field (review D22): HMAC of the normalized value
 * under the 'index' key, so duplicates are detected without storing the value in clear.
 */
export function blindIndex(value: string): string {
  return hmac(value.normalize('NFKC').replace(/\s+/g, '').toUpperCase(), 'index');
}

/** AES-256-GCM for secrets at rest (TOTP seeds, field-level encryption of sensitive values). */
export function encrypt(plain: string, purpose: KeyPurpose = 'field'): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(purpose), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v2:${keyId()}:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function open(key: Buffer, ivB64: string, tagB64: string, encB64: string): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]).toString('utf8');
}

export function decrypt(payload: string, purpose: KeyPurpose = 'field'): string {
  const parts = payload.split(':');
  if (parts[0] === 'v2' && parts.length === 5) {
    const [, kid, iv, tag, enc] = parts;
    const secret = secrets().find((s) => keyId(s) === kid);
    if (!secret) throw new Error(`unknown key id ${kid}`);
    return open(deriveKey(purpose, secret), iv, tag, enc);
  }
  if (parts[0] === 'v1' && parts.length === 4) {
    const [, iv, tag, enc] = parts;
    let lastErr: unknown;
    for (const s of secrets()) {
      try {
        return open(legacyKey(s), iv, tag, enc);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('cannot decrypt legacy ciphertext');
  }
  throw new Error('unsupported ciphertext version');
}

/** Re-encrypt under the current secret and purpose when the payload is legacy or made under an old key. */
export function needsReencrypt(payload: string): boolean {
  const parts = payload.split(':');
  return parts[0] !== 'v2' || parts[1] !== keyId();
}
