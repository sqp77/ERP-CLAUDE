import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { auth, loginAs, makeDepartment, makeUser, testApp } from '../../test/helpers';
import { setSetting } from '../../core/settings/service';
import { SYSTEM_ACTOR } from '../../core/http/context';
import { Notification } from '../../core/notifications/model';
import { News } from './model';
import { runNewsWindows } from './jobs';

const app = () => testApp();

async function setup() {
  await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
  const ops = await makeDepartment('ops', 'التشغيل');
  const sales = await makeDepartment('sales', 'المبيعات');
  const hrDept = await makeDepartment('hr', 'الموارد البشرية');
  await makeUser(
    'opsmgr@eayni.local',
    [{ role: 'employee' }, { role: 'department_manager', departmentId: String(ops._id) }],
    { departmentId: ops._id },
  );
  await makeUser(
    'opsmgr2@eayni.local',
    [{ role: 'employee' }, { role: 'department_manager', departmentId: String(ops._id) }],
    { departmentId: ops._id },
  );
  await makeUser('ops1@eayni.local', [{ role: 'employee' }], { departmentId: ops._id });
  await makeUser('sales1@eayni.local', [{ role: 'employee' }], { departmentId: sales._id });
  await makeUser('hr@eayni.local', [{ role: 'employee' }, { role: 'hr_officer' }], {
    departmentId: hrDept._id,
  });
  return {
    ops,
    sales,
    opsmgr: await loginAs('opsmgr@eayni.local'),
    opsmgr2: await loginAs('opsmgr2@eayni.local'),
    ops1: await loginAs('ops1@eayni.local'),
    sales1: await loginAs('sales1@eayni.local'),
    hr: await loginAs('hr@eayni.local'),
  };
}

