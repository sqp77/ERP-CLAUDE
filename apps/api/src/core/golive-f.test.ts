import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { resetEnvCache } from '../config';
import { S3StorageAdapter } from './files/storage';
import { registerJob, runJobs } from './jobs/registry';
import { memoiseUntilSuccess } from '../bootstrap';
import { ensureCoreRoles } from './rbac/service';
import { Role } from './rbac/model';
import { assertTransactionSupport } from '../db';
import { activateAccount, auth, loginAs, makeDepartment, makeUser, testApp } from '../test/helpers';
import { setSetting } from './settings/service';
import { SYSTEM_ACTOR } from './http/context';
import { User } from './auth/model';
import { Task } from './tasks/model';
import { runUnassignedTaskReminders } from './tasks/jobs';
import { Notification } from './notifications/model';
import { Holiday } from './dates/model';

const app = () => testApp();

describe('go-live review F — deploy blockers and schedules', () => {
  it('F1: presigned PUT URLs carry no checksum parameters', async () => {
    process.env.S3_BUCKET = 'eayni-test-files';
    process.env.AWS_REGION = 'me-south-1';
    resetEnvCache();
    try {
      const s3 = new S3StorageAdapter({
        credentials: {
          accessKeyId: 'AKIATESTTESTTESTTEST',
          secretAccessKey: 'secretsecretsecretsecretsecretsecret',
        },
      });
      const target = await s3.createUploadUrl('2026/11/test.pdf', 'application/pdf', 11);
      const params = [...new URL(target.url).searchParams.keys()].map((k) => k.toLowerCase());
      expect(params.some((k) => k.startsWith('x-amz-checksum'))).toBe(false);
      expect(params).not.toContain('x-amz-sdk-checksum-algorithm');
      expect(params).toContain('x-amz-signature');
    } finally {
      delete process.env.S3_BUCKET;
      delete process.env.AWS_REGION;
      resetEnvCache();
    }
  });

  it('F3: jobs run by cadence; the queue reminder goes once per Riyadh business day and skips Friday and holidays', async () => {
    const seen: string[] = [];
    registerJob('test.frequent', async () => void seen.push('f'), 'frequent');
    registerJob('test.daily', async () => void seen.push('d'), 'daily');
    await runJobs(new Date(), ['test.frequent', 'test.daily'], 'frequent');
    expect(seen).toEqual(['f']);
    await runJobs(new Date(), ['test.frequent', 'test.daily'], 'daily');
    expect(seen).toEqual(['f', 'd']);

    await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
    const ops = await makeDepartment('ops', 'التشغيل');
    const mgr = await makeUser(
      'mgr@eayni.local',
      [{ role: 'employee' }, { role: 'department_manager', departmentId: String(ops._id) }],
      { departmentId: ops._id },
    );
    const t = await loginAs('mgr@eayni.local');
    const q = await request(app()).post('/api/v1/tasks').set(auth(t)).send({ title: 'مهمة في القائمة' });
    expect(q.status).toBe(201);
    await Task.collection.updateOne(
      { _id: new (await import('mongoose')).default.Types.ObjectId(q.body._id as string) },
      { $set: { createdAt: new Date('2026-11-01T06:00:00Z') } },
    );
    // Sunday 2026-11-08 09:00 Riyadh: reminder once; a second run the same day sends nothing.
    const sunday = new Date('2026-11-08T06:00:00Z');
    expect(await runUnassignedTaskReminders(sunday)).toBe(1);
    expect(await runUnassignedTaskReminders(new Date('2026-11-08T12:00:00Z'))).toBe(0);
    // Monday: again. Friday: never. A holiday: never.
    expect(await runUnassignedTaskReminders(new Date('2026-11-09T06:00:00Z'))).toBe(1);
    expect(await runUnassignedTaskReminders(new Date('2026-11-13T06:00:00Z'))).toBe(0);
    await Holiday.create({ date: '2026-11-10', nameAr: 'عطلة اختبار' });
    expect(await runUnassignedTaskReminders(new Date('2026-11-10T06:00:00Z'))).toBe(0);
    expect(await Notification.countDocuments({ userId: mgr._id, type: 'task.unassigned_reminder' })).toBe(2);
    void activateAccount;
    void User;
  });

  it('F4: a failed baseline is retried on the next request; concurrent ensureCoreRoles never collides', async () => {
    let calls = 0;
    const once = memoiseUntilSuccess(async () => {
      calls++;
      if (calls === 1) throw new Error('db hiccup');
    });
    await expect(once()).rejects.toThrow('db hiccup');
    await expect(once()).resolves.toBeUndefined();
    await expect(once()).resolves.toBeUndefined();
    expect(calls).toBe(2);
    await Role.deleteMany({});
    await Promise.all([ensureCoreRoles(), ensureCoreRoles(), ensureCoreRoles()]);
    expect(await Role.countDocuments({ code: 'employee' })).toBe(1);
    const emp = await Role.findOne({ code: 'employee' }).lean();
    expect((emp!.grants as { resource: string }[]).some((g) => g.resource === 'tasks')).toBe(true);
  });

  it('F5: production refuses to start without transaction support', () => {
    expect(() => assertTransactionSupport(true, false)).toThrow(/transactions/);
    expect(() => assertTransactionSupport(true, true)).not.toThrow();
    expect(() => assertTransactionSupport(false, false)).not.toThrow();
  });
});
