import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { auth, loginAs, makeDepartment, makeUser, PASSWORD, testApp } from '../../test/helpers';
import { User } from './model';
import * as crypto from './crypto';
import { env, resetEnvCache } from '../../config';
import { setSetting } from '../settings/service';
import { SYSTEM_ACTOR } from '../http/context';
import { Notification } from '../notifications/model';
import { AuditLog } from '../audit/model';
import { Employee } from '../../modules/hr/model';

const app = () => testApp();

describe('hardening review D — passwords', () => {
  it('D20: new hashes use N=2^17 (2^14 in tests); weaker hashes still verify and are upgraded at login', async () => {
    expect(crypto.DEFAULT_SCRYPT_LOG2_N).toBe(17);
    const N = crypto.scryptN();
    const fresh = await crypto.hashPassword(PASSWORD);
    expect(fresh.split('$')[1]).toBe(String(N));
    const legacy = await crypto.hashPasswordWith(PASSWORD, N / 2);
    expect(await crypto.verifyPassword(PASSWORD, legacy)).toBe(true);
    expect(crypto.needsRehash(legacy)).toBe(true);
    expect(crypto.needsRehash(fresh)).toBe(false);
    const user = await User.create({
      email: 'old@eayni.local',
      displayNameAr: 'قديم',
      passwordHash: legacy,
      roles: [{ role: 'employee' }],
    });
    await loginAs('old@eayni.local');
    const after = await User.findById(user._id);
    expect(after!.passwordHash.split('$')[1]).toBe(String(N));
    expect(await crypto.verifyPassword(PASSWORD, after!.passwordHash)).toBe(true);
  });

  it('D23: the login body carries no token (cookie only) and unknown emails still cost a hash check', async () => {
    await makeUser('cookie@eayni.local');
    const res = await request(app())
      .post('/api/v1/auth/login')
      .send({ email: 'cookie@eayni.local', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeUndefined();
    expect(res.headers['set-cookie']?.[0]).toMatch(/eayni_sid=/);
    const spy = vi.spyOn(crypto.passwordCheck, 'verify');
    const miss = await request(app())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@eayni.local', password: PASSWORD });
    expect(miss.status).toBe(401);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('hardening review D — keys and ciphertexts', () => {
  afterEach(() => {
    delete process.env.APP_SECRET_PREVIOUS;
    process.env.APP_SECRET = 'test-secret-test-secret-test-secret';
    resetEnvCache();
  });

  it('D21: purposes derive different keys; ciphertexts carry a key id; legacy v1 still decrypts', () => {
    expect(crypto.deriveKey('field').equals(crypto.deriveKey('totp'))).toBe(false);
    expect(crypto.deriveKey('sign').equals(crypto.deriveKey('field'))).toBe(false);
    const c = crypto.encrypt('1234567890', 'field');
    expect(c.startsWith(`v2:${crypto.keyId()}:`)).toBe(true);
    expect(crypto.decrypt(c, 'field')).toBe('1234567890');
    expect(() => crypto.decrypt(c, 'totp')).toThrow();
    // v1 (sha256(APP_SECRET) key, no key id) as written before this change.
    const key = createHash('sha256').update(env().APP_SECRET).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update('legacy', 'utf8'), cipher.final()]);
    const v1 = `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
    expect(crypto.decrypt(v1, 'field')).toBe('legacy');
  });

  it('D21: APP_SECRET can be rotated — the previous secret still decrypts by key id', () => {
    const underOld = crypto.encrypt('iban-xyz', 'field');
    const oldKid = crypto.keyId();
    process.env.APP_SECRET_PREVIOUS = process.env.APP_SECRET;
    process.env.APP_SECRET = 'rotated-secret-rotated-secret-0001';
    resetEnvCache();
    expect(crypto.keyId()).not.toBe(oldKid);
    expect(crypto.decrypt(underOld, 'field')).toBe('iban-xyz');
    expect(crypto.encrypt('x', 'field').startsWith(`v2:${crypto.keyId()}:`)).toBe(true);
  });
});

describe('hardening review D — duplicate employees [HR §3.3, golden rule 2]', () => {
  it('D22: the national ID has an HMAC blind index with a unique constraint', async () => {
    await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
    const dept = await makeDepartment('ops', 'التشغيل');
    await makeUser('hr@eayni.local', [{ role: 'employee' }, { role: 'hr_officer' }]);
    const hr = await loginAs('hr@eayni.local');
    const body = (email: string) => ({
      firstNameAr: 'خالد',
      lastNameAr: 'العمري',
      gender: 'male',
      nationality: 'سعودي',
      workEmail: email,
      identity: { type: 'national_id', number: '1077777777' },
      hireDate: '2024-01-10',
      departmentId: String(dept._id),
      createAccount: false,
    });
    const first = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send(body('k1@eayni.local'));
    expect(first.status).toBe(201);
    const stored = await Employee.findById(first.body._id).lean();
    expect(stored!.identity!.hash).toBeTruthy();
    expect(stored!.identity!.hash).not.toContain('1077777777');
    const dup = await request(app()).post('/api/v1/hr/employees').set(auth(hr)).send(body('k2@eayni.local'));
    expect(dup.status).toBe(409);
    // Changing the number changes the index; colliding with another employee is refused too.
    const other = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send({ ...body('k3@eayni.local'), identity: { type: 'national_id', number: '1088888888' } });
    expect(other.status).toBe(201);
    const clash = await request(app())
      .patch(`/api/v1/hr/employees/${other.body._id}`)
      .set(auth(hr))
      .send({ identity: { type: 'national_id', number: '1077777777' } });
    expect(clash.status).toBe(409);
  });
});

describe('hardening review D — security-relevant changes alert the admins', () => {
  it('D24: workflow edits and the MFA-roles setting are audited and notified', async () => {
    const admin1 = await makeUser('root1@eayni.local', [{ role: 'system_admin' }]);
    await makeUser('root2@eayni.local', [{ role: 'system_admin' }]);
    await makeUser('hrm@eayni.local', [{ role: 'employee' }, { role: 'hr_manager' }]);
    await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
    const hrm = await loginAs('hrm@eayni.local');
    const current = (await request(app()).get('/api/v1/workflows/hr_request').set(auth(hrm))).body;
    const put = await request(app())
      .put('/api/v1/workflows/hr_request')
      .set(auth(hrm))
      .send({ ...current, nameAr: 'طلب موظف (معدّل)' });
    expect(put.status).toBe(200);
    expect(await AuditLog.countDocuments({ resource: 'workflows', resourceId: 'hr_request' })).toBe(1);
    expect(await Notification.countDocuments({ type: 'security.alert', 'data.kind': 'workflow' })).toBe(2);

    const root2 = await loginAs('root2@eayni.local');
    const set = await request(app())
      .put('/api/v1/settings/auth.mfaRequiredRoles')
      .set(auth(root2))
      .send({ value: ['system_admin'] });
    expect(set.status).toBe(200);
    expect(await AuditLog.countDocuments({ resource: 'settings', resourceId: 'auth.mfaRequiredRoles' })).toBe(
      2,
    );
    expect(
      await Notification.countDocuments({
        userId: admin1._id,
        type: 'security.alert',
        'data.kind': 'setting',
      }),
    ).toBe(1);
  });
});
