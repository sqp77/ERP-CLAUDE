import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { auth, loginAs, makeUser, testApp } from '../../test/helpers';
import { AuditLog } from '../audit/model';
import { setSetting } from '../settings/service';
import { SYSTEM_ACTOR } from '../http/context';

const app = () => testApp();

describe('org structure [HR §3.1] + audit [golden rule 4]', () => {
  it('creates, updates and soft-deletes a department, auditing before/after', async () => {
    await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
    await makeUser('hrm@eayni.local', [{ role: 'hr_manager' }]);
    const t = await loginAs('hrm@eayni.local');
    const created = await request(app()).post('/api/v1/org/departments').set(auth(t)).send({ code: 'sales', nameAr: 'المبيعات' });
    expect(created.status).toBe(201);
    const dup = await request(app()).post('/api/v1/org/departments').set(auth(t)).send({ code: 'sales', nameAr: 'x' });
    expect(dup.status).toBe(409);
    const upd = await request(app()).patch(`/api/v1/org/departments/${created.body._id}`).set(auth(t)).send({ nameAr: 'إدارة المبيعات' });
    expect(upd.body.nameAr).toBe('إدارة المبيعات');
    const del = await request(app()).delete(`/api/v1/org/departments/${created.body._id}`).set(auth(t));
    expect(del.status).toBe(204);
    expect((await request(app()).get('/api/v1/org/departments').set(auth(t))).body.items).toHaveLength(0);
    const logs = await AuditLog.find({ resource: 'org.departments' }).sort({ at: 1 }).lean();
    expect(logs.map((l) => l.action)).toEqual(['create', 'update', 'delete']);
    expect(logs[1].changedFields).toEqual(['nameAr']);
  });

  it('stores sites as GeoJSON points with a geofence radius', async () => {
    await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
    await makeUser('hro@eayni.local', [{ role: 'hr_officer' }]);
    const t = await loginAs('hro@eayni.local');
    const b = await request(app()).post('/api/v1/org/branches').set(auth(t)).send({ code: 'dmm', nameAr: 'الدمام' });
    const s = await request(app()).post('/api/v1/org/sites').set(auth(t)).send({ branchId: b.body._id, nameAr: 'المستودع', location: { lat: 26.43, lng: 50.1 }, geofenceRadiusM: 150 });
    expect(s.status).toBe(201);
    expect(s.body.location).toEqual({ type: 'Point', coordinates: [50.1, 26.43] });
  });
});
