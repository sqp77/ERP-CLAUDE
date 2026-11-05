import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { auth, loginAs, makeUser, PASSWORD, testApp } from '../../test/helpers';
import { LoginLog, Session, User } from './model';
import { debugCurrentTotp } from './service';
import { currentTotp } from './totp';
import { encrypt } from './crypto';
import { generateTotpSecret } from './totp';
import { AuditLog } from '../audit/model';
import { Notification } from '../notifications/model';
import { setSetting } from '../settings/service';
import { SYSTEM_ACTOR } from '../http/context';

const app = () => testApp();

/** A user whose authenticator is already enrolled. */
async function enrolledUser(email: string, roles = [{ role: 'employee' }]) {
  const secret = generateTotpSecret();
  const user = await makeUser(email, roles, {
    totpEnabled: true,
    totpSecret: encrypt(secret, 'totp'),
    totpEnabledAt: new Date(),
  });
  return { user, secret };
}

async function loginPending(email: string) {
  const res = await request(app()).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(res.body.mfa).toBe('required');
  return res.headers['set-cookie'][0].split(';')[0].split('=')[1] as string;
}

describe('security review A — MFA [EP §3, DECISIONS §2]', () => {
  it('A1: a password-only session cannot replace an enrolled authenticator', async () => {
    const { user, secret } = await enrolledUser('mfa1@eayni.local');
    const t = await loginPending('mfa1@eayni.local');
    const start = await request(app()).post('/api/v1/auth/mfa/enroll/start').set(auth(t));
    expect(start.status).toBe(401);
    expect(start.body.error.code).toBe('mfa_required');
    const confirm = await request(app())
      .post('/api/v1/auth/mfa/enroll/confirm')
      .set(auth(t))
      .send({ code: '123456' });
    expect(confirm.status).toBe(401);
    // After the second factor is verified, re-enrollment is allowed.
    await request(app())
      .post('/api/v1/auth/mfa/verify')
      .set(auth(t))
      .send({ code: currentTotp(secret) });
    const ok = await request(app()).post('/api/v1/auth/mfa/enroll/start').set(auth(t));
    expect(ok.status).toBe(200);
    expect((await User.findById(user._id))!.totpSecret).toBeTruthy();
  });

  it('A1: resetting a lost authenticator is an audited admin action', async () => {
    await makeUser('root@eayni.local', [{ role: 'system_admin' }]);
    await makeUser('hro@eayni.local', [{ role: 'hr_officer' }]);
    await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
    const { user } = await enrolledUser('lost@eayni.local');
    const pending = await loginPending('lost@eayni.local');
    const hr = await loginAs('hro@eayni.local');
    expect((await request(app()).post(`/api/v1/users/${user._id}/mfa/reset`).set(auth(hr))).status).toBe(403);
    const admin = await loginAs('root@eayni.local');
    const res = await request(app()).post(`/api/v1/users/${user._id}/mfa/reset`).set(auth(admin));
    expect(res.status).toBe(200);
    const after = await User.findById(user._id);
    expect(after!.totpEnabled).toBe(false);
    expect(after!.totpSecret).toBeFalsy();
    expect(await AuditLog.countDocuments({ resource: 'users', 'meta.mfaReset': true })).toBe(1);
    // The pending session of the user is gone; the user logs in again without a second factor.
    expect((await request(app()).get('/api/v1/auth/me').set(auth(pending))).status).toBe(401);
    const again = await request(app())
      .post('/api/v1/auth/login')
      .send({ email: 'lost@eayni.local', password: PASSWORD });
    expect(again.body.mfa).toBe('none');
  });

  it('A2: five wrong codes revoke the session and are logged as mfa_locked', async () => {
    await enrolledUser('brute@eayni.local');
    const t = await loginPending('brute@eayni.local');
    let last = 0;
    for (let i = 0; i < 5; i++) {
      const r = await request(app()).post('/api/v1/auth/mfa/verify').set(auth(t)).send({ code: '000000' });
      last = r.status;
    }
    expect(last).toBe(401);
    expect(await LoginLog.countDocuments({ event: 'mfa_locked' })).toBe(1);
    const me = await request(app()).get('/api/v1/auth/me').set(auth(t));
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('session_revoked');
    expect((await Session.findOne({}))!.revokedReason).toBe('mfa_locked');
  });

  it('A2: a code that was already used in this time window is rejected', async () => {
    const { secret } = await enrolledUser('replay@eayni.local');
    const t1 = await loginPending('replay@eayni.local');
    const t2 = await loginPending('replay@eayni.local');
    const code = currentTotp(secret);
    const first = await request(app()).post('/api/v1/auth/mfa/verify').set(auth(t1)).send({ code });
    expect(first.status).toBe(200);
    const second = await request(app()).post('/api/v1/auth/mfa/verify').set(auth(t2)).send({ code });
    expect(second.status).toBe(401);
    expect(second.body.error.code).toBe('mfa_replayed');
  });
});

