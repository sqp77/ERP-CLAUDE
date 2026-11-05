import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { activateAccount, auth, loginAs, makeDepartment, makeUser, testApp } from '../../test/helpers';
import { setSetting } from '../settings/service';
import { SYSTEM_ACTOR } from '../http/context';
import { Notification } from '../notifications/model';
import { User } from '../auth/model';
import { Task, TaskEvent } from './model';
import { runUnassignedTaskReminders } from './jobs';

const app = () => testApp();

async function setup() {
  await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
  const ops = await makeDepartment('ops', 'التشغيل');
  const sales = await makeDepartment('sales', 'المبيعات');
  await makeUser('hr@eayni.local', [{ role: 'employee' }, { role: 'hr_officer' }]);
  const hr = await loginAs('hr@eayni.local');
  let n = 0;
  const mk = async (email: string, departmentId: unknown, directManagerId?: string) => {
    const r = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send({
        firstNameAr: 'موظف',
        lastNameAr: `العمري${++n}`,
        gender: 'male',
        nationality: 'سعودي',
        workEmail: email,
        identity: { type: 'national_id', number: `10${String(70000000 + n).padStart(8, '0')}` },
        hireDate: '2024-01-10',
        departmentId: String(departmentId),
        directManagerId,
      });
    expect(r.status).toBe(201);
    return {
      employeeId: r.body._id as string,
      userId: r.body.userId as string,
      token: await activateAccount(email, r.body.temporaryPassword),
    };
  };
  const mgr = await mk('mgr@eayni.local', ops._id);
  await User.updateOne(
    { _id: mgr.userId },
    { $push: { roles: { role: 'department_manager', departmentId: ops._id } } },
  );
  const a = await mk('a@eayni.local', ops._id, mgr.employeeId);
  const lead = await mk('lead@eayni.local', ops._id, mgr.employeeId);
  const b = await mk('b@eayni.local', ops._id, lead.employeeId);
  const sal = await mk('sal@eayni.local', sales._id);
  // re-login the manager so the new role is in the session's user document (roles are read per request anyway)
  const mgrToken = await loginAs('mgr@eayni.local');
  return { ops, sales, hr, mgr: { ...mgr, token: mgrToken }, a, lead, b, sal };
}

const create = (token: string, body: Record<string, unknown>) =>
  request(app())
    .post('/api/v1/tasks')
    .set(auth(token))
    .send({ title: 'مهمة اختبار', ...body });

