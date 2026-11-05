import type { CurrentUser } from '@eayni/shared';
import { badRequest, forbidden, unauthorized } from '../http/errors';
import type { Actor } from '../http/context';
import { recordAudit } from '../audit/service';
import { getSetting } from '../settings/service';
import { flattenPermissions } from '../rbac/service';
import { notify } from '../notifications/service';
import { env, isProd } from '../../config';
import {
  decrypt,
  dummyPasswordHash,
  encrypt,
  hashPassword,
  needsRehash,
  passwordCheck,
  randomToken,
  sha256,
  verifyPassword,
} from './crypto';
import { notifySystemAdmins } from '../notifications/alerts';
import { LoginLog, PasswordReset, Session, User, type SessionDoc, type UserDoc } from './model';
import { mfaRequiredFor } from './middleware';
import { createSession, revokeAllSessions, revokeSession } from './session';
import { currentTotp, generateTotpSecret, totpQrDataUrl, totpUri, verifyTotp } from './totp';

export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

async function log(
  event: string,
  data: { userId?: unknown; email?: string; sessionId?: unknown } & ClientMeta,
) {
  await LoginLog.create({ event, ...data });
}

export async function login(email: string, password: string, meta: ClientMeta) {
  const user = await User.findOne({ email: email.toLowerCase(), deletedAt: null });
  const generic = unauthorized('البريد الإلكتروني أو كلمة المرور غير صحيحة', 'invalid_credentials');
  if (!user) {
    // Same cost as a wrong password so response time does not reveal which emails exist (review D23).
    await passwordCheck.verify(password, await dummyPasswordHash());
    await log('login_failed', { email, ...meta });
    throw generic;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await log('login_locked', { userId: user._id, email, ...meta });
    throw unauthorized('تم قفل الحساب مؤقتًا بسبب محاولات فاشلة متكررة، حاول لاحقًا', 'account_locked');
  }
  const ok = await passwordCheck.verify(password, user.passwordHash);
  if (!ok) {
    user.failedLogins += 1;
    const max = await getSetting('auth.maxFailedLogins');
    if (user.failedLogins >= max) {
      const minutes = await getSetting('auth.lockoutMinutes');
      user.lockedUntil = new Date(Date.now() + minutes * 60_000);
      user.failedLogins = 0;
    }
    await user.save();
    await log('login_failed', { userId: user._id, email, ...meta });
    throw generic;
  }
  if (user.status !== 'active') {
    await log('login_disabled', { userId: user._id, email, ...meta });
    throw unauthorized('الحساب معطّل، تواصل مع مدير النظام', 'account_disabled');
  }
  // Temporary passwords expire (security review A8): the admin must issue a new one.
  if (user.mustChangePassword) {
    const hours = await getSetting('auth.temporaryPasswordHours');
    const issuedAt = user.passwordChangedAt ?? user.createdAt ?? new Date(0);
    if (Date.now() - new Date(issuedAt).getTime() > hours * 3_600_000) {
      await log('login_temp_password_expired', { userId: user._id, email, ...meta });
      throw unauthorized(
        'انتهت صلاحية كلمة المرور المؤقتة، اطلب كلمة مرور جديدة من مدير النظام',
        'temporary_password_expired',
      );
    }
  }
  user.failedLogins = 0;
  user.lockedUntil = undefined;
  user.lastLoginAt = new Date();
  // Upgrade hashes made under a weaker cost (review D20).
  if (needsRehash(user.passwordHash)) user.passwordHash = await hashPassword(password);
  await user.save();

  const roleCodes = user.roles.map((r) => r.role);
  const required = await mfaRequiredFor(roleCodes);
  const mfa: 'none' | 'required' | 'enroll_required' = user.totpEnabled
    ? 'required'
    : required
      ? 'enroll_required'
      : 'none';
  const { token, session } = await createSession(user, { ...meta, mfaVerified: mfa === 'none' });
  await log('login_success', { userId: user._id, email, sessionId: session._id, ...meta });
  const maxHours = await getSetting('auth.sessionMaxHours');
  return { user, token, session, mfa, maxAgeMs: maxHours * 3_600_000 };
}