describe('security review A — role escalation [HR §6, FIN §12]', () => {
  it('A5: HR may grant only employee and department_manager; changes are audited and admins notified', async () => {
    const root = await makeUser('root2@eayni.local', [{ role: 'system_admin' }]);
    await makeUser('hr5@eayni.local', [{ role: 'employee' }, { role: 'hr_officer' }]);
    await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
    const hr = await loginAs('hr5@eayni.local');
    const esc = await request(app())
      .post('/api/v1/users')
      .set(auth(hr))
      .send({ email: 'x1@eayni.local', displayNameAr: 'مستخدم', roles: [{ role: 'system_admin' }] });
    expect(esc.status).toBe(403);
    const fin = await request(app())
      .post('/api/v1/users')
      .set(auth(hr))
      .send({ email: 'x2@eayni.local', displayNameAr: 'مستخدم', roles: [{ role: 'finance_manager' }] });
    expect(fin.status).toBe(403);
    const ok = await request(app())
      .post('/api/v1/users')
      .set(auth(hr))
      .send({
        email: 'x3@eayni.local',
        displayNameAr: 'مدير قسم',
        roles: [{ role: 'employee' }, { role: 'department_manager' }],
      });
    expect(ok.status).toBe(201);
    const patch = await request(app())
      .patch(`/api/v1/users/${ok.body._id}`)
      .set(auth(hr))
      .send({ roles: [{ role: 'employee' }, { role: 'hr_officer' }] });
    expect(patch.status).toBe(403);
    // Removing a role you may not grant is refused as well.
    const victim = await makeUser('x4@eayni.local', [{ role: 'employee' }, { role: 'finance_manager' }]);
    const strip = await request(app())
      .patch(`/api/v1/users/${victim._id}`)
      .set(auth(hr))
      .send({ roles: [{ role: 'employee' }] });
    expect(strip.status).toBe(403);
    // Admin can; the change is audited with the diff and system admins are notified.
    const admin = await loginAs('root2@eayni.local');
    const grant = await request(app())
      .patch(`/api/v1/users/${ok.body._id}`)
      .set(auth(admin))
      .send({ roles: [{ role: 'employee' }, { role: 'hr_officer' }] });
    expect(grant.status).toBe(200);
    const audit = await AuditLog.findOne({
      resource: 'users',
      resourceId: String(ok.body._id),
      'meta.roleChanges': { $exists: true },
    }).lean();
    expect(audit).toBeTruthy();
    expect((audit!.meta as { roleChanges: { added: string[] } }).roleChanges.added).toEqual(['hr_officer']);
    expect(await Notification.countDocuments({ userId: root._id, type: 'security.alert' })).toBeGreaterThan(
      0,
    );
  });
});

describe('security review A — temporary passwords [EP §3, HR §3.10]', () => {
  it('A8: a temporary password only reaches the password-change endpoints and expires after 72 hours', async () => {
    await makeUser('root3@eayni.local', [{ role: 'system_admin' }]);
    await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
    const admin = await loginAs('root3@eayni.local');
    const created = await request(app())
      .post('/api/v1/users')
      .set(auth(admin))
      .send({ email: 'temp@eayni.local', displayNameAr: 'مؤقت', roles: [{ role: 'employee' }] });
    expect(created.status).toBe(201);
    const temp = created.body.temporaryPassword as string;
    const t = await loginAs('temp@eayni.local', temp);
    expect((await request(app()).get('/api/v1/auth/me').set(auth(t))).status).toBe(200);
    const blocked = await request(app()).get('/api/v1/notifications').set(auth(t));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('password_change_required');
    const change = await request(app())
      .post('/api/v1/auth/password/change')
      .set(auth(t))
      .send({ currentPassword: temp, newPassword: 'Fresh0ne!2026' });
    expect(change.status).toBe(200);
    const t2 = await loginAs('temp@eayni.local', 'Fresh0ne!2026');
    expect((await request(app()).get('/api/v1/notifications').set(auth(t2))).status).toBe(200);

    // Expiry: a temporary password older than the setting is refused at login.
    const second = await request(app())
      .post('/api/v1/users')
      .set(auth(admin))
      .send({ email: 'temp2@eayni.local', displayNameAr: 'مؤقت', roles: [{ role: 'employee' }] });
    await User.updateOne(
      { email: 'temp2@eayni.local' },
      { $set: { passwordChangedAt: new Date(Date.now() - 73 * 3_600_000) } },
    );
    const late = await request(app())
      .post('/api/v1/auth/login')
      .send({ email: 'temp2@eayni.local', password: second.body.temporaryPassword });
    expect(late.status).toBe(401);
    expect(late.body.error.code).toBe('temporary_password_expired');
  });

  it('A8: changing the password needs an MFA-verified session when the user has an authenticator', async () => {
    const { secret } = await enrolledUser('pw@eayni.local');
    const t = await loginPending('pw@eayni.local');
    const denied = await request(app())
      .post('/api/v1/auth/password/change')
      .set(auth(t))
      .send({ currentPassword: PASSWORD, newPassword: 'Another0ne!2026' });
    expect(denied.status).toBe(401);
    expect(denied.body.error.code).toBe('mfa_required');
    await request(app())
      .post('/api/v1/auth/mfa/verify')
      .set(auth(t))
      .send({ code: currentTotp(secret) });
    const ok = await request(app())
      .post('/api/v1/auth/password/change')
      .set(auth(t))
      .send({ currentPassword: PASSWORD, newPassword: 'Another0ne!2026' });
    expect(ok.status).toBe(200);
    expect(debugCurrentTotp((await User.findOne({ email: 'pw@eayni.local' }))!)).toHaveLength(6);
  });
});

