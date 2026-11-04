import type { Response } from 'express';
import { env } from '../../config';
import { getSetting } from '../settings/service';
import { randomToken, sha256 } from './crypto';
import { Session, type SessionDoc, type UserDoc } from './model';

export const SESSION_COOKIE = 'eayni_sid';

export async function createSession(
  user: UserDoc,
  meta: { ip?: string; userAgent?: string; mfaVerified: boolean },
) {
  const maxHours = await getSetting('auth.sessionMaxHours');
  const token = randomToken(32);
  const session = await Session.create({
    userId: user._id,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + maxHours * 3_600_000),
    mfaVerified: meta.mfaVerified,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return { token, session };
}

/**
 * Resolve a token to a live session. Enforces idle timeout and absolute expiry (DECISIONS §2)
 * and bumps lastSeenAt at most once a minute to keep writes cheap.
 */
export async function loadSession(
  token: string,
  now = new Date(),
): Promise<
  | { session: SessionDoc; reason?: never }
  | { session?: never; reason: 'invalid' | 'revoked' | 'expired' | 'idle' }
> {
  const session = await Session.findOne({ tokenHash: sha256(token) });
  if (!session) return { reason: 'invalid' };
  if (session.revokedAt) return { reason: 'revoked' };
  if (session.expiresAt <= now) {
    await revokeSession(session, 'expired');
    return { reason: 'expired' };
  }
  const idleMinutes = await getSetting('auth.sessionIdleMinutes');
  if (now.getTime() - session.lastSeenAt.getTime() > idleMinutes * 60_000) {
    await revokeSession(session, 'idle');
    return { reason: 'idle' };
  }
  if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
    session.lastSeenAt = now;
    await session.save();
  }
  return { session };
}

export async function revokeSession(session: SessionDoc, reason: string): Promise<void> {
  if (session.revokedAt) return;
  session.revokedAt = new Date();
  session.revokedReason = reason;
  await session.save();
}

export async function revokeAllSessions(
  userId: string,
  reason: string,
  exceptSessionId?: string,
): Promise<number> {
  const filter: Record<string, unknown> = { userId, revokedAt: null };
  if (exceptSessionId) filter._id = { $ne: exceptSessionId };
  const r = await Session.updateMany(filter, { $set: { revokedAt: new Date(), revokedReason: reason } });
  return r.modifiedCount;
}

export function setSessionCookie(res: Response, token: string, maxAgeMs: number): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env().COOKIE_SECURE,
    maxAge: maxAgeMs,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}