export async function logout(session: SessionDoc, user: UserDoc, meta: ClientMeta): Promise<void> {
  await revokeSession(session, 'logout');
  await log('logout', { userId: user._id, email: user.email, sessionId: session._id, ...meta });
}

export async function verifyMfa(
  user: UserDoc,
  session: SessionDoc,
  code: string,
  meta: ClientMeta,
): Promise<void> {
  if (!user.totpEnabled || !user.totpSecret) throw badRequest('التحقق الثنائي غير مفعّل');
  if (session.mfaVerified) return;
  const codeHash = sha256(`${user._id}:${code}`);
  // Replay guard: a code accepted within the last window (±1 step of 30 s) is never accepted again (security review A2).
  const replayed =
    user.totpLastCodeHash === codeHash &&
    !!user.totpLastCodeAt &&
    Date.now() - user.totpLastCodeAt.getTime() < TOTP_REPLAY_WINDOW_MS;
  if (replayed || !verifyTotp(code, decrypt(user.totpSecret, 'totp'))) {
    session.mfaFailedAttempts = (session.mfaFailedAttempts ?? 0) + 1;
    const base = { userId: user._id, email: user.email, sessionId: session._id, ...meta };
    await log(replayed ? 'mfa_replayed' : 'mfa_failed', base);
    if (session.mfaFailedAttempts >= MFA_MAX_ATTEMPTS) {
      await revokeSession(session, 'mfa_locked');
      await log('mfa_locked', base);
      throw unauthorized('تم إنهاء الجلسة بعد محاولات تحقق فاشلة متكررة، سجّل الدخول مجددًا', 'mfa_locked');
    }
    await session.save();
    throw unauthorized(
      replayed ? 'هذا الرمز استُخدم للتو، انتظر الرمز التالي' : 'رمز التحقق غير صحيح',
      replayed ? 'mfa_replayed' : 'mfa_invalid',
    );
  }
  user.totpLastCodeHash = codeHash;
  user.totpLastCodeAt = new Date();
  await user.save();
  session.mfaVerified = true;
  session.mfaFailedAttempts = 0;
  await session.save();
  await log('mfa_verified', { userId: user._id, email: user.email, sessionId: session._id, ...meta });
}

const MFA_MAX_ATTEMPTS = 5;
/** otplib window = 1 → codes from the previous, current and next 30-second step are valid. */
const TOTP_REPLAY_WINDOW_MS = 3 * 30_000;

/** Enrollment (first or replacement) needs a fully verified session once an authenticator exists (security review A1). */
function assertMayEnroll(user: UserDoc, session: SessionDoc): void {
  if (user.totpEnabled && !session.mfaVerified)
    throw unauthorized('يلزم إدخال رمز التحقق الحالي قبل تغيير تطبيق المصادقة', 'mfa_required');
}

export async function startMfaEnrollment(user: UserDoc, session: SessionDoc) {
  assertMayEnroll(user, session);
  const secret = generateTotpSecret();
  user.totpPendingSecret = encrypt(secret, 'totp');
  await user.save();
  const uri = totpUri(user.email, secret);
  return { otpauthUrl: uri, qrDataUrl: await totpQrDataUrl(uri), manualKey: secret };
}

