import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaCodeSchema,
  resetPasswordSchema,
} from '@eayni/shared';
import { asyncHandler } from '../http/async';
import { validate } from '../http/validate';
import { actorFrom, type AuthedRequest } from '../http/context';
import { notFound } from '../http/errors';
import { isTest } from '../../config';
import * as auth from './service';
import { requireAuth } from './middleware';
import { Session } from './model';
import { clearSessionCookie, revokeSession, setSessionCookie } from './session';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: isTest() ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'محاولات كثيرة، حاول بعد قليل' } },
});

const meta = (req: Request) => ({ ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '') });

authRouter.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    const result = await auth.login(email, password, meta(req));
    setSessionCookie(res, result.token, result.maxAgeMs);
    res.json({ mfa: result.mfa, token: result.token, user: await auth.toCurrentUser(result.user) });
  }),
);

authRouter.post(
  '/logout',
  requireAuth({ allowMfaPending: true }),
  asyncHandler(async (req: AuthedRequest, res) => {
    await auth.logout(req.auth.session, req.auth.user, meta(req));
    clearSessionCookie(res);
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  requireAuth({ allowMfaPending: true }),
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await auth.toCurrentUser(req.auth.user);
    const pending =
      user.mfaEnabled && !req.auth.session.mfaVerified
        ? 'required'
        : user.mfaRequired && !user.mfaEnabled
          ? 'enroll_required'
          : 'none';
    res.json({ user, mfa: pending, mustChangePassword: req.auth.user.mustChangePassword });
  }),
);

authRouter.post(
  '/mfa/verify',
  requireAuth({ allowMfaPending: true }),
  validate(mfaCodeSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    await auth.verifyMfa(req.auth.user, req.auth.session, (req.body as { code: string }).code, meta(req));
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/mfa/enroll/start',
  requireAuth({ allowMfaPending: true }),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await auth.startMfaEnrollment(req.auth.user));
  }),
);

authRouter.post(
  '/mfa/enroll/confirm',
  requireAuth({ allowMfaPending: true }),
  validate(mfaCodeSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    await auth.confirmMfaEnrollment(
      req.auth.user,
      req.auth.session,
      (req.body as { code: string }).code,
      actorFrom(req),
    );
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/mfa/disable',
  requireAuth(),
  validate(mfaCodeSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    await auth.disableMfa(req.auth.user, (req.body as { code: string }).code, actorFrom(req));
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/password/change',
  requireAuth({ allowMfaPending: true }),
  validate(changePasswordSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
    await auth.changePassword(req.auth.user, req.auth.session, currentPassword, newPassword, meta(req));
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/password/forgot',
  loginLimiter,
  validate(forgotPasswordSchema),
  asyncHandler(async (req, res) => {
    const out = await auth.requestPasswordReset((req.body as { email: string }).email, meta(req));
    res.json({ ok: true, ...out });
  }),
);

authRouter.post(
  '/password/reset',
  loginLimiter,
  validate(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    const { token, newPassword } = req.body as { token: string; newPassword: string };
    await auth.resetPassword(token, newPassword, meta(req));
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/sessions',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const items = await auth.listSessions(String(req.auth.user._id));
    res.json({
      items: items.map((s) => ({ ...s, current: String(s._id) === String(req.auth.session._id) })),
    });
  }),
);

authRouter.delete(
  '/sessions/:id',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const s = await Session.findOne({ _id: req.params.id, userId: req.auth.user._id });
    if (!s) throw notFound();
    await revokeSession(s, 'revoked_by_user');
    res.status(204).end();
  }),
);
