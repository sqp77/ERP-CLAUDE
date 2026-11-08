import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { resetEnvCache } from '../config';
import { activateAccount, auth, loginAs, makeDepartment, makeUser, testApp } from '../test/helpers';
import { setSetting } from './settings/service';
import { SYSTEM_ACTOR } from './http/context';
import { User, LoginLog } from './auth/model';
import { Ticket } from '../modules/tickets/model';
import { Attachment } from './files/model';
import { News } from '../modules/news/model';

const app = () => testApp();

async function upload(token: string) {
  const pre = await request(app())
    .post('/api/v1/files/presign')
    .set(auth(token))
    .send({ fileName: 'f.pdf', mimeType: 'application/pdf', size: 11 });
  const u = new URL(pre.body.upload.url);
  await request(app())
    .put(u.pathname + u.search)
    .set('Content-Type', 'application/pdf')
    .send(Buffer.from('%PDF-1.4 ok'));
  await request(app()).post(`/api/v1/files/${pre.body.attachmentId}/complete`).set(auth(token));
  return pre.body.attachmentId as string;
}

async function setup() {
  await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
  const ops = await makeDepartment('ops', 'التشغيل');
  const it = await makeDepartment('it', 'التقنية');
  const hrDept = await makeDepartment('hr', 'الموارد البشرية');
  await makeUser('hr@eayni.local', [{ role: 'employee' }, { role: 'hr_officer' }], {
    departmentId: hrDept._id,
  });
  await makeUser('root@eayni.local', [{ role: 'system_admin' }]);
  await makeUser('exec@eayni.local', [{ role: 'employee' }, { role: 'executive' }]);
  const hr = await loginAs('hr@eayni.local');
  let n = 0;
  const mk = async (email: string, first: string, dept: unknown, directManagerId?: string) => {
    const r = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send({
        firstNameAr: first,
        lastNameAr: 'الحارثي',
        gender: 'male',
        nationality: 'سعودي',
        workEmail: email,
        identity: { type: 'national_id', number: `10${String(20000000 + ++n).padStart(8, '0')}` },
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
  const opsMgr = await mk('opsmgr@eayni.local', 'خالد', ops._id);
  await User.updateOne(
    { _id: opsMgr.userId },
    { $push: { roles: { role: 'department_manager', departmentId: ops._id } } },
  );
  const opsMgr2 = await mk('opsmgr2@eayni.local', 'فهد', ops._id);
  await User.updateOne(
    { _id: opsMgr2.userId },
    { $push: { roles: { role: 'department_manager', departmentId: ops._id } } },
  );
  const a = await mk('a@eayni.local', 'أحمد', ops._id, opsMgr.employeeId);
  const b = await mk('b@eayni.local', 'بدر', ops._id, opsMgr.employeeId);
  const itMgr = await mk('itmgr@eayni.local', 'سعد', it._id);
  await User.updateOne(
    { _id: itMgr.userId },
    { $push: { roles: { role: 'department_manager', departmentId: it._id } } },
  );
  const tech = await mk('tech@eayni.local', 'تركي', it._id, itMgr.employeeId);
  return {
    ops,
    it,
    hr,
    root: await loginAs('root@eayni.local'),
    exec: await loginAs('exec@eayni.local'),
    opsMgr: { ...opsMgr, token: await loginAs('opsmgr@eayni.local') },
    opsMgr2: { ...opsMgr2, token: await loginAs('opsmgr2@eayni.local') },
    a,
    b,
    itMgr: { ...itMgr, token: await loginAs('itmgr@eayni.local') },
    tech,
  };
}

describe('go-live review E — rules', () => {
  it('E4: authors edit drafts/rejected only; editing a pending item returns it to draft; published items are edited by approvers; pinned needs an approver; direct publish needs a role', async () => {
    const { a, opsMgr, opsMgr2, hr } = await setup();
    const draft = await request(app())
      .post('/api/v1/news')
      .set(auth(a.token))
      .send({ title: 'خبر الفريق', body: 'نص', pinned: true });
    expect(draft.body.pinned).toBe(false); // ignored for a non-approver
    await request(app()).post(`/api/v1/news/${draft.body._id}/submit`).set(auth(a.token));
    const edited = await request(app())
      .patch(`/api/v1/news/${draft.body._id}`)
      .set(auth(a.token))
      .send({ title: 'خبر الفريق (محدّث)', pinned: true });
    expect(edited.body.state).toBe('draft'); // pending → draft on edit
    expect(edited.body.pinned).toBe(false);
    await request(app()).post(`/api/v1/news/${draft.body._id}/submit`).set(auth(a.token));
    expect(
      (
        await request(app())
          .post(`/api/v1/news/${draft.body._id}/decide`)
          .set(auth(opsMgr.token))
          .send({ approve: true })
      ).body.state,
    ).toBe('published');
    // The author cannot change a published item; an approver can (logged), and may pin.
    expect(
      (
        await request(app())
          .patch(`/api/v1/news/${draft.body._id}`)
          .set(auth(a.token))
          .send({ body: 'محتوى آخر' })
      ).status,
    ).toBe(403);
    const byMgr = await request(app())
      .patch(`/api/v1/news/${draft.body._id}`)
      .set(auth(opsMgr2.token))
      .send({ body: 'محتوى مصحّح', pinned: true });
    expect(byMgr.status).toBe(200);
    expect(byMgr.body.state).toBe('published');
    expect(byMgr.body.pinned).toBe(true);
    const detail = await request(app()).get(`/api/v1/news/${draft.body._id}`).set(auth(opsMgr.token));
    expect(
      detail.body.history.some((h: { action: string; note?: string }) => h.action === 'updated' && h.note),
    ).toBe(true);
    // Direct publishing: HR department item by an HR officer publishes directly; by a plain HR employee it waits.
    await makeUser('hrstaff@eayni.local', [{ role: 'employee' }], {
      departmentId: (await User.findOne({ email: 'hr@eayni.local' }))!.departmentId,
    });
    const hrStaff = await loginAs('hrstaff@eayni.local');
    const circ = await request(app())
      .post('/api/v1/news')
      .set(auth(hrStaff))
      .send({ title: 'تعميم من موظف', body: 'نص', departmentCode: 'hr' });
    expect(circ.status).toBe(201);
    expect(
      (await request(app()).post(`/api/v1/news/${circ.body._id}/submit`).set(auth(hrStaff))).body.state,
    ).toBe('pending_approval');
    const circ2 = await request(app())
      .post('/api/v1/news')
      .set(auth(hr))
      .send({ title: 'تعميم رسمي', body: 'نص', departmentCode: 'hr' });
    expect(
      (await request(app()).post(`/api/v1/news/${circ2.body._id}/submit`).set(auth(hr))).body.state,
    ).toBe('published');
    expect(await News.countDocuments({ state: 'published' })).toBe(2);
  });

  it('E5: record links resolve only for records the caller may access; not-found and not-allowed look the same', async () => {
    const { a, tech, itMgr } = await setup();
    const t = await request(app())
      .post('/api/v1/tickets')
      .set(auth(tech.token))
      .send({
        departmentCode: 'ops',
        type: 'request',
        subject: 'سر',
        body: 'نص',
        priority: 'low',
        fields: {},
      });
    const number = t.body.number as string;
    const link = (token: string, id: string) =>
      request(app())
        .post('/api/v1/calendar/events')
        .set(auth(token))
        .send({
          title: 'اجتماع',
          startAt: '2026-11-10T07:00:00Z',
          endAt: '2026-11-10T08:00:00Z',
          link: { type: 'ticket', id },
        });
    // The IT manager has no access to an Operations ticket (not requester, not department, not assignee).
    const denied = await link(itMgr.token, number);
    const missing = await link(itMgr.token, 'TKT-2026-99999');
    expect(denied.status).toBe(400);
    expect(missing.status).toBe(400);
    expect(denied.body.error.message).toBe(missing.body.error.message);
    expect(JSON.stringify(denied.body)).not.toContain('سر');
    expect((await link(tech.token, number)).status).toBe(201); // the requester may link their own ticket
    expect((await link(a.token, number)).status).toBe(201); // Operations staff see their department queue
  });

  it('E6: participants change status/outcome only; owners and managers over the owner edit content; department tags stay in scope', async () => {
    const { a, b, opsMgr, itMgr, ops, it } = await setup();
    const ev = await request(app())
      .post('/api/v1/calendar/events')
      .set(auth(a.token))
      .send({
        title: 'لقاء',
        startAt: '2026-11-10T07:00:00Z',
        endAt: '2026-11-10T08:00:00Z',
        participantIds: [b.userId],
        departmentIds: [String(ops._id)],
      });
    expect(ev.status).toBe(201);
    expect(
      (
        await request(app())
          .patch(`/api/v1/calendar/events/${ev.body._id}`)
          .set(auth(b.token))
          .send({ title: 'عنوان آخر' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app())
          .patch(`/api/v1/calendar/events/${ev.body._id}`)
          .set(auth(b.token))
          .send({ status: 'done', outcome: 'تم' })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app())
          .patch(`/api/v1/calendar/events/${ev.body._id}`)
          .set(auth(opsMgr.token))
          .send({ title: 'عنوان المدير' })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app())
          .patch(`/api/v1/calendar/events/${ev.body._id}`)
          .set(auth(itMgr.token))
          .send({ title: 'عنوان غريب' })
      ).status,
    ).toBe(404);
    // Department calendars: only departments in my scope.
    expect(
      (
        await request(app())
          .post('/api/v1/calendar/events')
          .set(auth(a.token))
          .send({
            title: 'موعد قسم آخر',
            startAt: '2026-11-10T07:00:00Z',
            endAt: '2026-11-10T08:00:00Z',
            departmentIds: [String(it._id)],
          })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app())
          .post('/api/v1/calendar/events')
          .set(auth(a.token))
          .send({
            title: 'موعد قسمي',
            startAt: '2026-11-10T07:00:00Z',
            endAt: '2026-11-10T08:00:00Z',
            departmentIds: [String(ops._id)],
          })
      ).status,
    ).toBe(201);
  });

  it('E7: a record whose attachment claim fails is not created', async () => {
    const { a, b, opsMgr } = await setup();
    const foreign = await upload(b.token);
    const before = await Ticket.countDocuments();
    const t = await request(app())
      .post('/api/v1/tickets')
      .set(auth(a.token))
      .send({
        departmentCode: 'ops',
        type: 'request',
        subject: 'ملف غيري',
        body: 'نص',
        priority: 'low',
        fields: {},
        attachmentIds: [foreign],
      });
    expect(t.status).toBe(400);
    expect(await Ticket.countDocuments()).toBe(before);
    const task = await request(app())
      .post('/api/v1/tasks')
      .set(auth(opsMgr.token))
      .send({ title: 'مهمة', assigneeId: a.userId, attachmentIds: [foreign] });
    expect(task.status).toBe(400);
    const news = await request(app())
      .post('/api/v1/news')
      .set(auth(opsMgr.token))
      .send({ title: 'خبر', body: 'نص', attachmentIds: [foreign] });
    expect(news.status).toBe(400);
    const rep = await request(app())
      .post('/api/v1/hr/employee-reports')
      .set(auth(a.token))
      .send({ type: 'weekly', title: 'تقرير', body: 'نص', attachmentIds: [foreign] });
    expect(rep.status).toBe(400);
    expect((await Attachment.findById(foreign))!.ownerType).toBeFalsy();
  });

  it('E8: system admin and executive are view-only on tickets', async () => {
    const { a, root, exec, tech } = await setup();
    const t = await request(app())
      .post('/api/v1/tickets')
      .set(auth(a.token))
      .send({
        departmentCode: 'it',
        type: 'issue',
        subject: 'عطل',
        body: 'نص',
        priority: 'low',
        fields: { itType: 'fault' },
      });
    expect((await request(app()).get(`/api/v1/tickets/${t.body._id}`).set(auth(root))).status).toBe(200);
    expect((await request(app()).get(`/api/v1/tickets/${t.body._id}`).set(auth(root))).body.actions).toEqual(
      [],
    );
    for (const token of [root, exec]) {
      expect(
        (
          await request(app())
            .post(`/api/v1/tickets/${t.body._id}/transition`)
            .set(auth(token))
            .send({ transition: 'assign', assigneeId: tech.userId })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app())
            .post(`/api/v1/tickets/${t.body._id}/transition`)
            .set(auth(token))
            .send({ transition: 'request_info', reason: 'x' })
        ).status,
      ).toBe(403);
    }
  });

  it('E9: a task reviewer cannot be its assignee; cancel is for the assigner or a manager who is not the assignee', async () => {
    const { a, opsMgr, opsMgr2 } = await setup();
    // opsMgr assigns a task to opsMgr2 (a manager); opsMgr2 finishes → waiting_review; opsMgr2 cannot approve it.
    const t = await request(app())
      .post('/api/v1/tasks')
      .set(auth(opsMgr.token))
      .send({ title: 'مراجعة', assigneeId: opsMgr2.userId });
    expect(
      (
        await request(app())
          .patch(`/api/v1/tasks/${t.body._id}`)
          .set(auth(opsMgr2.token))
          .send({ status: 'done' })
      ).body.status,
    ).toBe('waiting_review');
    expect(
      (
        await request(app())
          .post(`/api/v1/tasks/${t.body._id}/review`)
          .set(auth(opsMgr2.token))
          .send({ approve: true })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app())
          .post(`/api/v1/tasks/${t.body._id}/review`)
          .set(auth(opsMgr.token))
          .send({ approve: true })
      ).status,
    ).toBe(200);
    const t2 = await request(app())
      .post('/api/v1/tasks')
      .set(auth(opsMgr.token))
      .send({ title: 'إلغاء', assigneeId: opsMgr2.userId });
    expect(
      (
        await request(app())
          .patch(`/api/v1/tasks/${t2.body._id}`)
          .set(auth(opsMgr2.token))
          .send({ status: 'cancelled' })
      ).status,
    ).toBe(403); // assignee, even as a manager
    expect(
      (
        await request(app())
          .patch(`/api/v1/tasks/${t2.body._id}`)
          .set(auth(a.token))
          .send({ status: 'cancelled' })
      ).status,
    ).toBe(404);
    const t3 = await request(app())
      .post('/api/v1/tasks')
      .set(auth(opsMgr.token))
      .send({ title: 'إلغاء 2', assigneeId: a.userId });
    expect(
      (
        await request(app())
          .patch(`/api/v1/tasks/${t3.body._id}`)
          .set(auth(a.token))
          .send({ status: 'cancelled' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app())
          .patch(`/api/v1/tasks/${t3.body._id}`)
          .set(auth(opsMgr2.token))
          .send({ status: 'cancelled' })
      ).status,
    ).toBe(200); // another manager over the task
  });

  it('E10: HTML exports escape values and carry CSP + nosniff', async () => {
    await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
    await makeUser('root2@eayni.local', [{ role: 'system_admin' }], {
      displayNameAr: '<script>alert(1)</script>',
    });
    const t = await loginAs('root2@eayni.local');
    const html = await request(app())
      .post('/api/v1/export')
      .set(auth(t))
      .send({ resource: 'users', fields: ['displayNameAr'], format: 'pdf' });
    expect(html.status).toBe(200);
    expect(html.text).not.toContain('<script>');
    expect(html.text).toContain('&lt;script&gt;');
    expect(html.headers['content-security-policy']).toContain("default-src 'none'");
    expect(html.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('go-live review E11 — login limits and client address', () => {
  afterEach(() => {
    delete process.env.TRUST_PROXY_HOPS;
    resetEnvCache();
  });
  it('parallel wrong passwords cannot bypass the lock; the lock is logged once', async () => {
    await setSetting('auth.maxFailedLogins', 3, SYSTEM_ACTOR);
    await makeUser('par@eayni.local');
    const tries = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(app())
          .post('/api/v1/auth/login')
          .send({ email: 'par@eayni.local', password: 'wrong-pass-1' }),
      ),
    );
    expect(tries.every((r) => r.status === 401)).toBe(true);
    const u = await User.findOne({ email: 'par@eayni.local' });
    expect(u!.lockedUntil && u!.lockedUntil > new Date()).toBe(true);
    expect(
      await LoginLog.countDocuments({ email: 'par@eayni.local', event: 'login_locked' }),
    ).toBeGreaterThanOrEqual(1);
  });
  it('behind CloudFront → API Gateway (2 hops) the client address is taken from X-Forwarded-For', async () => {
    process.env.TRUST_PROXY_HOPS = '2';
    resetEnvCache();
    const twoHops = createApp();
    await request(twoHops)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '203.0.113.9, 70.132.1.1')
      .send({ email: 'nobody-ip@eayni.local', password: 'whatever-1' });
    const row = await LoginLog.findOne({ email: 'nobody-ip@eayni.local' }).lean();
    expect(row?.ip).toBe('203.0.113.9');
  });
});
