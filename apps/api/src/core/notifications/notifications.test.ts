import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { auth, loginAs, makeUser, testApp } from '../../test/helpers';
import { notify } from './service';
import { Notification } from './model';
import { LogEmailAdapter, setEmailAdapter } from './channels';
import { setSetting } from '../settings/service';
import { SYSTEM_ACTOR } from '../http/context';

describe('notifications [EP §15, DECISIONS §9]', () => {
  it('writes in-app notifications; email stays off until enabled', async () => {
    const u = await makeUser('n@eayni.local');
    const log = new LogEmailAdapter();
    setEmailAdapter(log);
    await notify({
      userIds: [String(u._id)],
      type: 'task.assigned',
      bodyAr: 'مهمة',
      email: { subject: 's', text: 't' },
    });
    expect(log.sent).toHaveLength(0);
    const n = await Notification.findOne({ userId: u._id }).lean();
    expect(n?.titleAr).toBe('تم إسناد مهمة جديدة إليك');
    expect(n?.emailStatus).toBe('skipped');

    await setSetting('notifications.emailEnabled', true, SYSTEM_ACTOR);
    await notify({ userIds: [String(u._id)], type: 'task.overdue', email: { subject: 's2', text: 't2' } });
    expect(log.sent.map((m) => m.to)).toEqual(['n@eayni.local']);
    setEmailAdapter(undefined);
  });

  it('serves the center with unread counts and read marks', async () => {
    const u = await makeUser('m@eayni.local');
    await notify({ userIds: [String(u._id)], type: 'news.published' });
    await notify({ userIds: [String(u._id)], type: 'news.published' });
    const token = await loginAs('m@eayni.local');
    const list = await request(testApp()).get('/api/v1/notifications').set(auth(token));
    expect(list.body.unread).toBe(2);
    await request(testApp()).post(`/api/v1/notifications/${list.body.items[0]._id}/read`).set(auth(token));
    expect((await request(testApp()).get('/api/v1/notifications').set(auth(token))).body.unread).toBe(1);
    await request(testApp()).post('/api/v1/notifications/read-all').set(auth(token));
    expect((await request(testApp()).get('/api/v1/notifications').set(auth(token))).body.unread).toBe(0);
  });
});
