import request from 'supertest';
import type { Express } from 'express';
import type { RoleAssignment } from '@eayni/shared';
import { createApp } from '../app';
import { User } from '../core/auth/model';
import { hashPassword } from '../core/auth/crypto';
import { Department } from '../core/org/model';

let app: Express | undefined;
export function testApp(): Express {
  app ??= createApp();
  return app;
}

export const PASSWORD = 'Passw0rd!2026';

export async function makeUser(
  email: string,
  roles: RoleAssignment[] = [{ role: 'employee' }],
  extra: Record<string, unknown> = {},
) {
  return User.create({
    email,
    displayNameAr: email.split('@')[0],
    passwordHash: await hashPassword(PASSWORD),
    roles,
    ...extra,
  });
}

export async function makeDepartment(code: string, nameAr = code) {
  return Department.create({ code, nameAr, active: true });
}

/** Session token from the login response's httpOnly cookie (the body carries none — review D23). */
export function tokenFromCookies(res: { headers: Record<string, string | string[] | undefined> }): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const sid = list.find((c) => c.startsWith('eayni_sid='));
  if (!sid) throw new Error('no session cookie');
  return decodeURIComponent(sid.split(';')[0].slice('eayni_sid='.length));
}

/** Log in and return a Bearer token (MFA verified when the user has TOTP enabled is the caller's job). */
export async function loginAs(email: string, password = PASSWORD): Promise<string> {
  const res = await request(testApp()).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return tokenFromCookies(res);
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * First login of an account created with a temporary password: the API only allows the password
 * change until it is done (security review A8). Returns a fully usable Bearer token.
 */
export async function activateAccount(email: string, temporaryPassword: string): Promise<string> {
  const token = await loginAs(email, temporaryPassword);
  const res = await request(testApp())
    .post('/api/v1/auth/password/change')
    .set(auth(token))
    .send({ currentPassword: temporaryPassword, newPassword: PASSWORD });
  if (res.status !== 200) throw new Error(`activate failed: ${res.status} ${JSON.stringify(res.body)}`);
  return token;
}
