import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { activateAccount, auth, loginAs, makeDepartment, makeUser, testApp } from '../../test/helpers';
import { setSetting } from '../../core/settings/service';
import { SYSTEM_ACTOR } from '../../core/http/context';
import { Notification } from '../../core/notifications/model';
import { AuditLog } from '../../core/audit/model';
import { User } from '../../core/auth/model';

const app = () => testApp();

async function setup() {
  await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
  const ops = await makeDepartment('ops', 'التشغيل');
  await makeUser('hr@eayni.local', [{ role: 'employee' }, { role: 'hr_officer' }]);
  const hr = await loginAs('hr@eayni.local');
  let n = 0;
  const mk = async (email: string, first: string, directManagerId?: string) => {
    const r = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send({
        firstNameAr: first,
        lastNameAr: 'الزهراني',
        gender: 'male',
        nationality: 'سعودي',
        workEmail: email,
        identity: { type: 'national_id', number: `10${String(50000000 + ++n).padStart(8, '0')}` },
        hireDate: '2024-01-10',
        departmentId: String(ops._id),
        directManagerId,
      });
    return {
      employeeId: r.body._id as string,
      userId: r.body.userId as string,
      token: await activateAccount(email, r.body.temporaryPassword),
    };
  };
  const mgr = await mk('mgr@eayni.local', 'سعد');
  const a = await mk('a@eayni.local', 'علي', mgr.employeeId);
  const b = await mk('b@eayni.local', 'بدر', mgr.employeeId);
  const lead = await mk('lead@eayni.local', 'ليث', mgr.employeeId);
  const c = await mk('c@eayni.local', 'سامي', lead.employeeId);
  await User.updateOne(
    { _id: mgr.userId },
    { $push: { roles: { role: 'department_manager', departmentId: ops._id } } },
  );
  return { hr, mgr: { ...mgr, token: await loginAs('mgr@eayni.local') }, a, b, lead, c };
}

const submit = (token: string, body: Record<string, unknown> = {}) =>
  request(app())
    .post('/api/v1/hr/employee-reports')
    .set(auth(token))
    .send({
      type: 'weekly',
      title: 'تقرير الأسبوع 45',
      body: 'أُنجزت 12 زيارة…',
      periodFrom: '2026-11-01',
      periodTo: '2026-11-05',
      ...body,
    });

