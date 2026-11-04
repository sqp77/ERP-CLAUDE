import { z } from 'zod';
import { emailSchema } from './common';

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'كلمة المرور مطلوبة'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const mfaCodeSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'رمز التحقق مكوّن من 6 أرقام'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20),
  newPassword: z.string().min(8),
});

/** Result of a login: the client decides what to show next. */
export type LoginResult = {
  mfa: 'none' | 'required' | 'enroll_required';
};
