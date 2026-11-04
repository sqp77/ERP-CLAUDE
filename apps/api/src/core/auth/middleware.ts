import type { RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { unauthorized } from '../http/errors';
import type { AuthedRequest } from '../http/context';
import { getSetting } from '../settings/service';
import { User } from './model';
import { loadSession, SESSION_COOKIE } from './session';

export interface RequireAuthOptions {
  /** Allow a session whose second factor is not yet verified (only for the MFA endpoints themselves). */
  allowMfaPending?: boolean;
}

function extractToken(req: AuthedRequest): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
  return cookies?.[SESSION_COOKIE];
}

/** Does this user's role set require a second factor? (DECISIONS §2) */
export async function mfaRequiredFor(roleCodes: string[]): Promise<boolean> {
  const required = await getSetting('auth.mfaRequiredRoles');
  return roleCodes.some((r) => required.includes(r));
}

export function requireAuth(opts: RequireAuthOptions = {}): RequestHandler {
  return (req, _res, next) => {
    const r = req as AuthedRequest;
    const token = extractToken(r);
    if (!token) return next(unauthorized('يلزم تسجيل الدخول'));
    (async () => {
      const loaded = await loadSession(token);
      if (!loaded.session) {
        const map = { invalid: 'invalid_session', revoked: 'session_revoked', expired: 'session_expired', idle: 'session_idle' } as const;
        throw unauthorized('انتهت الجلسة، يرجى تسجيل الدخول مجددًا', map[loaded.reason]);
      }
      const user = await User.findById(loaded.session.userId);
      if (!user || user.status !== 'active' || user.deletedAt) throw unauthorized('الحساب غير نشط', 'account_disabled');
      const roleCodes = [...new Set(user.roles.map((x) => x.role))];
      if (!opts.allowMfaPending) {
        const required = await mfaRequiredFor(roleCodes);
        if (required && !user.totpEnabled) throw unauthorized('يلزم تفعيل التحقق الثنائي', 'mfa_enrollment_required');
        if (user.totpEnabled && !loaded.session.mfaVerified) throw unauthorized('يلزم إدخال رمز التحقق', 'mfa_required');
      }
      r.auth = {
        user,
        session: loaded.session,
        roleCodes,
        ip: req.ip ?? '',
        userAgent: String(req.headers['user-agent'] ?? ''),
        requestId: String(req.headers['x-request-id'] ?? randomUUID()),
      };
      next();
    })().catch(next);
  };
}