describe('employee reports to the direct manager [EP §14]', () => {
  it('submits with an automatic number and date, notifies the manager; visibility follows the org chart', async () => {
    const { a, b, mgr, lead, c, hr } = await setup();
    expect((await submit(a.token, { type: 'bogus' })).status).toBe(400);
    expect((await submit(a.token, { periodFrom: '2026-11-05', periodTo: '2026-11-01' })).status).toBe(400);
    const r = await submit(a.token);
    expect(r.status).toBe(201);
    expect(r.body.number).toMatch(/^RPT-\d{4}-00001$/);
    expect(r.body.managerUserId).toBe(mgr.userId);
    expect(r.body.submittedAt).toBeTruthy();
    expect(await Notification.countDocuments({ userId: mgr.userId, titleAr: 'تقرير جديد من موظفك' })).toBe(1);
    expect(
      (await request(app()).get(`/api/v1/hr/employee-reports/${r.body._id}`).set(auth(mgr.token))).status,
    ).toBe(200);
    expect(
      (await request(app()).get(`/api/v1/hr/employee-reports/${r.body._id}`).set(auth(b.token))).status,
    ).toBe(404);
    expect((await request(app()).get(`/api/v1/hr/employee-reports/${r.body._id}`).set(auth(hr))).status).toBe(
      200,
    );
    // A direct manager without a role sees only their reports' reports (team scope).
    const cr = await submit(c.token, { type: 'daily', title: 'تقرير يومي' });
    const leadList = await request(app()).get('/api/v1/hr/employee-reports?view=team').set(auth(lead.token));
    expect(leadList.body.items.map((i: { _id: string }) => i._id)).toEqual([cr.body._id]);
    // The department manager sees both (department scope); search by type / period / employee.
    const all = await request(app()).get('/api/v1/hr/employee-reports?view=team').set(auth(mgr.token));
    expect(all.body.total).toBe(2);
    expect(
      (await request(app()).get('/api/v1/hr/employee-reports?view=team&type=daily').set(auth(mgr.token))).body
        .total,
    ).toBe(1);
    expect(
      (
        await request(app())
          .get(`/api/v1/hr/employee-reports?view=all&employeeId=${a.employeeId}`)
          .set(auth(hr))
      ).body.total,
    ).toBe(1);
    expect(
      (await request(app()).get('/api/v1/hr/employee-reports?view=mine').set(auth(a.token))).body.total,
    ).toBe(1);
  });

  it('manager notes are appended and notify the employee; exports are HTML and Excel and audited', async () => {
    const { a, mgr } = await setup();
    const r = await submit(a.token);
    expect(
      (
        await request(app())
          .post(`/api/v1/hr/employee-reports/${r.body._id}/notes`)
          .set(auth(a.token))
          .send({ note: 'x' })
      ).status,
    ).toBe(403);
    const noted = await request(app())
      .post(`/api/v1/hr/employee-reports/${r.body._id}/notes`)
      .set(auth(mgr.token))
      .send({ note: 'ممتاز، أضف أرقام الأوزان' });
    expect(noted.status).toBe(200);
    expect(noted.body.state).toBe('reviewed');
    expect(noted.body.notes).toHaveLength(1);
    expect(await Notification.countDocuments({ userId: a.userId, titleAr: 'ملاحظة المدير على تقريرك' })).toBe(
      1,
    );
    const html = await request(app())
      .get(`/api/v1/hr/employee-reports/${r.body._id}/export`)
      .set(auth(a.token));
    expect(html.status).toBe(200);
    expect(html.headers['content-type']).toContain('text/html');
    expect(html.text).toContain('تقرير الأسبوع 45');
    expect(html.text).toContain('ممتاز، أضف أرقام الأوزان');
    const xlsx = await request(app())
      .get(`/api/v1/hr/employee-reports/${r.body._id}/export?format=xlsx`)
      .set(auth(mgr.token))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(await AuditLog.countDocuments({ resource: 'hr.reports', action: 'export' })).toBe(2);
  });

  it('a manager requests a report from a team member; the employee sees it and answers it', async () => {
    const { a, b, mgr } = await setup();
    expect(
      (
        await request(app())
          .post('/api/v1/hr/employee-reports/requests')
          .set(auth(a.token))
          .send({ employeeUserId: b.userId, type: 'visit' })
      ).status,
    ).toBe(403);
    const req1 = await request(app())
      .post('/api/v1/hr/employee-reports/requests')
      .set(auth(mgr.token))
      .send({ employeeUserId: a.userId, type: 'visit', dueDate: '2026-11-12', note: 'زيارة مصنع الشرقية' });
    expect(req1.status).toBe(201);
    expect(await Notification.countDocuments({ userId: a.userId, type: 'report.requested' })).toBe(1);
    const pending = await request(app()).get('/api/v1/hr/employee-reports/requests').set(auth(a.token));
    expect(pending.body.items).toHaveLength(1);
    expect(pending.body.items[0].managerName).toBeTruthy();
    const answer = await submit(a.token, {
      type: 'visit',
      title: 'زيارة مصنع الشرقية',
      requestId: req1.body._id,
    });
    expect(answer.status).toBe(201);
    expect(
      (await request(app()).get('/api/v1/hr/employee-reports/requests').set(auth(a.token))).body.items,
    ).toHaveLength(0);
    expect((await submit(a.token, { type: 'visit', requestId: req1.body._id })).status).toBe(400);
  });
});