describe('work distribution [EP §16, EP §10]', () => {
  it('a department manager assigns inside the department only; departmentId comes from the assignee', async () => {
    const { mgr, a, b, sal, ops, sales } = await setup();
    const ok = await create(mgr.token, { assigneeId: a.userId, departmentId: String(sales._id) });
    expect(ok.status).toBe(201);
    expect(ok.body.departmentId).toBe(String(ops._id)); // server-set, client value ignored
    expect((await create(mgr.token, { assigneeId: b.userId })).status).toBe(201); // same department, not a direct report
    const out = await create(mgr.token, { assigneeId: sal.userId });
    expect(out.status).toBe(403);
    expect(out.body.error.code).toBe('assignee_out_of_scope');
    // Reassign obeys the same rule.
    const re = await request(app())
      .post(`/api/v1/tasks/${ok.body._id}/assign`)
      .set(auth(mgr.token))
      .send({ assigneeId: sal.userId, reason: 'نقل' });
    expect(re.status).toBe(403);
    expect(await Notification.countDocuments({ userId: a.userId, type: 'task.assigned' })).toBe(1);
  });

  it('a direct manager without a role sees and assigns to direct reports only (team scope from the org chart)', async () => {
    const { mgr, lead, a, b, sal } = await setup();
    const me = await request(app()).get('/api/v1/auth/me').set(auth(lead.token));
    expect(me.body.user.permissions.find((p: { resource: string }) => p.resource === 'tasks')).toMatchObject({
      scope: 'team',
    });
    expect((await create(lead.token, { assigneeId: b.userId })).status).toBe(201);
    expect((await create(lead.token, { assigneeId: a.userId })).status).toBe(403);
    // Someone with no reports has no create right at all.
    expect((await create(sal.token, { assigneeId: sal.userId })).status).toBe(403);
    // Manager's task for a is invisible to lead; lead's own and b's are visible.
    await create(mgr.token, { assigneeId: a.userId });
    const list = await request(app()).get('/api/v1/tasks').set(auth(lead.token));
    expect(list.body.total).toBe(1);
    const team = await request(app()).get('/api/v1/hr/team').set(auth(lead.token));
    expect(team.body.items.map((i: { userId: string }) => i.userId)).toEqual([b.userId]);
    expect(team.body.items[0]).toMatchObject({ openTasks: 1, lateTasks: 0, directReport: true });
    expect(
      (await request(app()).get(`/api/v1/hr/employees/${b.employeeId}`).set(auth(lead.token))).status,
    ).toBe(200);
    expect(
      (await request(app()).get(`/api/v1/hr/employees/${a.employeeId}`).set(auth(lead.token))).status,
    ).toBe(404);
    // The department manager's team page lists the whole department (a, lead, b).
    const deptTeam = await request(app()).get('/api/v1/hr/team').set(auth(mgr.token));
    expect(deptTeam.body.items.map((i: { userId: string }) => i.userId).sort()).toEqual(
      [a.userId, lead.userId, b.userId].sort(),
    );
    expect((await request(app()).get('/api/v1/hr/team').set(auth(sal.token))).body.items).toEqual([]);
  });

  it('department queue: unassigned tasks wait for the manager and trigger a reminder after one business day', async () => {
    const { mgr, lead, ops } = await setup();
    const q = await create(mgr.token, { title: 'مهمة في قائمة القسم' });
    expect(q.status).toBe(201);
    expect(q.body.assigneeId).toBeUndefined();
    expect(q.body.departmentId).toBe(String(ops._id));
    expect((await create(lead.token, { title: 'بدون مكلّف' })).status).toBe(403);
    expect(await runUnassignedTaskReminders(new Date())).toBe(0);
    const later = new Date(Date.now() + 5 * 86_400_000);
    expect(await runUnassignedTaskReminders(later)).toBe(1);
    expect(await runUnassignedTaskReminders(later)).toBe(0);
    expect(await Notification.countDocuments({ userId: mgr.userId, type: 'task.unassigned_reminder' })).toBe(
      1,
    );
    const unassigned = await request(app()).get('/api/v1/tasks?unassigned=true').set(auth(mgr.token));
    expect(unassigned.body.total).toBe(1);
  });

  it('review step: done → waiting_review → returned with a note → done → approved; every move is logged', async () => {
    const { mgr, a } = await setup();
    const t = await create(mgr.token, { assigneeId: a.userId });
    const id = t.body._id as string;
    const patch = (token: string, body: Record<string, unknown>) =>
      request(app()).patch(`/api/v1/tasks/${id}`).set(auth(token)).send(body);
    expect((await patch(a.token, { status: 'in_progress', progressPercent: 50 })).body.status).toBe(
      'in_progress',
    );
    expect((await patch(a.token, { status: 'done' })).body.status).toBe('waiting_review');
    expect(await Notification.countDocuments({ userId: mgr.userId, type: 'task.review_requested' })).toBe(1);
    const noNote = await request(app())
      .post(`/api/v1/tasks/${id}/review`)
      .set(auth(mgr.token))
      .send({ approve: false });
    expect(noNote.status).toBe(400);
    const back = await request(app())
      .post(`/api/v1/tasks/${id}/review`)
      .set(auth(mgr.token))
      .send({ approve: false, note: 'أكمل الصور' });
    expect(back.body.status).toBe('in_progress');
    expect(back.body.reviewNote).toBe('أكمل الصور');
    expect(await Notification.countDocuments({ userId: a.userId, type: 'task.returned' })).toBe(1);
    // The assignee cannot approve their own work.
    expect(
      (await request(app()).post(`/api/v1/tasks/${id}/review`).set(auth(a.token)).send({ approve: true }))
        .status,
    ).toBe(403);
    await patch(a.token, { status: 'done' });
    const ok = await request(app())
      .post(`/api/v1/tasks/${id}/review`)
      .set(auth(mgr.token))
      .send({ approve: true });
    expect(ok.body.status).toBe('done');
    expect(ok.body.progressPercent).toBe(100);
    expect(await Notification.countDocuments({ userId: a.userId, type: 'task.approved' })).toBe(1);
    const events = await TaskEvent.find({ taskId: id }).sort({ at: 1 }).lean();
    expect(events.map((e) => e.type)).toEqual([
      'created',
      'status_changed',
      'review_requested',
      'returned',
      'review_requested',
      'approved',
    ]);
    const detail = await request(app()).get(`/api/v1/tasks/${id}`).set(auth(a.token));
    expect(detail.body.history).toHaveLength(6);
  });

  it('reassign needs a reason, notifies both employees and is logged; workload counts open and late tasks', async () => {
    const { mgr, a, b } = await setup();
    const t = await create(mgr.token, { assigneeId: a.userId, dueAt: new Date(Date.now() - 86_400_000) });
    const id = t.body._id as string;
    expect(
      (
        await request(app())
          .post(`/api/v1/tasks/${id}/assign`)
          .set(auth(mgr.token))
          .send({ assigneeId: b.userId })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app())
          .post(`/api/v1/tasks/${id}/assign`)
          .set(auth(a.token))
          .send({ assigneeId: b.userId, reason: 'x' })
      ).status,
    ).toBe(403);
    const re = await request(app())
      .post(`/api/v1/tasks/${id}/assign`)
      .set(auth(mgr.token))
      .send({ assigneeId: b.userId, reason: 'توزيع الحمل' });
    expect(re.status).toBe(200);
    expect(re.body.assigneeId).toBe(b.userId);
    expect(await Notification.countDocuments({ userId: a.userId, type: 'task.reassigned' })).toBe(1);
    expect(await Notification.countDocuments({ userId: b.userId, type: 'task.assigned' })).toBe(1);
    expect(await TaskEvent.countDocuments({ taskId: id, type: 'reassigned', note: 'توزيع الحمل' })).toBe(1);
    await create(mgr.token, { assigneeId: b.userId });
    const wl = await request(app()).get('/api/v1/tasks/workload').set(auth(mgr.token));
    expect(wl.body.items).toEqual([{ userId: b.userId, open: 2, late: 1 }]);
    expect(await Task.countDocuments({ assigneeId: a.userId })).toBe(0);
  });
});