export async function confirmMfaEnrollment(
  user: UserDoc,
  session: SessionDoc,
  code: string,
  actor: Actor,
): Promise<void> {
  assertMayEnroll(user, session);
  if (!user.totpPendingSecret) throw badRequest('ابدأ التفعيل أولًا');
  const secret = decrypt(user.totpPendingSecret, 'totp');
  if (!verifyTotp(code, secret)) throw unauthorized('رمز التحقق غير صحيح', 'mfa_invalid');
  user.totpSecret = user.totpPendingSecret;
  user.totpPendingSecret = undefined;
  user.totpEnabled = true;
  user.totpEnabledAt = new Date();
  await user.save();
  session.mfaVerified = true;
  await session.save();
  await recordAudit(actor, {
    action: 'update',
    resource: 'users',
    resourceId: String(user._id),
    meta: { mfa: 'enabled' },
  });
}

export async function disableMfa(user: UserDoc, code: string, actor: Actor): Promise<void> {
  if (await mfaRequiredFor(user.roles.map((r) => r.role)))
    throw forbidden('التحقق الثنائي إلزامي لدورك ولا يمكن تعطيله');
  if (!user.totpEnabled || !user.totpSecret) throw badRequest('التحقق الثنائي غير مفعّل');
  if (!verifyTotp(code, decrypt(user.totpSecret, 'totp')))
    throw unauthorized('رمز التحقق غير صحيح', 'mfa_invalid');
  user.totpEnabled = false;
  user.totpSecret = undefined;
  await user.save();
  await recordAudit(actor, {
    action: 'update',
    resource: 'users',
    resourceId: String(user._id),
    meta: { mfa: 'disabled' },
  });
}

/**
 * Admin resets a lost authenticator (security review A1): secrets are dropped, every session is revoked,
 * the action is audited and the user plus the other system admins are told. If the user's role requires
 * MFA, the next login forces a fresh enrollment.
 */
export async function resetMfaByAdmin(target: UserDoc, actor: Actor, meta: ClientMeta): Promise<void> {
  if (String(target._id) === actor.userId)
    throw forbidden('أعد تفعيل المصادقة من صفحة الأمان، لا عبر الإعادة الإدارية');
  const had = target.totpEnabled;
  target.totpEnabled = false;
  target.totpSecret = undefined;
  target.totpPendingSecret = undefined;
  target.totpLastCodeHash = undefined;
  target.totpLastCodeAt = undefined;
  await target.save();
  await revokeAllSessions(String(target._id), 'mfa_reset');
  await log('mfa_reset', { userId: target._id, email: target.email, ...meta });
  await recordAudit(actor, {
    action: 'update',
    resource: 'users',
    resourceId: String(target._id),
    before: { totpEnabled: had },
    after: { totpEnabled: false },
    meta: { mfaReset: true },
  });
  await notify({
    userIds: [String(target._id)],
    type: 'security.alert',
    bodyAr: 'أعاد مدير النظام تعيين تطبيق المصادقة لحسابك. إن لم تطلب ذلك فتواصل مع التقنية فورًا.',
    link: '/me/security',
  });
  await notifySystemAdmins({
    bodyAr: `تمت إعادة تعيين المصادقة الثنائية للمستخدم ${target.email} بواسطة ${actor.email ?? 'النظام'}`,
    link: '/admin/users',
    excludeUserId: actor.userId,
  });
}

/** Temporary password that always satisfies the policy (letters + digits, length ≥ policy minimum). */
export async function generateTemporaryPassword(): Promise<string> {
  const min = await getSetting('auth.passwordMinLength');
  for (;;) {
    const candidate = randomToken(Math.max(9, Math.ceil(min * 0.75))).replace(/[-_]/g, 'a');
    if (candidate.length >= min && /[A-Za-z]/.test(candidate) && /\d/.test(candidate)) return candidate;
  }
}

export async function validatePasswordPolicy(password: string): Promise<void> {
  const min = await getSetting('auth.passwordMinLength');
  if (password.length < min) throw badRequest(`كلمة المرور يجب ألا تقل عن ${min} أحرف`);
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password))
    throw badRequest('كلمة المرور يجب أن تحتوي على أحرف وأرقام');
}

