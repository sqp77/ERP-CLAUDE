import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { resetEnvCache } from '../config';
import { activateAccount, auth, loginAs, makeDepartment, makeUser, testApp } from '../test/helpers';
import { setSetting } from './settings/service';
import { SYSTEM_ACTOR } from './http/context';
import { AuditLog } from './audit/model';
import { Notification } from './notifications/model';
import { User } from './auth/model';
import { Task, TaskEvent } from './tasks/model';
import { runTaskReminders } from './tasks/jobs';
import { CalendarEvent } from './calendar/model';
import { runEventReminders } from './calendar/jobs';
import { DocumentRecord } from './documents/model';
import { runDocumentExpiryAlerts } from './documents/service';
import { Outbox } from './outbox/model';
import { processOutbox, publish, purgeDeliveredEvents, subscribe } from './outbox/service';
import { startOfRiyadhWeek, riyadhDate } from './dates/businessDays';
import { blindIndex, blindIndexCandidates, keyId } from './auth/crypto';
import { Contract, Employee } from '../modules/hr/model';
import { HrRequest } from '../modules/hr/requests.model';
import { HrRequestAction } from '../modules/hr/requests.model';
import { ProfileChangeRequest } from '../modules/hr/profileChanges.model';
import { runAccountDeactivation, runContractAlerts } from '../modules/hr/jobs';
import { News } from '../modules/news/model';
import { runNewsWindows } from '../modules/news/jobs';

const app = () => testApp();
const DAY = 86_400_000;

