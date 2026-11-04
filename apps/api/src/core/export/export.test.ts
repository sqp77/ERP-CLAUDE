import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { auth, loginAs, makeUser, testApp } from '../../test/helpers';
import { setSetting } from '../settings/service';
import { SYSTEM_ACTOR } from '../http/context';
import { AuditLog } from '../audit/model';

describe('export builder [HR §4]', () => {
  it('previews chosen fields only, produces xlsx, refuses unknown fields and audits', async () => {
    await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
    await makeUser('adm@eayni.local', [{ role: 'system_admin' }]);
    const t = await loginAs('adm@eayni.local');
    const res = await request(testApp()).get('/api/v1/export/resources').set(auth(t));
    expect(res.body.items.map((r: { resource: string }) => r.resource)).toEqual(
      expect.arrayContaining(['users', 'employees']),
    );
    const preview = await request(testApp())
      .post('/api/v1/export')
      .set(auth(t))
      .send({ resource: 'users', fields: ['displayNameAr', 'roles'], format: 'preview' });
    expect(preview.status).toBe(200);
    expect(preview.body.header).toEqual(['الاسم', 'الأدوار']);
    expect(preview.body.rows[0][1]).toBe('system_admin');
    const bad = await request(testApp())
      .post('/api/v1/export')
      .set(auth(t))
      .send({ resource: 'users', fields: ['passwordHash'], format: 'preview' });
    expect(bad.status).toBe(400);
    const xlsx = await request(testApp())
      .post('/api/v1/export')
      .set(auth(t))
      .send({ resource: 'users', fields: ['email'], format: 'xlsx' })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(xlsx.status).toBe(200);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    expect(await AuditLog.countDocuments({ action: 'export' })).toBe(2);
  });
});
