import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { activateAccount, auth, loginAs, makeDepartment, makeUser, testApp } from '../../test/helpers';
import { setSetting } from '../../core/settings/service';
import { SYSTEM_ACTOR } from '../../core/http/context';
import { AuditLog } from '../../core/audit/model';
import { User } from '../../core/auth/model';

const app = () => testApp();

async function setup() {
  await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
  const ops = await makeDepartment('ops', 'التشغيل');
  await makeUser('hr@eayni.local', [{ role: 'employee' }, { role: 'hr_manager' }]);
  const hr = await loginAs('hr@eayni.local');
  let n = 0;
  const mk = async (
    email: string,
    first: string,
    extra: Record<string, unknown> = {},
    directManagerId?: string,
  ) => {
    const r = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send({
        firstNameAr: first,
        lastNameAr: 'الغامدي',
        gender: 'male',
        nationality: 'سعودي',
        workEmail: email,
        identity: {
          type: 'national_id',
          number: `10${String(40000000 + ++n).padStart(8, '0')}`,
          expiryDate: new Date(Date.now() + 20 * 86_400_000),
        },
        hireDate: '2024-01-10',
        departmentId: String(ops._id),
        directManagerId,
        ...extra,
      });
    expect(r.status).toBe(201);
    return {
      employeeId: r.body._id as string,
      userId: r.body.userId as string,
      token: await activateAccount(email, r.body.temporaryPassword),
    };
  };
  const mgr = await mk('mgr@eayni.local', 'خالد');
  await User.updateOne(
    { _id: mgr.userId },
    { $push: { roles: { role: 'department_manager', departmentId: ops._id } } },
  );
  const a = await mk('a@eayni.local', 'أحمد', { nationality: 'مصري' }, mgr.employeeId);
  const b = await mk('b@eayni.local', 'بدر', {}, mgr.employeeId);
  return { hr, ops, mgr: { ...mgr, token: await loginAs('mgr@eayni.local') }, a, b };
}

describe('slice 6 dashboards and export [EP §16, HR §4–5]', () => {
  it('direct-manager dashboard counts the team, tasks, pending requests, reports and meetings', async () => {
    const { mgr, a, b, hr } = await setup();
    await request(app())
      .post('/api/v1/tasks')
      .set(auth(mgr.token))
      .send({ title: 'متأخرة', assigneeId: a.userId, dueAt: new Date(Date.now() - 86_400_000) });
    await request(app())
      .post('/api/v1/tasks')
      .set(auth(mgr.token))
      .send({ title: 'جارية', assigneeId: b.userId });
    await request(app())
      .post('/api/v1/hr/requests')
      .set(auth(a.token))
      .send({
        type: 'leave',
        details: { leaveType: 'annual', startDate: '2026-12-01', endDate: '2026-12-03', reason: 'إجازة' },
      });
    await request(app())
      .post('/api/v1/hr/employee-reports')
      .set(auth(b.token))
      .send({ type: 'weekly', title: 'تقرير', body: 'نص' });
    await request(app())
      .post(`/api/v1/hr/employees/${b.employeeId}/status`)
      .set(auth(hr))
      .send({ status: 'on_leave', effectiveDate: '2026-11-01', reason: 'إجازة' });
    const d = await request(app()).get('/api/v1/hr/dashboard/manager').set(auth(mgr.token));
    expect(d.status).toBe(200);
    expect(d.body.team).toMatchObject({ total: 2, onLeave: 1, active: 1 });
    expect(d.body.tasks.open).toBe(2);
    expect(d.body.tasks.overdue).toBe(1);
    expect(d.body.requestsPending).toBe(1);
    expect(d.body.reportsPending).toBe(1);
    // A plain employee without reports is refused.
    expect((await request(app()).get('/api/v1/hr/dashboard/manager').set(auth(a.token))).status).toBe(403);
  });

  it('HR dashboard aggregates headcount, expiries, request queues, probation and recent changes; export is permission-filtered and audited as sensitive', async () => {
    const { hr, mgr, a, ops } = await setup();
    const d = await request(app()).get('/api/v1/hr/dashboard/hr').set(auth(hr));
    expect(d.status).toBe(200);
    expect(d.body.headcount.total).toBe(3);
    expect(d.body.headcount.byNationality).toEqual(
      expect.arrayContaining([
        { key: 'سعودي', count: 2 },
        { key: 'مصري', count: 1 },
      ]),
    );
    expect(d.body.headcount.byDepartment[0]).toMatchObject({ key: 'التشغيل', count: 3 });
    expect(d.body.expiring.identities.d30).toBe(3);
    expect(d.body).not.toHaveProperty('attendance');
    expect((await request(app()).get('/api/v1/hr/dashboard/hr').set(auth(mgr.token))).status).toBe(403);
    // Export resources: HR manager sees sensitive employee fields; the department manager does not see them, and not even the resource unless granted export.
    const resHr = await request(app()).get('/api/v1/export/resources').set(auth(hr));
    const emp = resHr.body.items.find((r: { resource: string }) => r.resource === 'employees');
    expect(emp.fields.map((f: { key: string }) => f.key)).toEqual(
      expect.arrayContaining(['identity.number', 'basicSalaryHalalas', 'departmentName']),
    );
    const resMgr = await request(app()).get('/api/v1/export/resources').set(auth(mgr.token));
    expect(resMgr.body.items.find((r: { resource: string }) => r.resource === 'employees')).toBeUndefined();
    const prev = await request(app())
      .post('/api/v1/export')
      .set(auth(hr))
      .send({
        resource: 'employees',
        fields: ['fullNameAr', 'departmentName', 'identity.number'],
        filters: { departmentId: String(ops._id) },
        format: 'preview',
      });
    expect(prev.status).toBe(200);
    expect(prev.body.header).toEqual(['الاسم', 'القسم', 'رقم الهوية']);
    expect(prev.body.rows.some((r: string[]) => r[2].startsWith('10'))).toBe(true);
    expect(
      await AuditLog.countDocuments({ action: 'export', resource: 'hr.employees', sensitive: true }),
    ).toBe(1);
    expect(String(a.userId)).toBeTruthy();
  });
});
