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

export async function makeUser(email: string, roles: RoleAssignment[] = [{ role: 'employee' }], extra: Record<string, unknown> = {}) {
  return User.create({ email, displayNameAr: email.split('@')[0], passwordHash: await hashPassword(PASSWORD), roles, ...extra });
}

export async function makeDepartment(code: string, nameAr = code) {
  return Department.create({ code, nameAr, active: true });
}

/** Log in and return a Bearer token (MFA verified when the user has TOTP enabled is the caller's job). */
export async function loginAs(email: string, password = PASSWORD): Promise<string> {
  const res = await request(testApp()).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token as string;
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