async function upload(token: string, sensitive = false) {
  const pre = await request(app())
    .post('/api/v1/files/presign')
    .set(auth(token))
    .send({ fileName: 'f.pdf', mimeType: 'application/pdf', size: 11, sensitive });
  expect(pre.status).toBe(201);
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
  const hrDept = await makeDepartment('hr', 'الموارد البشرية');
  await makeUser('hr@eayni.local', [{ role: 'employee' }, { role: 'hr_officer' }], {
    departmentId: hrDept._id,
  });
  await makeUser('root@eayni.local', [{ role: 'system_admin' }]);
  const hr = await loginAs('hr@eayni.local');
  let n = 0;
  const mk = async (
    email: string,
    first: string,
    directManagerId?: string,
    extra: Record<string, unknown> = {},
  ) => {
    const r = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send({
        firstNameAr: first,
        lastNameAr: 'الشهري',
        gender: 'male',
        nationality: 'سعودي',
        workEmail: email,
        identity: { type: 'national_id', number: `10${String(70000000 + ++n).padStart(8, '0')}` },
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
  const a = await mk('a@eayni.local', 'أحمد', mgr.employeeId);
  return {
    ops,
    hr,
    root: await loginAs('root@eayni.local'),
    mgr: { ...mgr, token: await loginAs('mgr@eayni.local') },
    a,
    mk,
  };
}

describe('go-live review G — data integrity', () => {
  it('G1: the overdue job flips status conditionally with a task event and an audit entry; a new due date clears the flags and recomputes "late"', async () => {
    const { mgr, a } = await setup();
    const created = await request(app())
      .post('/api/v1/tasks')
      .set(auth(mgr.token))
      .send({ title: 'جرد الحاويات', assigneeId: a.userId, dueAt: new Date(Date.now() + DAY) });
    expect(created.status).toBe(201);
    const id = created.body._id as string;
    await Task.updateOne({ _id: id }, { $set: { dueAt: new Date(Date.now() - 3_600_000) } });
    expect((await runTaskReminders()).overdue).toBe(1);
    const late = await Task.findById(id).lean();
    expect(late?.status).toBe('late');
    expect(late?.remindedOverdue).toBe(true);
    expect(
      await TaskEvent.countDocuments({
        taskId: id,
        type: 'status_changed',
        fromStatus: 'new',
        toStatus: 'late',
      }),
    ).toBe(1);
    expect(await AuditLog.countDocuments({ resource: 'tasks', resourceId: id, system: true })).toBe(1);
    // Running again does nothing (flag set, status already late).
    expect((await runTaskReminders()).overdue).toBe(0);
    // Moving the due date into the future resets reminders and the status.
    const moved = await request(app())
      .patch(`/api/v1/tasks/${id}`)
      .set(auth(mgr.token))
      .send({ dueAt: new Date(Date.now() + 2 * DAY) });
    expect(moved.status).toBe(200);
    const fresh = await Task.findById(id).lean();
    expect(fresh?.status).toBe('new');
    expect(fresh?.remindedOverdue).toBe(false);
    expect(fresh?.remindedDueSoon).toBe(false);
    // Moving it back into the past marks it late immediately.
    await request(app())
      .patch(`/api/v1/tasks/${id}`)
      .set(auth(mgr.token))
      .send({ dueAt: new Date(Date.now() - DAY) });
    expect((await Task.findById(id).lean())?.status).toBe('late');
  });

  it('G2: rescheduled meetings get reminders too', async () => {
    const { mgr, a } = await setup();
    const ev = await request(app())
      .post('/api/v1/calendar/events')
      .set(auth(mgr.token))
      .send({
        title: 'اجتماع الفريق',
        startAt: new Date(Date.now() + 2 * DAY),
        endAt: new Date(Date.now() + 2 * DAY + 3_600_000),
        participantIds: [a.userId],
      });
    expect(ev.status).toBe(201);
    const moved = await request(app())
      .patch(`/api/v1/calendar/events/${ev.body._id}`)
      .set(auth(mgr.token))
      .send({ startAt: new Date(Date.now() + 3 * DAY), endAt: new Date(Date.now() + 3 * DAY + 3_600_000) });
    expect(moved.body.status).toBe('rescheduled');
    await CalendarEvent.updateOne(
      { _id: ev.body._id },
      { $set: { startAt: new Date(Date.now() + 30 * 60_000), endAt: new Date(Date.now() + 90 * 60_000) } },
    );
    expect(await runEventReminders()).toBe(1);
    expect(await runEventReminders()).toBe(0);
  });

  it('G3: a contract expires the day after its end date (Riyadh), audited; renewal after expiry continues the version chain', async () => {
    const { hr, a } = await setup();
    const now = new Date();
    const todayRiyadh = riyadhDate(now);
    // End date = today in Riyadh (an instant earlier today): NOT expired yet.
    const [y, m, d] = todayRiyadh.split('-').map(Number);
    const earlierToday = new Date(Date.UTC(y, m - 1, d, -3, 0, 1)); // 00:00:01 Riyadh
    const c1 = await request(app())
      .post(`/api/v1/hr/employees/${a.employeeId}/contracts`)
      .set(auth(hr))
      .send({ type: 'fixed_term', startDate: '2025-01-01', endDate: earlierToday.toISOString() });
    expect(c1.status).toBe(201);
    const laterToday = new Date(Date.UTC(y, m - 1, d, -3, 12));
    if (laterToday > now) expect((await runContractAlerts(laterToday)).expired).toBe(0);
    else expect((await runContractAlerts(now)).expired).toBe(0);
    expect((await Contract.findById(c1.body._id))?.status).toBe('active');
    // The next day it is expired, once, with an audit entry.
    const tomorrow = new Date(Date.UTC(y, m - 1, d + 1, -3, 0, 5));
    expect((await runContractAlerts(tomorrow)).expired).toBe(1);
    expect((await runContractAlerts(tomorrow)).expired).toBe(0);
    expect((await Contract.findById(c1.body._id))?.status).toBe('expired');
    expect(
      await AuditLog.countDocuments({ resource: 'hr.contracts', resourceId: c1.body._id, system: true }),
    ).toBe(1);
    // Renewal after the expiry: version 2 linked to the expired one, not a new chain.
    const c2 = await request(app())
      .post(`/api/v1/hr/employees/${a.employeeId}/contracts`)
      .set(auth(hr))
      .send({ type: 'open_ended', startDate: tomorrow.toISOString() });
    expect(c2.status).toBe(201);
    expect(c2.body.version).toBe(2);
    expect(String(c2.body.previousId)).toBe(c1.body._id);
    expect((await Contract.findById(c1.body._id))?.statusReason).toBe('end_date_passed'); // not rewritten to "renewed"
  });

  it('G4: account deactivation re-checks the employee at write time and is audited; a reinstated employee keeps the account', async () => {
    const { hr, a, mk } = await setup();
    const b = await mk('b@eayni.local', 'بدر');
    const lastDay = new Date(Date.now() - 3 * DAY);
    for (const e of [a, b])
      await request(app())
        .post(`/api/v1/hr/employees/${e.employeeId}/status`)
        .set(auth(hr))
        .send({ status: 'resigned', effectiveDate: lastDay.toISOString(), reason: 'استقالة' });
    // b is reinstated before the job runs.
    await request(app())
      .post(`/api/v1/hr/employees/${b.employeeId}/status`)
      .set(auth(hr))
      .send({ status: 'active', effectiveDate: new Date().toISOString(), reason: 'عودة' });
    expect(await runAccountDeactivation(new Date())).toBe(1);
    expect((await User.findById(a.userId))?.status).toBe('disabled');
    expect((await User.findById(b.userId))?.status).toBe('active');
    expect(
      await AuditLog.countDocuments({
        resource: 'users',
        resourceId: a.userId,
        system: true,
        'meta.job': 'hr.accounts.deactivate',
      }),
    ).toBe(1);
    expect((await Employee.findById(a.employeeId))?.accountDisabledAt).toBeTruthy();
    expect(await runAccountDeactivation(new Date())).toBe(0);
  });

  it('G5: expiry alerts and the HR dashboard consider only the latest document version; a document inside the window gets one alert', async () => {
    const { hr, a } = await setup();
    await makeUser('hrm@eayni.local', [{ role: 'employee' }, { role: 'hr_manager' }]);
    const hrm = await loginAs('hrm@eayni.local');
    const mkDoc = async (expiryDate: Date) =>
      request(app())
        .post('/api/v1/documents')
        .set(auth(hr))
        .send({
          ownerType: 'employee',
          ownerId: a.employeeId,
          type: 'passport',
          titleAr: 'جواز السفر',
          attachmentId: await upload(hr),
          expiryDate,
        });
    const v1 = await mkDoc(new Date(Date.now() + 5 * DAY));
    expect(v1.status).toBe(201);
    const v2 = await mkDoc(new Date(Date.now() + 400 * DAY));
    expect(v2.body.version).toBe(2);
    // The superseded version is inside every offset but is ignored; the latest is outside the window.
    expect(await runDocumentExpiryAlerts()).toBe(0);
    expect(await Notification.countDocuments({ type: 'document.expiring' })).toBe(0);
    const dash = await request(app()).get('/api/v1/hr/dashboard/hr').set(auth(hrm));
    expect(dash.status).toBe(200);
    expect(dash.body.expiring.documents.d90).toBe(0);
    // A fresh document 5 days from expiry: only the nearest offset (7) fires, 90 and 30 are marked as passed.
    const third = await request(app())
      .post('/api/v1/documents')
      .set(auth(hr))
      .send({
        ownerType: 'employee',
        ownerId: a.employeeId,
        type: 'driving_licence',
        titleAr: 'رخصة القيادة',
        attachmentId: await upload(hr),
        expiryDate: new Date(Date.now() + 5 * DAY),
      });
    expect(third.status).toBe(201);
    const sent = await runDocumentExpiryAlerts();
    expect(sent).toBe(1);
    const doc = await DocumentRecord.findById(third.body._id).lean();
    expect([...doc!.alertsSent].sort((x, y) => x - y)).toEqual([7, 30, 90]);
    expect(await runDocumentExpiryAlerts()).toBe(0);
  });

  it('G6: one pending bank change per employee via the unique index; cancel is conditional and audited', async () => {
    const { a } = await setup();
    const body = async () => ({
      bankName: 'الأهلي',
      iban: 'SA4420000001234567891234',
      proofAttachmentId: await upload(a.token, true),
    });
    const first = await request(app())
      .post('/api/v1/hr/me/bank-change')
      .set(auth(a.token))
      .send(await body());
    expect(first.status).toBe(201);
    const dup = await request(app())
      .post('/api/v1/hr/me/bank-change')
      .set(auth(a.token))
      .send(await body());
    expect(dup.status).toBe(409);
    expect(await ProfileChangeRequest.countDocuments({ state: 'pending' })).toBe(1);
    const idx = await ProfileChangeRequest.collection.indexes();
    expect(
      idx.some(
        (i) =>
          i.unique &&
          i.partialFilterExpression &&
          JSON.stringify(i.key) === JSON.stringify({ employeeId: 1, type: 1 }),
      ),
    ).toBe(true);
    const cancel = await request(app())
      .post(`/api/v1/hr/me/change-requests/${first.body._id}/cancel`)
      .set(auth(a.token));
    expect(cancel.status).toBe(200);
    const again = await request(app())
      .post(`/api/v1/hr/me/change-requests/${first.body._id}/cancel`)
      .set(auth(a.token));
    expect(again.status).toBe(409);
    expect(
      await AuditLog.countDocuments({
        resource: 'hr.profile_changes',
        resourceId: first.body._id,
        action: 'update',
      }),
    ).toBe(1);
    // After the cancel a new request is accepted again.
    expect(
      (
        await request(app())
          .post('/api/v1/hr/me/bank-change')
          .set(auth(a.token))
          .send(await body())
      ).status,
    ).toBe(201);
  });

  it('G7: an item whose window ended is archived, never announced; announce is claimed once; archive and pin are conditional and audited', async () => {
    const { hr, a } = await setup();
    const past = new Date(Date.now() - 2 * DAY);
    const sched = await request(app())
      .post('/api/v1/news')
      .set(auth(hr))
      .send({
        title: 'إعلان انتهى قبل أن يُعلن',
        body: 'نص',
        publishFrom: new Date(Date.now() + DAY),
        publishTo: new Date(Date.now() + 2 * DAY),
      });
    expect(sched.status).toBe(201);
    expect((await request(app()).post(`/api/v1/news/${sched.body._id}/submit`).set(auth(hr))).status).toBe(
      200,
    );
    // The job was down: the whole window is already in the past.
    await News.updateOne(
      { _id: sched.body._id },
      { $set: { publishFrom: new Date(past.getTime() - DAY), publishTo: past } },
    );
    expect(await runNewsWindows()).toEqual({ announced: 0, archived: 1 });
    expect(
      await Notification.countDocuments({ type: 'news.published', bodyAr: 'إعلان انتهى قبل أن يُعلن' }),
    ).toBe(0);
    // Announce is claimed by a conditional update: two concurrent runs notify once.
    const live = await request(app())
      .post('/api/v1/news')
      .set(auth(hr))
      .send({ title: 'إعلان حي', body: 'نص', publishFrom: new Date(Date.now() + DAY) });
    await request(app()).post(`/api/v1/news/${live.body._id}/submit`).set(auth(hr));
    await News.updateOne({ _id: live.body._id }, { $set: { publishFrom: past } });
    const [r1, r2] = await Promise.all([runNewsWindows(), runNewsWindows()]);
    expect(r1.announced + r2.announced).toBe(1);
    expect(
      await Notification.countDocuments({ type: 'news.published', bodyAr: 'إعلان حي', userId: a.userId }),
    ).toBe(1);
    // Pin and archive are audited; a stale archive (state changed underneath) is a 409.
    expect(
      (await request(app()).post(`/api/v1/news/${live.body._id}/pin`).set(auth(hr)).send({ pinned: true }))
        .status,
    ).toBe(200);
    expect(
      await AuditLog.countDocuments({ resource: 'news', resourceId: live.body._id, 'after.pinned': true }),
    ).toBe(1);
    expect((await request(app()).post(`/api/v1/news/${live.body._id}/archive`).set(auth(hr))).status).toBe(
      200,
    );
    expect(
      await AuditLog.countDocuments({
        resource: 'news',
        resourceId: live.body._id,
        'after.state': 'archived',
      }),
    ).toBe(1);
    expect((await News.findById(live.body._id))?.pinned).toBe(false);
  });

  it('G8: outbox indexes, retention purge, failure alert to admins, admin requeue (and 403 for others), replay window and order', async () => {
    const { root, hr } = await setup();
    await Outbox.syncIndexes();
    const keys = (await Outbox.collection.indexes()).map((i) => JSON.stringify(i.key));
    expect(keys).toContain(JSON.stringify({ status: 1, availableAt: 1, createdAt: 1 }));
    expect(keys).toContain(JSON.stringify({ status: 1, leaseExpiresAt: 1 }));
    expect(keys).toContain(JSON.stringify({ status: 1, type: 1, createdAt: 1 }));
    expect(keys).toContain(JSON.stringify({ status: 1, deliveredAt: 1 }));

    // Retention: delivered events older than the setting are purged; younger, failed and unhandled stay.
    await Outbox.create([
      { type: 'x', status: 'delivered', deliveredAt: new Date(Date.now() - 100 * DAY) },
      { type: 'x', status: 'delivered', deliveredAt: new Date(Date.now() - 10 * DAY) },
      { type: 'x', status: 'failed', deliveredAt: new Date(Date.now() - 100 * DAY) },
      { type: 'nobody', status: 'unhandled', createdAt: new Date(Date.now() - 100 * DAY) },
    ]);
    expect(await purgeDeliveredEvents()).toBe(1);
    expect(await Outbox.countDocuments({ type: { $in: ['x', 'nobody'] } })).toBe(3);

    // A handler that keeps failing: after the last attempt the admins get a security alert.
    subscribe('boom', async () => {
      throw new Error('handler down');
    });
    await publish({ type: 'boom', payload: {} });
    for (let i = 0; i < 5; i++) {
      await Outbox.updateMany({ type: 'boom' }, { $set: { availableAt: new Date(0) } });
      await processOutbox();
    }
    const failed = await Outbox.findOne({ type: 'boom' }).lean();
    expect(failed?.status).toBe('failed');
    const admin = await User.findOne({ email: 'root@eayni.local' }).lean();
    expect(
      await Notification.countDocuments({
        userId: admin!._id,
        type: 'security.alert',
        'data.kind': 'outbox.failed',
      }),
    ).toBe(1);

    // Admin screen: list shows it; HR cannot; the admin requeues it (status pending, attempts 0, audited).
    expect((await request(app()).get('/api/v1/outbox').set(auth(hr))).status).toBe(403);
    const list = await request(app()).get('/api/v1/outbox').set(auth(root));
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: { type: string }) => i.type)).toEqual(
      expect.arrayContaining(['boom', 'nobody']),
    );
    expect(list.body.counts.failed).toBe(2);
    expect((await request(app()).post(`/api/v1/outbox/${failed!._id}/requeue`).set(auth(hr))).status).toBe(
      403,
    );
    const rq = await request(app()).post(`/api/v1/outbox/${failed!._id}/requeue`).set(auth(root));
    expect(rq.status).toBe(200);
    expect(rq.body).toMatchObject({ status: 'pending', attempts: 0 });
    expect((await request(app()).post(`/api/v1/outbox/${failed!._id}/requeue`).set(auth(root))).status).toBe(
      409,
    );
    expect(await AuditLog.countDocuments({ resource: 'outbox', resourceId: String(failed!._id) })).toBe(1);
    await Outbox.deleteMany({ type: { $in: ['boom', 'x'] } });

    // Replay window: an unhandled event older than the window is expired, a recent one is replayed, and
    // replayed events are delivered before live ones.
    await Outbox.create([
      {
        type: 'nobody',
        status: 'unhandled',
        aggregateId: 'old-but-ok',
        createdAt: new Date(Date.now() - 5 * DAY),
      },
    ]);
    const seen: string[] = [];
    subscribe('nobody', async (e) => {
      seen.push(String(e.aggregateId));
    });
    await publish({ type: 'nobody', aggregateId: 'live', payload: {} });
    const r = await processOutbox();
    expect(r.delivered).toBe(2);
    expect(seen).toEqual(['old-but-ok', 'live']);
    expect(await Outbox.countDocuments({ type: 'nobody', status: 'expired' })).toBe(1);
    // The expired one can be brought back by hand.
    const expired = await Outbox.findOne({ type: 'nobody', status: 'expired' }).lean();
    expect((await request(app()).post(`/api/v1/outbox/${expired!._id}/requeue`).set(auth(root))).status).toBe(
      200,
    );
    await processOutbox();
    expect(seen).toHaveLength(3);
  });

  it('G9: an HR request is created atomically: a bad attachment leaves no request, no action log and no audit entry', async () => {
    const { a, mk } = await setup();
    const b = await mk('b@eayni.local', 'بدر');
    const foreign = await upload(b.token); // uploaded by someone else → claim fails
    const bad = await request(app())
      .post('/api/v1/hr/requests')
      .set(auth(a.token))
      .send({
        type: 'leave',
        details: { leaveType: 'annual', startDate: '2026-12-01', endDate: '2026-12-03', reason: 'إجازة' },
        attachmentIds: [foreign],
      });
    expect(bad.status).toBe(400);
    expect(await HrRequest.countDocuments()).toBe(0);
    expect(await HrRequestAction.countDocuments()).toBe(0);
    expect(await AuditLog.countDocuments({ resource: 'hr.requests' })).toBe(0);
    const ok = await request(app())
      .post('/api/v1/hr/requests')
      .set(auth(a.token))
      .send({
        type: 'leave',
        details: { leaveType: 'annual', startDate: '2026-12-01', endDate: '2026-12-03', reason: 'إجازة' },
      });
    expect(ok.status).toBe(201);
    expect(await HrRequestAction.countDocuments({ requestId: ok.body._id, action: 'created' })).toBe(1);
    expect(
      await AuditLog.countDocuments({ resource: 'hr.requests', resourceId: ok.body._id, action: 'create' }),
    ).toBe(1);
  });

  it('G10: "away until" on the team page compares Riyadh calendar dates for a leave stored as a Date', async () => {
    const { hr, mgr, a, ops } = await setup();
    await request(app())
      .post(`/api/v1/hr/employees/${a.employeeId}/status`)
      .set(auth(hr))
      .send({ status: 'on_leave', effectiveDate: new Date().toISOString(), reason: 'إجازة' });
    const base = {
      type: 'leave',
      employeeId: a.employeeId,
      requesterUserId: a.userId,
      departmentId: ops._id,
      state: 'approved',
      stateEnteredAt: new Date(),
      route: {},
      flags: [],
    };
    // An old leave that ended yesterday and a current one ending in two days (both stored as Dates).
    await HrRequest.create([
      {
        ...base,
        number: 'HRQ-T-1',
        details: {
          leaveType: 'annual',
          startDate: new Date(Date.now() - 5 * DAY),
          endDate: new Date(Date.now() - DAY),
        },
      },
      {
        ...base,
        number: 'HRQ-T-2',
        details: { leaveType: 'annual', startDate: new Date(), endDate: new Date(Date.now() + 2 * DAY) },
      },
    ]);
    const team = await request(app()).get('/api/v1/hr/team').set(auth(mgr.token));
    expect(team.status).toBe(200);
    const row = team.body.items.find((i: { fullNameAr: string }) => i.fullNameAr === 'أحمد الشهري');
    expect(row.awayKind).toBe('on_leave');
    expect(row.awayUntil).toBe(riyadhDate(new Date(Date.now() + 2 * DAY)));
  });

  it('G11: the manager-dashboard week starts on Sunday 00:00 Riyadh, also between 00:00 and 03:00 Sunday', async () => {
    // Sunday 2026-11-08 01:30 Riyadh = Saturday 2026-11-07 22:30 UTC.
    const earlySunday = new Date('2026-11-07T22:30:00Z');
    expect(startOfRiyadhWeek(earlySunday).toISOString()).toBe('2026-11-07T21:00:00.000Z');
    // Wednesday 2026-11-11 10:00 Riyadh → same Sunday.
    expect(startOfRiyadhWeek(new Date('2026-11-11T07:00:00Z')).toISOString()).toBe(
      '2026-11-07T21:00:00.000Z',
    );
    // Saturday 2026-11-07 23:59 Riyadh (20:59 UTC) belongs to the previous week.
    expect(startOfRiyadhWeek(new Date('2026-11-07T20:59:00Z')).toISOString()).toBe(
      '2026-10-31T21:00:00.000Z',
    );
  });

  it('G12: the blind index records its key id and duplicate checks match hashes made under the previous secret', async () => {
    const { hr, a, ops } = await setup();
    const stored = await Employee.findById(a.employeeId).lean();
    expect(stored?.identity?.hashKid).toBe(keyId());
    const number = '1070000002'; // a's identity number (second one minted by setup, after the manager)
    expect(stored?.identity?.hash).toBe(blindIndex(number));
    const oldSecret = process.env.APP_SECRET!;
    process.env.APP_SECRET_PREVIOUS = oldSecret;
    process.env.APP_SECRET = 'rotated-secret-rotated-secret-0001';
    resetEnvCache();
    try {
      expect(blindIndex(number)).not.toBe(stored?.identity?.hash);
      expect(blindIndexCandidates(number)).toContain(stored?.identity?.hash);
      const dup = await request(app())
        .post('/api/v1/hr/employees')
        .set(auth(hr))
        .send({
          firstNameAr: 'نسخة',
          lastNameAr: 'مكررة',
          gender: 'male',
          nationality: 'سعودي',
          workEmail: 'dup@eayni.local',
          identity: { type: 'national_id', number },
          hireDate: '2024-01-10',
          departmentId: String(ops._id),
        });
      expect(dup.status).toBe(409);
    } finally {
      process.env.APP_SECRET = oldSecret;
      delete process.env.APP_SECRET_PREVIOUS;
      resetEnvCache();
    }
  });
});