export async function changePassword(
  user: UserDoc,
  session: SessionDoc,
  current: string,
  next: string,
  meta: ClientMeta,
): Promise<void> {
  // A password-only session must not change the password of a user who has an authenticator (security review A8).
  if (user.totpEnabled && !session.mfaVerified)
    throw unauthorized('يلزم إدخال رمز التحقق أولًا', 'mfa_required');
  if (!(await verifyPassword(current, user.passwordHash)))
    throw unauthorized('كلمة المرور الحالية غير صحيحة', 'invalid_credentials');
  await validatePasswordPolicy(next);
  user.passwordHash = await hashPassword(next);
  user.passwordChangedAt = new Date();
  user.mustChangePassword = false;
  await user.save();
  await revokeAllSessions(String(user._id), 'password_changed', String(session._id));
  await log('password_changed', { userId: user._id, email: user.email, sessionId: session._id, ...meta });
}

/** Always responds the same way whether or not the email exists. Returns the token only outside production (dev/test). */
export async function requestPasswordReset(
  email: string,
  meta: ClientMeta,
): Promise<{ debugToken?: string }> {
  const user = await User.findOne({ email: email.toLowerCase(), status: 'active', deletedAt: null });
  if (!user) return {};
  const token = randomToken(32);
  await PasswordReset.create({
    userId: user._id,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 60 * 60_000),
  });
  await log('password_reset_requested', { userId: user._id, email, ...meta });
  const link = `${env().APP_URL}/reset-password?token=${token}`;
  await notify({
    userIds: [String(user._id)],
    type: 'auth.password_reset',
    bodyAr: 'تم طلب إعادة تعيين كلمة المرور لحسابك. إن لم تكن أنت، تجاهل هذه الرسالة.',
    link,
    email: {
      subject: 'إعادة تعيين كلمة المرور',
      text: `لإعادة تعيين كلمة المرور افتح الرابط التالي خلال ساعة:\n${link}`,
    },
    inApp: false,
  });
  return isProd() ? {} : { debugToken: token };
}

export async function resetPassword(token: string, newPassword: string, meta: ClientMeta): Promise<void> {
  const pr = await PasswordReset.findOne({
    tokenHash: sha256(token),
    usedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (!pr) throw badRequest('رابط إعادة التعيين غير صالح أو منتهي');
  const user = await User.findById(pr.userId);
  if (!user || user.status !== 'active') throw badRequest('الحساب غير متاح');
  await validatePasswordPolicy(newPassword);
  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  user.mustChangePassword = false;
  user.failedLogins = 0;
  user.lockedUntil = undefined;
  await user.save();
  pr.usedAt = new Date();
  await pr.save();
  await revokeAllSessions(String(user._id), 'password_reset');
  await log('password_reset_done', { userId: user._id, email: user.email, ...meta });
}

export async function listSessions(userId: string) {
  return Session.find({ userId, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ lastSeenAt: -1 })
    .select('createdAt lastSeenAt expiresAt ip userAgent mfaVerified')
    .lean();
}

export async function toCurrentUser(user: UserDoc): Promise<CurrentUser> {
  const roles = user.roles.map((r) => ({
    role: r.role,
    departmentId: r.departmentId ? String(r.departmentId) : undefined,
  }));
  return {
    id: String(user._id),
    email: user.email,
    displayNameAr: user.displayNameAr,
    roles,
    departmentId: user.departmentId ? String(user.departmentId) : undefined,
    employeeId: user.employeeId ? String(user.employeeId) : undefined,
    status: user.status,
    mfaEnabled: user.totpEnabled,
    mfaRequired: await mfaRequiredFor(roles.map((r) => r.role)),
    permissions: await flattenPermissions(roles),
  };
}

/** Test helper: compute the current TOTP for a user's enabled secret. */
export function debugCurrentTotp(user: UserDoc): string {
  if (!user.totpSecret) throw new Error('no secret');
  return currentTotp(decrypt(user.totpSecret, 'totp'));
}
