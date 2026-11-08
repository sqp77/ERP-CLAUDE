import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { activateAccount, auth, loginAs, makeDepartment, makeUser, testApp } from '../../test/helpers';
import { setSetting } from '../settings/service';
import { SYSTEM_ACTOR } from '../http/context';
import { Notification } from '../notifications/model';
import { User } from '../auth/model';
import { runEventReminders } from './jobs';
import { CalendarEvent } from './model';

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
        lastNameAr: 'العتيبي',
        gender: 'male',
        nationality: 'سعودي',
        workEmail: email,
        identity: { type: 'national_id', number: `10${String(60000000 + ++n).padStart(8, '0')}` },
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
  const mgr = await mk('mgr@eayni.local', 'خالد');
  await User.updateOne(
    { _id: mgr.userId },
    { $push: { roles: { role: 'department_manager', departmentId: ops._id } } },
  );
  const a = await mk('a@eayni.local', 'أحمد', mgr.employeeId);
  const b = await mk('b@eayni.local', 'إبراهيم', mgr.employeeId);
  return { hr, ops, mgr: { ...mgr, token: await loginAs('mgr@eayni.local') }, a, b };
}

describe('calendar [EP §13]', () => {
  it('merges my tasks and secondments into the calendar as read-only items; search is hamza-tolerant', async () => {
    const { hr, mgr, a } = await setup();
    await request(app())
      .post('/api/v1/tasks')
      .set(auth(mgr.token))
      .send({ title: 'جرد', assigneeId: a.userId, dueAt: '2026-11-10T07:00:00.000Z' });
    await request(app())
      .post(`/api/v1/hr/employees/${a.employeeId}/status`)
      .set(auth(hr))
      .send({
        status: 'seconded',
        effectiveDate: '2026-11-15',
        reason: 'انتداب',
        secondment: { destination: 'فرع جدة', startDate: '2026-11-15', endDate: '2026-11-20' },
      });
    const r = await request(app())
      .get('/api/v1/calendar/events?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z')
      .set(auth(a.token));
    expect(r.status).toBe(200);
    const types = r.body.items.map((i: { type: string; readOnly: boolean }) => [i.type, i.readOnly]);
    expect(types).toEqual(
      expect.arrayContaining([
        ['task', true],
        ['secondment', true],
      ]),
    );
    expect(r.body.items.find((i: { type: string }) => i.type === 'task').link.type).toBe('task');
    // Another employee does not see a's task.
    const other = await request(app())
      .get('/api/v1/calendar/events?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z')
      .set(auth(mgr.token));
    expect(other.body.items.some((i: { type: string }) => i.type === 'task')).toBe(false);
    // People search: "ابراهيم" finds "إبراهيم".
    const people = await request(app())
      .get('/api/v1/calendar/people')
      .query({ q: 'ابراهيم' })
      .set(auth(a.token));
    expect(people.body.items.map((p: { fullNameAr: string }) => p.fullNameAr)).toEqual(['إبراهيم العتيبي']);
  });

  it('new meeting notifies participants, training uses its own type, a time change marks it rescheduled and notifies; links resolve', async () => {
    const { mgr, a, b } = await setup();
    const task = await request(app())
      .post('/api/v1/tasks')
      .set(auth(mgr.token))
      .send({ title: 'تحضير العرض', assigneeId: a.userId });
    const bad = await request(app())
      .post('/api/v1/calendar/events')
      .set(auth(mgr.token))
      .send({
        title: 'اجتماع',
        startAt: '2026-11-10T07:00:00Z',
        endAt: '2026-11-10T08:00:00Z',
        participantIds: [a.userId],
        link: { type: 'task', id: 'TSK-0000-99999' },
      });
    expect(bad.status).toBe(400);
    const ev = await request(app())
      .post('/api/v1/calendar/events')
      .set(auth(mgr.token))
      .send({
        title: 'اجتماع الفريق',
        startAt: '2026-11-10T07:00:00Z',
        endAt: '2026-11-10T08:00:00Z',
        participantIds: [a.userId, b.userId],
        link: { type: 'task', id: task.body.number },
      });
    expect(ev.status).toBe(201);
    expect(ev.body.link.id).toBe(task.body._id);
    expect(
      await Notification.countDocuments({ type: 'meeting.created', userId: { $in: [a.userId, b.userId] } }),
    ).toBe(2);
    const training = await request(app())
      .post('/api/v1/calendar/events')
      .set(auth(mgr.token))
      .send({
        title: 'دورة السلامة',
        type: 'training',
        startAt: '2026-11-12T07:00:00Z',
        endAt: '2026-11-12T10:00:00Z',
        participantIds: [a.userId],
      });
    expect(training.status).toBe(201);
    expect(await Notification.countDocuments({ type: 'training.added', userId: a.userId })).toBe(1);
    // Reschedule: status flips, reminders reset, participants told.
    const moved = await request(app())
      .patch(`/api/v1/calendar/events/${ev.body._id}`)
      .set(auth(mgr.token))
      .send({ startAt: '2026-11-11T07:00:00Z', endAt: '2026-11-11T08:00:00Z' });
    expect(moved.body.status).toBe('rescheduled');
    expect(await Notification.countDocuments({ titleAr: 'أُعيدت جدولة موعد', userId: a.userId })).toBe(1);
    // A participant may mark the outcome; a stranger cannot touch it.
    expect(
      (
        await request(app())
          .patch(`/api/v1/calendar/events/${ev.body._id}`)
          .set(auth(a.token))
          .send({ status: 'done', outcome: 'تم' })
      ).status,
    ).toBe(200);
    await makeUser('x@eayni.local');
    expect(
      (
        await request(app())
          .patch(`/api/v1/calendar/events/${ev.body._id}`)
          .set(auth(await loginAs('x@eayni.local')))
          .send({ status: 'cancelled' })
      ).status,
    ).toBe(404);
    // Reminder fires once per offset before start.
    await CalendarEvent.updateOne(
      { _id: training.body._id },
      { $set: { startAt: new Date(Date.now() + 30 * 60_000), endAt: new Date(Date.now() + 90 * 60_000) } },
    );
    expect(await runEventReminders()).toBe(1);
    expect(await runEventReminders()).toBe(0);
  });
});