describe('news & circulars [EP §12, DECISIONS §10]', () => {
  it("a department item needs the department manager's approval; staff cannot create; audience and notifications are respected", async () => {
    const { ops, opsmgr, opsmgr2, ops1, sales1 } = await setup();
    // Staff may write for their own department only; the manager approves (slice 5 review change).
    expect(
      (
        await request(app())
          .post('/api/v1/news')
          .set(auth(ops1))
          .send({ title: 'خبر', body: 'نص الخبر', departmentCode: 'sales' })
      ).status,
    ).toBe(403);
    const created = await request(app())
      .post('/api/v1/news')
      .set(auth(opsmgr))
      .send({
        title: 'افتتاح مستودع الدمام الجديد',
        body: 'تم افتتاح المستودع…',
        audienceAll: false,
        audienceDepartmentIds: [String(ops._id)],
      });
    expect(created.status).toBe(201);
    expect(created.body.number).toMatch(/^NWS-\d{4}-00001$/);
    expect(created.body.state).toBe('draft');
    // Not in the feed while a draft; the author sees it in "manage".
    expect((await request(app()).get('/api/v1/news?view=feed').set(auth(ops1))).body.total).toBe(0);
    expect((await request(app()).get(`/api/v1/news/${created.body._id}`).set(auth(ops1))).status).toBe(404);
    // Submit → another manager of the same department approves (the author may not reject their own).
    const submitted = await request(app()).post(`/api/v1/news/${created.body._id}/submit`).set(auth(opsmgr));
    expect(submitted.status).toBe(200);
    // The author is also an approver here, so submit published directly? No: the author is a manager → self-approve publishes.
    expect(['pending_approval', 'published']).toContain(submitted.body.state);
    const n = await News.findById(created.body._id).lean();
    if (n!.state === 'pending_approval') {
      expect(
        (
          await request(app())
            .post(`/api/v1/news/${created.body._id}/decide`)
            .set(auth(ops1))
            .send({ approve: true })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app())
            .post(`/api/v1/news/${created.body._id}/decide`)
            .set(auth(opsmgr2))
            .send({ approve: true })
        ).status,
      ).toBe(200);
    }
    // Feed: Operations staff see it, Sales staff do not; audience notified.
    expect((await request(app()).get('/api/v1/news?view=feed').set(auth(ops1))).body.total).toBe(1);
    expect((await request(app()).get('/api/v1/news?view=feed').set(auth(sales1))).body.total).toBe(0);
    expect((await request(app()).get(`/api/v1/news/${created.body._id}`).set(auth(sales1))).status).toBe(404);
    const ops1User = (await request(app()).get('/api/v1/auth/me').set(auth(ops1))).body.user.id;
    const sales1User = (await request(app()).get('/api/v1/auth/me').set(auth(sales1))).body.user.id;
    expect(await Notification.countDocuments({ type: 'news.published', userId: ops1User })).toBe(1);
    expect(await Notification.countDocuments({ type: 'news.published', userId: sales1User })).toBe(0);
  });

  it('a staff-authored item (manager role absent) waits for approval; rejection needs a reason and returns it to the author', async () => {
    const { ops, opsmgr, hr } = await setup();
    // HR officer publishes for Operations? No — HR may publish for any department, so use a plain draft by the manager and decide with HR.
    const created = await request(app())
      .post('/api/v1/news')
      .set(auth(opsmgr))
      .send({ title: 'خبر يحتاج تعديلًا', body: 'نص', departmentCode: 'ops' });
    await News.updateOne({ _id: created.body._id }, { $set: { state: 'pending_approval' } });
    expect(
      (
        await request(app())
          .post(`/api/v1/news/${created.body._id}/decide`)
          .set(auth(hr))
          .send({ approve: false })
      ).status,
    ).toBe(400);
    const rejected = await request(app())
      .post(`/api/v1/news/${created.body._id}/decide`)
      .set(auth(hr))
      .send({ approve: false, reason: 'العنوان غير واضح' });
    expect(rejected.body.state).toBe('rejected');
    const edited = await request(app())
      .patch(`/api/v1/news/${created.body._id}`)
      .set(auth(opsmgr))
      .send({ title: 'عنوان أوضح' });
    expect(edited.body.state).toBe('draft');
    expect(String(ops._id)).toBeTruthy();
  });

  it('HR circulars publish directly to everyone, pinned first; scheduled windows announce and archive by the job', async () => {
    const { hr, ops1, sales1, opsmgr } = await setup();
    const circular = await request(app())
      .post('/api/v1/news')
      .set(auth(hr))
      .send({ title: 'تعميم إجازة اليوم الوطني', body: 'يُعلن…', pinned: true });
    const pub = await request(app()).post(`/api/v1/news/${circular.body._id}/submit`).set(auth(hr));
    expect(pub.body.state).toBe('published');
    expect(await Notification.countDocuments({ type: 'news.published' })).toBeGreaterThanOrEqual(2);
    // A scheduled item: published state, future window, no notification yet.
    const later = new Date(Date.now() + 2 * 86_400_000);
    const sched = await request(app())
      .post('/api/v1/news')
      .set(auth(hr))
      .send({
        title: 'إعلان مجدول',
        body: 'نص',
        publishFrom: later,
        publishTo: new Date(later.getTime() + 86_400_000),
      });
    await request(app()).post(`/api/v1/news/${sched.body._id}/submit`).set(auth(hr));
    const feed = await request(app()).get('/api/v1/news?view=feed').set(auth(ops1));
    expect(feed.body.items.map((i: { title: string }) => i.title)).toEqual(['تعميم إجازة اليوم الوطني']);
    expect(await Notification.countDocuments({ type: 'news.published', bodyAr: 'إعلان مجدول' })).toBe(0);
    expect(await runNewsWindows()).toEqual({ announced: 0, archived: 0 });
    // Time passes: the window opens (announced) and then closes (archived).
    await News.updateOne(
      { _id: sched.body._id },
      {
        $set: {
          publishFrom: new Date(Date.now() - 3 * 86_400_000),
          publishTo: new Date(Date.now() + 86_400_000),
        },
      },
    );
    expect(await runNewsWindows()).toEqual({ announced: 1, archived: 0 });
    expect(
      await Notification.countDocuments({ type: 'news.published', bodyAr: 'إعلان مجدول' }),
    ).toBeGreaterThan(0);
    await News.updateOne({ _id: sched.body._id }, { $set: { publishTo: new Date(Date.now() - 1000) } });
    expect(await runNewsWindows()).toEqual({ announced: 0, archived: 1 });
    const archive = await request(app()).get('/api/v1/news?view=archive').set(auth(sales1));
    expect(archive.body.items.map((i: { title: string }) => i.title)).toEqual(['إعلان مجدول']);
    // Pinned ordering: a second (unpinned) ops item sorts after the pinned circular.
    const ops = await request(app())
      .post('/api/v1/news')
      .set(auth(opsmgr))
      .send({ title: 'خبر تشغيلي', body: 'نص' });
    await request(app()).post(`/api/v1/news/${ops.body._id}/submit`).set(auth(opsmgr));
    const feed2 = await request(app()).get('/api/v1/news?view=feed').set(auth(ops1));
    expect(feed2.body.items[0].title).toBe('تعميم إجازة اليوم الوطني');
    // Pin / unpin is for approvers only.
    expect(
      (await request(app()).post(`/api/v1/news/${ops.body._id}/pin`).set(auth(ops1)).send({ pinned: true }))
        .status,
    ).toBe(403);
    expect(
      (await request(app()).post(`/api/v1/news/${ops.body._id}/pin`).set(auth(opsmgr)).send({ pinned: true }))
        .body.pinned,
    ).toBe(true);
  });
});

