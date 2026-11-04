import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { auth, loginAs, makeDepartment, makeUser, testApp } from '../../test/helpers';
import { Notification } from '../notifications/model';
import { runTaskReminders } from './jobs';
import { Task } from './model';
import { setSetting } from '../settings/service';
import { SYSTEM_ACTOR } from '../http/context';

const app = () => testApp();

describe('tasks [EP §10]', () => {
  it('assigns a numbered task, notifies the assignee, scopes visibility, and reminds before/after due', async () => {
    await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
    const d = await makeDepartment('ops');
    await makeUser(
      'mgr@eayni.local',
      [{ role: 'employee' }, { role: 'department_manager', departmentId: String(d._id) }],
      { departmentId: d._id },
    );
    const emp = await makeUser('emp@eayni.local', [{ role: 'employee' }], { departmentId: d._id });
    await makeUser('other@eayni.local');
    const mgr = await loginAs('mgr@eayni.local');
    const created = await request(app())
      .post('/api/v1/tasks')
      .set(auth(mgr))
      .send({
        title: 'جرد الحاويات',
        assigneeId: String(emp._id),
        dueAt: new Date(Date.now() + 12 * 3_600_000),
      });
    expect(created.status).toBe(201);
    expect(created.body.number).toMatch(/^TSK-\d{4}-00001$/);
    expect(await Notification.countDocuments({ userId: emp._id, type: 'task.assigned' })).toBe(1);

    const empT = await loginAs('emp@eayni.local');
    expect((await request(app()).get('/api/v1/tasks').set(auth(empT))).body.total).toBe(1);
    const otherT = await loginAs('other@eayni.local');
    expect((await request(app()).get('/api/v1/tasks').set(auth(otherT))).body.total).toBe(0);
    // Assignee may update status but not reassign.
    expect(
      (
        await request(app())
          .patch(`/api/v1/tasks/${created.body._id}`)
          .set(auth(empT))
          .send({ assigneeId: String(emp._id) })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app())
          .patch(`/api/v1/tasks/${created.body._id}`)
          .set(auth(empT))
          .send({ status: 'in_progress', progressPercent: 40 })
      ).status,
    ).toBe(200);

    expect(await runTaskReminders()).toEqual({ dueSoon: 1, overdue: 0 });
    await Task.updateMany({}, { $set: { dueAt: new Date(Date.now() - 1000) } });
    expect(await runTaskReminders()).toEqual({ dueSoon: 0, overdue: 1 });
    expect((await Task.findById(created.body._id))?.status).toBe('late');
    expect(await runTaskReminders()).toEqual({ dueSoon: 0, overdue: 0 });
  });
});
