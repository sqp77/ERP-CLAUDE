import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { auth, loginAs, makeDepartment, makeUser, testApp } from '../../test/helpers';
import { effectivePermission, fieldRestrictions, redact } from './service';
import { Role } from './model';
import { scopeFilter } from './scope';
import { setSetting } from '../settings/service';
import { SYSTEM_ACTOR } from '../http/context';

const app = () => testApp();

describe('rbac [HR §6, EP §16, DECISIONS §4]', () => {
  it('computes the widest scope across roles and collects department ids for department-scoped roles', async () => {
    const d1 = await makeDepartment('d1');
    const d2 = await makeDepartment('d2');
    const eff = await effectivePermission(
      [{ role: 'employee' }, { role: 'department_manager', departmentId: String(d1._id) }],
      String(d2._id),
      'tasks',
      'view',
    );
    expect(eff?.scope).toBe('department');
    expect(eff?.departmentIds.sort()).toEqual([String(d1._id), String(d2._id)].sort());
    expect(await effectivePermission([{ role: 'employee' }], undefined, 'users', 'create')).toBeNull();
    expect((await effectivePermission([{ role: 'system_admin' }], undefined, 'users', 'delete'))?.scope).toBe('all');
  });

  it('the system admin has no financial approval right [FIN §12]', async () => {
    expect(await effectivePermission([{ role: 'system_admin' }], undefined, 'finance.requests', 'approve')).toBeNull();
  });

  it('applies field-level rules: hidden fields are redacted', async () => {
    await Role.create({
      code: 'salary_viewer',
      nameAr: 'مطلع على الرواتب',
      grants: [{ resource: 'employees', actions: ['view'], scope: 'all' }],
      fieldRules: [{ resource: 'employees', fields: ['basicSalary', 'iban'], view: true, edit: false }],
    });
    await Role.create({ code: 'plain', nameAr: 'عادي', grants: [{ resource: 'employees', actions: ['view'], scope: 'all' }], fieldRules: [{ resource: 'employees', fields: ['basicSalary', 'iban'], view: false, edit: false }] });
    const { clearRoleCache } = await import('./service');
    clearRoleCache();
    const r1 = await fieldRestrictions([{ role: 'plain' }], 'employees');
    expect([...r1.hidden].sort()).toEqual(['basicSalary', 'iban']);
    expect(redact({ name: 'x', basicSalary: 1, iban: 'SA' }, r1.hidden)).toEqual({ name: 'x' });
    const r2 = await fieldRestrictions([{ role: 'plain' }, { role: 'salary_viewer' }], 'employees');
    expect(r2.hidden.size).toBe(0);
    expect(r2.readOnly.size).toBe(2);
  });

  it('turns scope into a query filter (own / department / all)', async () => {
    const own = await scopeFilter({ resource: 'tasks', action: 'view', scope: 'own', departmentIds: [] }, 'u1', { ownerFields: ['assigneeId'] });
    expect(own).toEqual({ $or: [{ assigneeId: 'u1' }] });
    const dept = await scopeFilter({ resource: 'tasks', action: 'view', scope: 'department', departmentIds: ['d1'] }, 'u1', { ownerFields: ['assigneeId'], departmentField: 'departmentId' });
    expect(dept).toEqual({ $or: [{ departmentId: { $in: ['d1'] } }, { assigneeId: 'u1' }] });
    expect(await scopeFilter({ resource: 'tasks', action: 'view', scope: 'all', departmentIds: [] }, 'u1', { ownerFields: ['assigneeId'] })).toEqual({});
  });

  it('enforces on the server: forbidden action returns 403, allowed returns data', async () => {
    await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
    await makeUser('emp@eayni.local');
    await makeUser('adm@eayni.local', [{ role: 'system_admin' }]);
    const emp = await loginAs('emp@eayni.local');
    const adm = await loginAs('adm@eayni.local');
    expect((await request(app()).get('/api/v1/settings').set(auth(emp))).status).toBe(403);
    expect((await request(app()).get('/api/v1/settings').set(auth(adm))).status).toBe(200);
    expect((await request(app()).get('/api/v1/org/departments').set(auth(emp))).status).toBe(200);
  });
});