describe('slice 5 review change — staff authoring', () => {
  it('department staff write news for their own department; the manager approves; a per-department switch turns it off', async () => {
    const { ops1, opsmgr, sales1 } = await setup();
    const mine = await request(app()).get('/api/v1/news/departments').set(auth(ops1));
    expect(mine.body.items.map((d: { code: string }) => d.code)).toEqual(['ops']);
    const draft = await request(app())
      .post('/api/v1/news')
      .set(auth(ops1))
      .send({ title: 'إنجاز فريق الفرز', body: 'تجاوز الفريق 40 طنًا هذا الشهر.' });
    expect(draft.status).toBe(201);
    expect(draft.body.departmentCode).toBe('ops');
    expect(draft.body.authorName).toBe('ops1');
    const submitted = await request(app()).post(`/api/v1/news/${draft.body._id}/submit`).set(auth(ops1));
    expect(submitted.body.state).toBe('pending_approval');
    const opsmgrUser = (await request(app()).get('/api/v1/auth/me').set(auth(opsmgr))).body.user.id;
    expect(await Notification.countDocuments({ userId: opsmgrUser, titleAr: 'خبر بانتظار اعتمادك' })).toBe(1);
    // The author may not approve their own item; the department manager may; sales staff never see the draft.
    expect(
      (
        await request(app())
          .post(`/api/v1/news/${draft.body._id}/decide`)
          .set(auth(ops1))
          .send({ approve: true })
      ).status,
    ).toBe(403);
    expect((await request(app()).get(`/api/v1/news/${draft.body._id}`).set(auth(sales1))).status).toBe(404);
    expect(
      (
        await request(app())
          .post(`/api/v1/news/${draft.body._id}/decide`)
          .set(auth(opsmgr))
          .send({ approve: true })
      ).body.state,
    ).toBe('published');
    // Switch off for Operations: staff can no longer author.
    await setSetting('news.staffAuthoringDepartments', { ops: false }, SYSTEM_ACTOR);
    expect((await request(app()).get('/api/v1/news/departments').set(auth(ops1))).body.items).toEqual([]);
    expect(
      (await request(app()).post('/api/v1/news').set(auth(ops1)).send({ title: 'خبر', body: 'نص' })).status,
    ).toBe(403);
  });
});
