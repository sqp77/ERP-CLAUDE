import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { auth, loginAs, makeDepartment, makeUser, testApp } from '../../test/helpers';
import { Role } from './model';
import { CORE_ROLES } from './defaults';
import { clearRoleCache, effectivePermission, ensureCoreRoles, roleCodesOf } from './service';
import { AuditLog } from '../audit/model';
import { setSetting } from '../settings/service';
import { SYSTEM_ACTOR } from '../http/context';

const app = () => testApp();

describe('DECISIONS §20 changes 1–3 — role tuning survives restarts, no self-editing, implied Sales manager', () => {
  it('1: a default grant the admin removed from a system role stays removed; a never-seeded resource is still added', async () => {
    const employee = CORE_ROLES.find((r) => r.code === 'employee')!;
    expect(employee.grants.some((g) => g.resource === 'tasks')).toBe(true);
    await Role.updateOne({ code: 'employee' }, { $pull: { grants: { resource: 'tasks' } } });
    clearRoleCache();
    try {
      await ensureCoreRoles();
      const after = await Role.findOne({ code: 'employee' }).lean();
      expect((after!.grants as { resource: string }[]).some((g) => g.resource === 'tasks')).toBe(false);
      expect(after!.seededResources).toContain('tasks');
      // A resource this role never saw (a new module) is added once, and remembered.
      await ensureCoreRoles([
        {
          ...employee,
          grants: [...employee.grants, { resource: 'zz.new_module', actions: ['view'], scope: 'own' }],
        },
      ]);
      const again = await Role.findOne({ code: 'employee' }).lean();
      expect((again!.grants as { resource: string }[]).some((g) => g.resource === 'zz.new_module')).toBe(
        true,
      );
      expect((again!.grants as { resource: string }[]).some((g) => g.resource === 'tasks')).toBe(false);
    } finally {
      const tasks = employee.grants.find((g) => g.resource === 'tasks')!;
      await Role.updateOne({ code: 'employee' }, { $pull: { grants: { resource: 'zz.new_module' } } });
      await Role.updateOne({ code: 'employee' }, { $addToSet: { grants: tasks } });
      clearRoleCache();
    }
  });

  it('2: nobody edits or deletes a role they hold (403 own_role, audited); other roles stay editable', async () => {
    await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
    await makeUser('adm@eayni.local', [{ role: 'system_admin' }]);
    const t = await loginAs('adm@eayni.local');
    const mine = await Role.findOne({ code: 'system_admin' }).lean();
    const self = await request(app())
      .put('/api/v1/roles/system_admin')
      .set(auth(t))
      .send({ nameAr: 'مدير النظام', departmentScoped: false, grants: mine!.grants, fieldRules: [] });
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('own_role');
    expect(
      await AuditLog.exists({ resource: 'roles', resourceId: 'system_admin', 'meta.refused': 'own_role' }),
    ).toBeTruthy();
    // A custom role the caller does not hold: editable and deletable.
    const created = await request(app())
      .post('/api/v1/roles')
      .set(auth(t))
      .send({
        code: 'tmp_role',
        nameAr: 'مؤقت',
        grants: [{ resource: 'tags', actions: ['view'], scope: 'all' }],
      });
    expect(created.status).toBe(201);
    const other = await request(app())
      .put('/api/v1/roles/tmp_role')
      .set(auth(t))
      .send({ nameAr: 'مؤقت ٢', departmentScoped: false, grants: [], fieldRules: [] });
    expect(other.status).toBe(200);
    // Holding the custom role blocks deleting it too.
    await makeUser('adm2@eayni.local', [{ role: 'system_admin' }, { role: 'tmp_role' }]);
    const t2 = await loginAs('adm2@eayni.local');
    expect((await request(app()).delete('/api/v1/roles/tmp_role').set(auth(t2))).status).toBe(403);
    expect((await request(app()).delete('/api/v1/roles/tmp_role').set(auth(t))).status).toBe(204);
  });

  it('3: the department manager of Sales has sales_manager rights implicitly; the HR department manager does not', async () => {
    const sales = await makeDepartment('sales', 'المبيعات');
    const hr = await makeDepartment('hr', 'الموارد البشرية');
    const salesMgr = [{ role: 'employee' }, { role: 'department_manager', departmentId: String(sales._id) }];
    const hrMgr = [{ role: 'employee' }, { role: 'department_manager', departmentId: String(hr._id) }];
    const eff = await effectivePermission(salesMgr, String(sales._id), 'crm.customers', 'view');
    expect(eff?.scope).toBe('department');
    expect(eff?.departmentIds).toContain(String(sales._id));
    expect(await roleCodesOf(salesMgr, String(sales._id))).toContain('sales_manager');
    expect(await effectivePermission(hrMgr, String(hr._id), 'crm.customers', 'view')).toBeNull();
    expect(await roleCodesOf(hrMgr, String(hr._id))).not.toContain('sales_manager');
    // Shown to the UI as an implied role; permissions include the Sales resources.
    await makeUser('sm@eayni.local', salesMgr, { departmentId: sales._id });
    const t = await loginAs('sm@eayni.local');
    const me = await request(app()).get('/api/v1/auth/me').set(auth(t));
    expect(me.body.user.roles).toContainEqual({
      role: 'sales_manager',
      departmentId: String(sales._id),
      implied: true,
    });
    expect(
      me.body.user.permissions.some((p: { resource: string }) => p.resource === 'sales.opportunities'),
    ).toBe(true);
    // The implied role is never persisted on the user.
    const { User } = await import('../auth/model');
    const stored = await User.findOne({ email: 'sm@eayni.local' }).lean();
    expect(stored!.roles.map((r) => r.role)).toEqual(['employee', 'department_manager']);
  });
});
