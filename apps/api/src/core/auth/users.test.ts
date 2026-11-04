import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { auth, loginAs, makeUser, testApp } from '../../test/helpers';
import { AuditLog } from '../audit/model';

const app = () => testApp();

describe('users admin [HR §6, EP §3.10]', () => {
  it('HR officer creates a user with a temporary password; plain employees cannot', async () => {
    await makeUser('hr@eayni.local', [{ role: 'hr_officer' }], { totpEnabled: false });
    // hr_officer requires MFA; use a non-mandatory admin-like role for the HTTP test by relaxing the setting.
    const { setSetting } = await import('../settings/service');
    const { SYSTEM_ACTOR } = await import('../http/context');
    await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
    const hr = await loginAs('hr@eayni.local');
    const created = await request(app())
      .post('/api/v1/users')
      .set(auth(hr))
      .send({ email: 'new@eayni.local', displayNameAr: 'موظف جديد', roles: [{ role: 'employee' }] });
    expect(created.status).toBe(201);
    expect(created.body.temporaryPassword).toBeTruthy();
    expect(created.body.mustChangePassword).toBe(true);
    expect(await AuditLog.countDocuments({ resource: 'users', action: 'create' })).toBe(1);

    await makeUser('emp@eayni.local');
    const emp = await loginAs('emp@eayni.local');
    const denied = await request(app())
      .post('/api/v1/users')
      .set(auth(emp))
      .send({ email: 'x@eayni.local', displayNameAr: 'س' });
    expect(denied.status).toBe(403);
    expect((await request(app()).get('/api/v1/users').set(auth(emp))).status).toBe(403);
  });

  it('disabling an account ends its sessions immediately [EP §3.10]', async () => {
    const { setSetting } = await import('../settings/service');
    const { SYSTEM_ACTOR } = await import('../http/context');
    await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
    await makeUser('admin2@eayni.local', [{ role: 'system_admin' }]);
    const victim = await makeUser('victim@eayni.local');
    const admin = await loginAs('admin2@eayni.local');
    const vt = await loginAs('victim@eayni.local');
    const r = await request(app())
      .patch(`/api/v1/users/${victim._id}`)
      .set(auth(admin))
      .send({ status: 'disabled' });
    expect(r.status).toBe(200);
    expect((await request(app()).get('/api/v1/auth/me').set(auth(vt))).status).toBe(401);
    const self = await request(app())
      .patch(
        `/api/v1/users/${(await import('./model')).User.findOne({ email: 'admin2@eayni.local' }).then((u) => u!._id)}`,
      )
      .set(auth(admin))
      .send({ status: 'disabled' });
    expect(self.status).toBe(400);
  });
});
