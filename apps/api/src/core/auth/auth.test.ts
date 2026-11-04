import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { auth, loginAs, makeUser, PASSWORD, testApp } from '../../test/helpers';
import { LoginLog, Session, User } from './model';
import { debugCurrentTotp } from './service';
import { currentTotp } from './totp';
import { setSetting } from '../settings/service';
import { SYSTEM_ACTOR } from '../http/context';

const app = () => testApp();

describe('auth [EP §3, DECISIONS §2]', () => {
  it('logs in with work email + password and sets a session cookie', async () => {
    await makeUser('a@eayni.local');
    const res = await request(app())
      .post('/api/v1/auth/login')
      .send({ email: 'A@eayni.local', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.mfa).toBe('none');
    expect(res.headers['set-cookie']?.[0]).toMatch(/eayni_sid=/);
    expect(await LoginLog.countDocuments({ event: 'login_success' })).toBe(1);
  });

  it('rejects wrong credentials with a clear message and logs the attempt', async () => {
    await makeUser('b@eayni.local');
    const res = await request(app())
      .post('/api/v1/auth/login')
      .send({ email: 'b@eayni.local', password: 'wrong-pass-1' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
    expect(await LoginLog.countDocuments({ event: 'login_failed' })).toBe(1);
  });

  it('locks the account temporarily after repeated failures', async () => {
    await setSetting('auth.maxFailedLogins', 3, SYSTEM_ACTOR);
    await makeUser('c@eayni.local');
    for (let i = 0; i < 3; i++)
      await request(app())
        .post('/api/v1/auth/login')
        .send({ email: 'c@eayni.local', password: 'nope-nope-1' });
    const res = await request(app())
      .post('/api/v1/auth/login')
      .send({ email: 'c@eayni.local', password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('account_locked');
  });

  it('refuses disabled accounts', async () => {
    await makeUser('d@eayni.local', [{ role: 'employee' }], { status: 'disabled' });
    const res = await request(app())
      .post('/api/v1/auth/login')
      .send({ email: 'd@eayni.local', password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('account_disabled');
  });

  it('expires idle sessions and revokes on logout', async () => {
    await makeUser('e@eayni.local');
    const token = await loginAs('e@eayni.local');
    expect((await request(app()).get('/api/v1/auth/me').set(auth(token))).status).toBe(200);
    await Session.updateMany({}, { $set: { lastSeenAt: new Date(Date.now() - 31 * 60_000) } });
    const idle = await request(app()).get('/api/v1/auth/me').set(auth(token));
    expect(idle.status).toBe(401);
    expect(idle.body.error.code).toBe('session_idle');

    const token2 = await loginAs('e@eayni.local');
    expect((await request(app()).post('/api/v1/auth/logout').set(auth(token2))).status).toBe(204);
    const after = await request(app()).get('/api/v1/auth/me').set(auth(token2));
    expect(after.body.error.code).toBe('session_revoked');
  });

  it('lists active sessions and lets the user revoke one', async () => {
    await makeUser('f@eayni.local');
    const t1 = await loginAs('f@eayni.local');
    const t2 = await loginAs('f@eayni.local');
    const list = await request(app()).get('/api/v1/auth/sessions').set(auth(t1));
    expect(list.body.items).toHaveLength(2);
    const other = list.body.items.find((s: { current: boolean }) => !s.current);
    expect((await request(app()).delete(`/api/v1/auth/sessions/${other._id}`).set(auth(t1))).status).toBe(
      204,
    );
    expect((await request(app()).get('/api/v1/auth/me').set(auth(t2))).status).toBe(401);
  });

  it('changes the password (policy enforced) and revokes other sessions', async () => {
    await makeUser('g@eayni.local');
    const t1 = await loginAs('g@eayni.local');
    const t2 = await loginAs('g@eayni.local');
    const weak = await request(app())
      .post('/api/v1/auth/password/change')
      .set(auth(t1))
      .send({ currentPassword: PASSWORD, newPassword: 'short1' });
    expect(weak.status).toBe(400);
    const ok = await request(app())
      .post('/api/v1/auth/password/change')
      .set(auth(t1))
      .send({ currentPassword: PASSWORD, newPassword: 'NewPassw0rd!' });
    expect(ok.status).toBe(200);
    expect((await request(app()).get('/api/v1/auth/me').set(auth(t2))).status).toBe(401);
    expect(await loginAs('g@eayni.local', 'NewPassw0rd!')).toBeTruthy();
  });

  it('resets a forgotten password through a one-time token', async () => {
    await makeUser('h@eayni.local');
    const forgot = await request(app()).post('/api/v1/auth/password/forgot').send({ email: 'h@eayni.local' });
    expect(forgot.status).toBe(200);
    expect(forgot.body.debugToken).toBeTruthy();
    const reset = await request(app())
      .post('/api/v1/auth/password/reset')
      .send({ token: forgot.body.debugToken, newPassword: 'Reset0k!2026' });
    expect(reset.status).toBe(200);
    const again = await request(app())
      .post('/api/v1/auth/password/reset')
      .send({ token: forgot.body.debugToken, newPassword: 'Reset0k!2027' });
    expect(again.status).toBe(400);
    expect(await loginAs('h@eayni.local', 'Reset0k!2026')).toBeTruthy();
  });

  it('forces TOTP enrollment for mandatory roles, then requires the code on every login', async () => {
    await makeUser('admin@eayni.local', [{ role: 'system_admin' }]);
    const login = await request(app())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@eayni.local', password: PASSWORD });
    expect(login.body.mfa).toBe('enroll_required');
    const token = login.body.token as string;
    // Protected routes are blocked until enrolled.
    const blocked = await request(app()).get('/api/v1/users').set(auth(token));
    expect(blocked.body.error.code).toBe('mfa_enrollment_required');

    const start = await request(app()).post('/api/v1/auth/mfa/enroll/start').set(auth(token));
    expect(start.body.manualKey).toBeTruthy();
    const bad = await request(app())
      .post('/api/v1/auth/mfa/enroll/confirm')
      .set(auth(token))
      .send({ code: '000000' });
    expect(bad.status).toBe(401);
    const good = await request(app())
      .post('/api/v1/auth/mfa/enroll/confirm')
      .set(auth(token))
      .send({ code: currentTotp(start.body.manualKey) });
    expect(good.status).toBe(200);
    expect((await request(app()).get('/api/v1/users').set(auth(token))).status).toBe(200);

    // Next login: password ok, but MFA required before anything else.
    const login2 = await request(app())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@eayni.local', password: PASSWORD });
    expect(login2.body.mfa).toBe('required');
    const t2 = login2.body.token as string;
    expect((await request(app()).get('/api/v1/users').set(auth(t2))).body.error.code).toBe('mfa_required');
    const user = await User.findOne({ email: 'admin@eayni.local' });
    const verify = await request(app())
      .post('/api/v1/auth/mfa/verify')
      .set(auth(t2))
      .send({ code: debugCurrentTotp(user!) });
    expect(verify.status).toBe(200);
    expect((await request(app()).get('/api/v1/users').set(auth(t2))).status).toBe(200);
    // Mandatory roles cannot disable it.
    const disable = await request(app())
      .post('/api/v1/auth/mfa/disable')
      .set(auth(t2))
      .send({ code: debugCurrentTotp(user!) });
    expect(disable.status).toBe(403);
  });
});