describe('slice 5 review follow-ups — MFA and roles', () => {
  it('F1: ten wrong codes within the window lock MFA for the user across sessions, log it and alert admins', async () => {
    const root = await makeUser('root9@eayni.local', [{ role: 'system_admin' }]);
    const { secret } = await enrolledUser('lockme@eayni.local');
    let last = 0;
    for (let s = 0; s < 3; s++) {
      const t = await loginPending('lockme@eayni.local');
      for (let i = 0; i < 4; i++) {
        last = (await request(app()).post('/api/v1/auth/mfa/verify').set(auth(t)).send({ code: '000000' }))
          .status;
      }
    }
    expect(last).toBe(401);
    expect(await LoginLog.countDocuments({ event: 'mfa_user_locked' })).toBe(1);
    expect(
      await Notification.countDocuments({
        userId: root._id,
        type: 'security.alert',
        'data.kind': 'mfa_user_locked',
      }),
    ).toBe(1);
    // A fresh login with the right code is refused while the lock lasts.
    const t = await loginPending('lockme@eayni.local');
    const good = await request(app())
      .post('/api/v1/auth/mfa/verify')
      .set(auth(t))
      .send({ code: currentTotp(secret) });
    expect(good.status).toBe(401);
    expect(good.body.error.code).toBe('mfa_user_locked');
    // After the lock expires the counter starts over.
    await User.updateOne(
      { email: 'lockme@eayni.local' },
      { $set: { mfaLockedUntil: new Date(Date.now() - 1000) } },
    );
    const t2 = await loginPending('lockme@eayni.local');
    expect(
      (
        await request(app())
          .post('/api/v1/auth/mfa/verify')
          .set(auth(t2))
          .send({ code: currentTotp(secret) })
      ).status,
    ).toBe(200);
  });

  it('F2: nobody changes their own roles; granting finance_manager or executive notifies executive management', async () => {
    const root = await makeUser('root8@eayni.local', [{ role: 'system_admin' }]);
    const exec = await makeUser('ceo@eayni.local', [{ role: 'employee' }, { role: 'executive' }]);
    const target = await makeUser('acct@eayni.local', [{ role: 'employee' }]);
    await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
    const admin = await loginAs('root8@eayni.local');
    const self = await request(app())
      .patch(`/api/v1/users/${root._id}`)
      .set(auth(admin))
      .send({ roles: [{ role: 'system_admin' }, { role: 'executive' }] });
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('own_roles');
    // Same roles, different order → no change, allowed.
    expect(
      (
        await request(app())
          .patch(`/api/v1/users/${root._id}`)
          .set(auth(admin))
          .send({ roles: [{ role: 'system_admin' }] })
      ).status,
    ).toBe(200);
    const grant = await request(app())
      .patch(`/api/v1/users/${target._id}`)
      .set(auth(admin))
      .send({ roles: [{ role: 'employee' }, { role: 'finance_manager' }] });
    expect(grant.status).toBe(200);
    expect(
      await AuditLog.countDocuments({
        resource: 'users',
        resourceId: String(target._id),
        'meta.roleChanges.added': 'finance_manager',
      }),
    ).toBe(1);
    expect(
      await Notification.countDocuments({
        userId: exec._id,
        type: 'security.alert',
        'data.roles': 'finance_manager',
      }),
    ).toBe(1);
  });
});
