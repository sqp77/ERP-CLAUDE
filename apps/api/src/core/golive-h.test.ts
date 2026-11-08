import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { activateAccount, auth, loginAs, makeDepartment, makeUser, testApp } from '../test/helpers';
import { setSetting } from './settings/service';
import { SYSTEM_ACTOR } from './http/context';
import { User } from './auth/model';
import { Task } from './tasks/model';

const app = () => testApp();
const DAY = 86_400_000;

async function setup() {
  await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
  const ops = await makeDepartment('ops', 'التشغيل');
  const it = await makeDepartment('it', 'التقنية');
  await makeUser('hr@eayni.local', [{ role: 'employee' }, { role: 'hr_manager' }]);
  const hr = await loginAs('hr@eayni.local');
  let n = 0;
  const mk = async (email: string, first: string, directManagerId?: string, dept: unknown = ops._id) => {
    const r = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send({
        firstNameAr: first,
        lastNameAr: 'العمري',
        gender: 'male',
        nationality: 'سعودي',
        workEmail: email,
        identity: {
          type: 'national_id',
          number: `10${String(80000000 + ++n).padStart(8, '0')}`,
          expiryDate: new Date(Date.now() + 20 * DAY),
        },
        hireDate: '2024-01-10',
        departmentId: String(dept),
        directManagerId,
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
  const a = await mk('a@eayni.local', 'أحمد', mgr.employeeId);
  const itStaff = await mk('it1@eayni.local', 'محمد', undefined, it._id);
  return { ops, it, hr, mgr: { ...mgr, token: await loginAs('mgr@eayni.local') }, a, itStaff };
}

describe('go-live review H — API support for the frontend fixes', () => {
  it('H4: one calendar event by id for people who may see it; 404 for others', async () => {
    const { mgr, a, itStaff } = await setup();
    const ev = await request(app())
      .post('/api/v1/calendar/events')
      .set(auth(mgr.token))
      .send({
        title: 'اجتماع',
        startAt: new Date(Date.now() + 40 * DAY),
        endAt: new Date(Date.now() + 40 * DAY + 3_600_000),
        participantIds: [a.userId],
      });
    expect(ev.status).toBe(201);
    const own = await request(app()).get(`/api/v1/calendar/events/${ev.body._id}`).set(auth(a.token));
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ _id: ev.body._id, source: 'event' });
    expect(own.body.startHijri).toBeTruthy();
    expect(
      (await request(app()).get(`/api/v1/calendar/events/${ev.body._id}`).set(auth(itStaff.token))).status,
    ).toBe(404);
  });

  it('H5: tasks?overdue=true returns open tasks past due only; the home tile counts open tasks only', async () => {
    const { mgr, a } = await setup();
    const mkTask = async (title: string, dueAt: Date) =>
      (
        await request(app())
          .post('/api/v1/tasks')
          .set(auth(mgr.token))
          .send({ title, assigneeId: a.userId, dueAt })
      ).body._id as string;
    const late = await mkTask('متأخرة', new Date(Date.now() + DAY));
    const future = await mkTask('قادمة', new Date(Date.now() + 5 * DAY));
    const done = await mkTask('منجزة', new Date(Date.now() + DAY));
    await Task.updateOne({ _id: late }, { $set: { dueAt: new Date(Date.now() - DAY) } });
    await Task.updateOne({ _id: done }, { $set: { dueAt: new Date(Date.now() - DAY), status: 'done' } });
    const r = await request(app()).get('/api/v1/tasks?overdue=true&limit=50').set(auth(mgr.token));
    expect(r.status).toBe(200);
    expect(r.body.items.map((x: { _id: string }) => x._id)).toEqual([late]);
    const mine = await request(app()).get('/api/v1/tasks?mine=true&open=true&limit=1').set(auth(a.token));
    expect(mine.body.total).toBe(2);
    expect(future).toBeTruthy();
  });

  it('H5: employees?probationWithinDays filters by the active contract; the HR expiring list serves each kind and is HR-only', async () => {
    const { hr, mgr, a, itStaff } = await setup();
    const contract = async (employeeId: string, probationEndDate: Date, endDate?: Date) =>
      request(app())
        .post(`/api/v1/hr/employees/${employeeId}/contracts`)
        .set(auth(hr))
        .send({
          type: endDate ? 'fixed_term' : 'open_ended',
          startDate: '2026-01-01',
          probationEndDate,
          endDate,
        });
    expect(
      (await contract(a.employeeId, new Date(Date.now() + 10 * DAY), new Date(Date.now() + 45 * DAY))).status,
    ).toBe(201);
    expect((await contract(itStaff.employeeId, new Date(Date.now() + 200 * DAY))).status).toBe(201);
    const list = await request(app()).get('/api/v1/hr/employees?probationWithinDays=30').set(auth(hr));
    expect(list.body.items.map((e: { _id: string }) => e._id)).toEqual([a.employeeId]);

    const contracts = await request(app())
      .get('/api/v1/hr/dashboard/expiring?kind=contracts&within=60')
      .set(auth(hr));
    expect(contracts.status).toBe(200);
    expect(contracts.body.items).toHaveLength(1);
    expect(contracts.body.items[0]).toMatchObject({ employeeId: a.employeeId, fullNameAr: 'أحمد العمري' });
    const identities = await request(app())
      .get('/api/v1/hr/dashboard/expiring?kind=identities&within=30')
      .set(auth(hr));
    expect(identities.body.items).toHaveLength(3); // every identity in setup expires in 20 days
    expect(
      (await request(app()).get('/api/v1/hr/dashboard/expiring?kind=documents').set(auth(hr))).body.items,
    ).toEqual([]);
    expect((await request(app()).get('/api/v1/hr/dashboard/expiring?kind=nope').set(auth(hr))).status).toBe(
      400,
    );
    // A department manager sees only a department: no HR drill-down.
    expect(
      (await request(app()).get('/api/v1/hr/dashboard/expiring?kind=contracts').set(auth(mgr.token))).status,
    ).toBe(403);
  });

  it("H5/H11: tickets?view=team lists the direct reports' assigned tickets; comments carry their author", async () => {
    const { hr, mgr, a, itStaff } = await setup();
    await setSetting('tickets.hiddenTargets', [], SYSTEM_ACTOR);
    const created = await request(app())
      .post('/api/v1/tickets')
      .set(auth(itStaff.token))
      .send({
        departmentCode: 'ops',
        type: 'request',
        subject: 'طلب حاوية',
        body: 'نحتاج حاوية إضافية',
        priority: 'medium',
      });
    expect(created.status).toBe(201);
    const assigned = await request(app())
      .post(`/api/v1/tickets/${created.body._id}/transition`)
      .set(auth(mgr.token))
      .send({ transition: 'assign', assigneeId: a.userId });
    expect(assigned.status).toBe(200);
    const team = await request(app()).get('/api/v1/tickets?view=team&open=true').set(auth(mgr.token));
    expect(team.status).toBe(200);
    expect(team.body.items.map((x: { _id: string }) => x._id)).toEqual([created.body._id]);
    expect((await request(app()).get('/api/v1/tickets?view=team').set(auth(hr))).body.items).toEqual([]);

    const c = await request(app())
      .post('/api/v1/comments')
      .set(auth(a.token))
      .send({ recordType: 'ticket', recordId: created.body._id, body: 'جارٍ العمل عليها' });
    expect(c.status).toBe(201);
    const list = await request(app())
      .get(`/api/v1/comments?recordType=ticket&recordId=${created.body._id}`)
      .set(auth(mgr.token));
    expect(list.body.items[0]).toMatchObject({
      authorEmail: 'a@eayni.local',
      authorName: expect.any(String),
    });
  });

  it('H7: the export preview names the kind of each column so dates and money render like the Excel file', async () => {
    const { hr } = await setup();
    const r = await request(app())
      .post('/api/v1/export')
      .set(auth(hr))
      .send({
        resource: 'employees',
        fields: ['fullNameAr', 'hireDate', 'basicSalaryHalalas'],
        filters: {},
        format: 'preview',
      });
    expect(r.status).toBe(200);
    expect(r.body.columns).toEqual([
      { key: 'fullNameAr', labelAr: 'الاسم' },
      { key: 'hireDate', labelAr: 'تاريخ المباشرة', kind: 'date' },
      { key: 'basicSalaryHalalas', labelAr: 'الراتب الأساسي (ر.س)', kind: 'money' },
    ]);
  });
});
