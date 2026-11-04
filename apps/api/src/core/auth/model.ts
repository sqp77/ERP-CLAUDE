import { Schema, model } from 'mongoose';
import { ACCOUNT_STATUSES } from '@eayni/shared';

const roleAssignmentSchema = new Schema(
  {
    role: { type: String, required: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
  },
  { _id: false },
);

/**
 * Staff user account [EP §3]. Username is the work email (DECISIONS §2).
 * The employee file itself lives in the HR module; `employeeId` links to it.
 */
const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    displayNameAr: { type: String, required: true },
    passwordHash: { type: String, required: true },
    passwordChangedAt: { type: Date },
    mustChangePassword: { type: Boolean, default: false },
    status: { type: String, enum: ACCOUNT_STATUSES, default: 'active', index: true },
    disabledAt: { type: Date },
    disabledReason: { type: String },
    roles: { type: [roleAssignmentSchema], default: [{ role: 'employee' }] },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
    employeeId: { type: Schema.Types.ObjectId },
    // TOTP second factor (DECISIONS §2). Secrets are encrypted at rest (AES-256-GCM, APP_SECRET).
    totpEnabled: { type: Boolean, default: false },
    totpSecret: { type: String },
    totpPendingSecret: { type: String },
    totpEnabledAt: { type: Date },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: { type: Date },
    lastLoginAt: { type: Date },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

export const User = model('User', userSchema);
export type UserDoc = InstanceType<typeof User>;

/** Opaque server-side session: idle timeout + absolute maximum (DECISIONS §2), revocable [EP §3]. */
const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    createdAt: { type: Date, default: () => new Date() },
    lastSeenAt: { type: Date, default: () => new Date() },
    expiresAt: { type: Date, required: true, index: true },
    mfaVerified: { type: Boolean, default: false },
    ip: { type: String },
    userAgent: { type: String },
    revokedAt: { type: Date },
    revokedReason: { type: String },
  },
  { versionKey: false },
);
export const Session = model('Session', sessionSchema);
export type SessionDoc = InstanceType<typeof Session>;

/** Login / logout log [EP §3 "تسجيل عمليات الدخول والخروج"]. Append-only. */
const loginLogSchema = new Schema(
  {
    at: { type: Date, default: () => new Date(), index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    email: { type: String, index: true },
    event: {
      type: String,
      enum: [
        'login_success',
        'login_failed',
        'login_locked',
        'login_disabled',
        'mfa_failed',
        'mfa_verified',
        'logout',
        'session_revoked',
        'session_expired',
        'password_changed',
        'password_reset_requested',
        'password_reset_done',
      ],
      required: true,
    },
    ip: { type: String },
    userAgent: { type: String },
    sessionId: { type: Schema.Types.ObjectId },
  },
  { versionKey: false },
);
export const LoginLog = model('LoginLog', loginLogSchema);

const passwordResetSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
export const PasswordReset = model('PasswordReset', passwordResetSchema);
