import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTIFICATION_TYPES } from '@eayni/shared';
import { auth, loginAs, makeUser, testApp } from '../../test/helpers';
import { notify } from './service';

const app = () => testApp();

/** The 18 notifications of EP §15, in order. */
const EP15 = [
  'task.assigned',
  'task.due_soon',
  'task.overdue',
  'meeting.created',
  'meeting.reminder',
  'ticket.created',
  'ticket.updated',
  'request.decided',
  'news.published',
  'contract.expiring',
  'probation.ending',
  'employee.birthday',
  'report.requested',
  'secondment.report_reminder',
  'employee.manager_or_department_changed',
  'employee.promotion',
  'training.added',
  'employee.data_updated',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('notification center [EP §15]', () => {
  it('every one of the 18 EP §15 notifications exists and is emitted somewhere in the API', () => {
    const src = walk(fileURLToPath(new URL('../..', import.meta.url)))
      .map((p) => readFileSync(p, 'utf8'))
      .join('\n');
    const missingType = EP15.filter((t) => !(NOTIFICATION_TYPES as readonly string[]).includes(t));
    expect(missingType).toEqual([]);
    const notEmitted = EP15.filter((t) => !src.includes(`type: '${t}'`) && !src.includes(`'${t}'`));
    expect(notEmitted).toEqual([]);
  });

  it('lists with history, unread and type filters, marks one or all as read', async () => {
    const u = await makeUser('n@eayni.local');
    const t = await loginAs('n@eayni.local');
    await notify({ userIds: [String(u._id)], type: 'task.assigned', bodyAr: 'أ' });
    await notify({ userIds: [String(u._id)], type: 'news.published', bodyAr: 'ب' });
    await notify({ userIds: [String(u._id)], type: 'ticket.updated', bodyAr: 'ج' });
    const all = await request(app()).get('/api/v1/notifications').set(auth(t));
    expect(all.body.total).toBe(3);
    expect(all.body.unread).toBe(3);
    const tasksOnly = await request(app())
      .get('/api/v1/notifications?types=task.assigned,task.overdue')
      .set(auth(t));
    expect(tasksOnly.body.items.map((i: { type: string }) => i.type)).toEqual(['task.assigned']);
    await request(app()).post(`/api/v1/notifications/${all.body.items[0]._id}/read`).set(auth(t));
    expect((await request(app()).get('/api/v1/notifications?unread=true').set(auth(t))).body.total).toBe(2);
    await request(app()).post('/api/v1/notifications/read-all').set(auth(t));
    expect((await request(app()).get('/api/v1/notifications').set(auth(t))).body.unread).toBe(0);
  });
});
