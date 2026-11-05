import { describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  activateAccount,
  auth,
  loginAs,
  makeDepartment,
  makeUser,
  PASSWORD,
  testApp,
} from '../../test/helpers';
import { setSetting } from '../../core/settings/service';
import { SYSTEM_ACTOR } from '../../core/http/context';
import { AuditLog } from '../../core/audit/model';
import { Notification } from '../../core/notifications/model';
import { Employee } from './model';
import { runBirthdayGreetings } from './jobs';

const app = () => testApp();

async function setup() {
  await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
  const ops = await makeDepartment('ops', 'التشغيل');
  await makeUser('hr@eayni.local', [{ role: 'employee' }, { role: 'hr_officer' }]);
  await makeUser('fin@eayni.local', [{ role: 'employee' }, { role: 'finance_staff' }]);
  const hr = await loginAs('hr@eayni.local');
  const created = await request(app())
    .post('/api/v1/hr/employees')
    .set(auth(hr))
    .send({
      firstNameAr: 'عمر',
      lastNameAr: 'عبدالرحمن',
      gender: 'male',
      nationality: 'سعودي',
      birthDate: '1990-05-20',
      identity: { type: 'national_id', number: '1098765432' },
      workEmail: 'omar@eayni.local',
      departmentId: String(ops._id),
      hireDate: '2026-01-10',
      basicSalaryHalalas: 900_000,
      bank: { bankName: 'الراجحي', iban: 'SA0380000000608010167519' },
    });
  const me = await activateAccount('omar@eayni.local', created.body.temporaryPassword);
  return { ops, hr, me, employeeId: created.body._id as string, userId: created.body.userId as string };
}

async function uploadProof(token: string, mime = 'application/pdf') {
  const pre = await request(app())
    .post('/api/v1/files/presign')
    .set(auth(token))
    .send({ fileName: 'proof.pdf', mimeType: mime, size: 4, sensitive: true });
  const u = new URL(pre.body.upload.url);
  await request(app())
    .put(u.pathname + u.search)
    .set('Content-Type', mime)
    .send(Buffer.from('%PDF'));
  await request(app()).post(`/api/v1/files/${pre.body.attachmentId}/complete`).set(auth(token));
  return pre.body.attachmentId as string;
}

describe('portal profile [EP §5–8, DECISIONS §10]', () => {
  it('serves the own file with labels and contract; contact info saves directly, is logged and HR is notified', async () => {
    const { hr, me } = await setup();
    const profile = await request(app()).get('/api/v1/hr/me').set(auth(me));
    expect(profile.status).toBe(200);
    expect(profile.body.labels.department).toBe('التشغيل');
    expect(profile.body.bank.iban).toBe('SA0380000000608010167519');
    const upd = await request(app())
      .patch('/api/v1/hr/me/contact')
      .set(auth(me))
      .send({ mobile: '+966501234567', address: { city: 'الدمام', postalCode: '32241' } });
    expect(upd.status).toBe(200);
    expect(upd.body.mobile).toBe('+966501234567');
    expect(await AuditLog.countDocuments({ resource: 'hr.employees', action: 'update' })).toBe(1);
    const hrUser = (await request(app()).get('/api/v1/auth/me').set(auth(hr))).body.user.id;
    expect(await Notification.countDocuments({ userId: hrUser, type: 'employee.data_updated' })).toBe(1);
    // Official data cannot be changed from the portal.
    const official = await request(app())
      .patch('/api/v1/hr/me/contact')
      .set(auth(me))
      .send({ firstNameAr: 'آخر', basicSalaryHalalas: 1 });
    expect(official.status).toBe(200);
    expect((await Employee.findOne({ workEmail: 'omar@eayni.local' }))?.firstNameAr).toBe('عمر');
  });

  it('bank change needs a proof, waits for Finance, and only Finance can approve (not HR, not the requester)', async () => {
    const { hr, me } = await setup();
    const noProof = await request(app())
      .post('/api/v1/hr/me/bank-change')
      .set(auth(me))
      .send({ bankName: 'الأهلي', iban: 'SA4420000001234567891234' });
    expect(noProof.status).toBe(400);
    const proof = await uploadProof(me);
    const req1 = await request(app())
      .post('/api/v1/hr/me/bank-change')
      .set(auth(me))
      .send({ bankName: 'الأهلي', iban: 'SA4420000001234567891234', proofAttachmentId: proof });
    expect(req1.status).toBe(201);
    expect(req1.body.number).toMatch(/^PCR-/);
    const dup = await request(app())
      .post('/api/v1/hr/me/bank-change')
      .set(auth(me))
      .send({ bankName: 'الأهلي', iban: 'SA4420000001234567891234', proofAttachmentId: proof });
    expect(dup.status).toBe(409);
    // Bank unchanged while pending.
    expect((await request(app()).get('/api/v1/hr/me').set(auth(me))).body.bank.iban).toBe(
      'SA0380000000608010167519',
    );
    expect((await request(app()).get('/api/v1/hr/me').set(auth(me))).body.pendingChanges).toHaveLength(1);
    // HR sees the queue but cannot approve; the requester cannot approve either.
    const queue = await request(app()).get('/api/v1/hr/profile-changes').set(auth(hr));
    expect(queue.body.items).toHaveLength(1);
    expect(
      (
        await request(app())
          .post(`/api/v1/hr/profile-changes/${req1.body._id}/approve`)
          .set(auth(hr))
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app())
          .post(`/api/v1/hr/profile-changes/${req1.body._id}/approve`)
          .set(auth(me))
          .send({})
      ).status,
    ).toBe(403);
    const fin = await loginAs('fin@eayni.local');
    const ok = await request(app())
      .post(`/api/v1/hr/profile-changes/${req1.body._id}/approve`)
      .set(auth(fin))
      .send({});
    expect(ok.status).toBe(200);
    expect(ok.body.state).toBe('approved');
    const after = await request(app()).get('/api/v1/hr/me').set(auth(me));
    expect(after.body.bank.iban).toBe('SA4420000001234567891234');
    expect(after.body.bank.bankName).toBe('الأهلي');
    expect(await Notification.countDocuments({ type: 'request.decided' })).toBe(1);
    expect(
      await AuditLog.countDocuments({ action: 'approve', resource: 'hr.employees', sensitive: true }),
    ).toBe(1);
    // Rejection requires a reason.
    const proof2 = await uploadProof(me);
    const req2 = await request(app())
      .post('/api/v1/hr/me/bank-change')
      .set(auth(me))
      .send({ bankName: 'الرياض', iban: 'SA5520000001234567891234', proofAttachmentId: proof2 });
    expect(
      (
        await request(app())
          .post(`/api/v1/hr/profile-changes/${req2.body._id}/reject`)
          .set(auth(fin))
          .send({})
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app())
          .post(`/api/v1/hr/profile-changes/${req2.body._id}/reject`)
          .set(auth(fin))
          .send({ reason: 'المستند غير واضح' })
      ).status,
    ).toBe(200);
    expect((await request(app()).get('/api/v1/hr/me').set(auth(me))).body.bank.iban).toBe(
      'SA4420000001234567891234',
    );
  });

  it('photo must be an image uploaded by the employee; secondment report notifies the direct manager [EP §5.1, §5.3]', async () => {
    const { hr, me, employeeId, ops } = await setup();
    const pdf = await uploadProof(me);
    expect(
      (await request(app()).post('/api/v1/hr/me/photo').set(auth(me)).send({ attachmentId: pdf })).status,
    ).toBe(400);
    const img = await uploadProof(me, 'image/png');
    expect(
      (await request(app()).post('/api/v1/hr/me/photo').set(auth(me)).send({ attachmentId: img })).status,
    ).toBe(200);
    // No secondment yet → 400.
    expect(
      (await request(app()).post('/api/v1/hr/me/secondment-report').set(auth(me)).send({ attachmentId: pdf }))
        .status,
    ).toBe(400);
    const boss = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send({
        firstNameAr: 'خالد',
        lastNameAr: 'المطيري',
        gender: 'male',
        nationality: 'سعودي',
        identity: { type: 'national_id', number: '1000000099' },
        workEmail: 'boss@eayni.local',
        departmentId: String(ops._id),
        hireDate: '2020-01-01',
      });
    await request(app())
      .post(`/api/v1/hr/employees/${employeeId}/manager`)
      .set(auth(hr))
      .send({ directManagerId: boss.body._id, effectiveDate: '2026-11-01', reason: 'تعيين' });
    await request(app())
      .post(`/api/v1/hr/employees/${employeeId}/status`)
      .set(auth(hr))
      .send({
        status: 'seconded',
        effectiveDate: '2026-11-01',
        reason: 'انتداب',
        secondment: { destination: 'فرع الرياض', startDate: '2026-11-01', endDate: '2026-11-30' },
      });
    const rep = await request(app())
      .post('/api/v1/hr/me/secondment-report')
      .set(auth(me))
      .send({ attachmentId: pdf, notes: 'تم' });
    expect(rep.status).toBe(200);
    const n = await Notification.findOne({ userId: boss.body.userId, titleAr: 'تم رفع تقرير انتداب' }).lean();
    expect(n).toBeTruthy();
  });

  it('birthday greeting fires once per year on the Riyadh date [EP §5.1, §15.12]', async () => {
    const { userId } = await setup();
    const birthday = new Date('2026-05-20T06:00:00Z');
    expect(await runBirthdayGreetings(new Date('2026-05-19T06:00:00Z'))).toBe(0);
    expect(await runBirthdayGreetings(birthday)).toBe(1);
    expect(await runBirthdayGreetings(birthday)).toBe(0);
    expect(await runBirthdayGreetings(new Date('2027-05-20T06:00:00Z'))).toBe(1);
    expect(await Notification.countDocuments({ userId, type: 'employee.birthday' })).toBe(2);
    expect(PASSWORD).toBeTruthy();
  });
});

describe('secondment report after the mission [EP §5.3, EP §15.14, DECISIONS §12 review]', () => {
  it('allows the upload after the end date, reminds on day+1 and again 3 business days later, and HR sees missing reports', async () => {
    const { setSetting } = await import('../../core/settings/service');
    const { SYSTEM_ACTOR } = await import('../../core/http/context');
    const { runSecondmentReportReminders } = await import('./jobs');
    await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
    const ops = await makeDepartment('ops2', 'التشغيل');
    await makeUser('hr2@eayni.local', [{ role: 'employee' }, { role: 'hr_officer' }]);
    const hr = await loginAs('hr2@eayni.local');
    const created = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send({
        firstNameAr: 'دانة',
        lastNameAr: 'الراشد',
        gender: 'female',
        nationality: 'سعودي',
        identity: { type: 'national_id', number: '1098765499' },
        workEmail: 'dana@eayni.local',
        departmentId: String(ops._id),
        hireDate: '2025-01-10',
      });
    const id = created.body._id as string;
    const me = await activateAccount('dana@eayni.local', created.body.temporaryPassword);
    // Secondment Sunday 2026-11-01 → Wednesday 2026-11-04, then back to work.
    await request(app())
      .post(`/api/v1/hr/employees/${id}/status`)
      .set(auth(hr))
      .send({
        status: 'seconded',
        effectiveDate: '2026-11-01',
        reason: 'انتداب',
        secondment: {
          destination: 'فرع الرياض',
          startDate: '2026-11-01T05:00:00Z',
          endDate: '2026-11-04T14:00:00Z',
        },
      });
    await request(app())
      .post(`/api/v1/hr/employees/${id}/status`)
      .set(auth(hr))
      .send({ status: 'active', effectiveDate: '2026-11-05', reason: 'عودة' });
    // Listed as missing for HR.
    const missing = await request(app()).get('/api/v1/hr/secondments?missingReport=true').set(auth(hr));
    expect(missing.body.items.map((i: { fullNameAr: string }) => i.fullNameAr)).toEqual(['دانة الراشد']);
    // Reminders: none before day+1; first on Thu 2026-11-05 14:00; second 3 business days later → Tue 2026-11-10 (Fri/Sat skipped).
    expect(await runSecondmentReportReminders(new Date('2026-11-05T10:00:00Z'))).toBe(0);
    expect(await runSecondmentReportReminders(new Date('2026-11-05T15:00:00Z'))).toBe(1);
    expect(await runSecondmentReportReminders(new Date('2026-11-09T15:00:00Z'))).toBe(0);
    expect(await runSecondmentReportReminders(new Date('2026-11-10T15:00:00Z'))).toBe(1);
    expect(await runSecondmentReportReminders(new Date('2026-11-20T15:00:00Z'))).toBe(0);
    expect(await Notification.countDocuments({ type: 'secondment.report_reminder' })).toBe(2);
    // Upload after the mission ended (status is back to active) is allowed and clears the "missing" list.
    const pdf = await uploadProof(me);
    expect(
      (
        await request(app())
          .post('/api/v1/hr/me/secondment-report')
          .set(auth(me))
          .send({ attachmentId: pdf, notes: 'تم' })
      ).status,
    ).toBe(200);
    expect(
      (await request(app()).get('/api/v1/hr/secondments?missingReport=true').set(auth(hr))).body.items,
    ).toHaveLength(0);
    expect(
      (await request(app()).get('/api/v1/hr/secondments').set(auth(hr))).body.items[0].reportedAt,
    ).toBeTruthy();
    expect(await runSecondmentReportReminders(new Date('2026-12-01T15:00:00Z'))).toBe(0);
    // A second secondment keeps the first in history.
    await request(app())
      .post(`/api/v1/hr/employees/${id}/status`)
      .set(auth(hr))
      .send({
        status: 'seconded',
        effectiveDate: '2026-12-01',
        reason: 'انتداب',
        secondment: { destination: 'فرع جدة', startDate: '2026-12-01', endDate: '2026-12-10' },
      });
    const profile = await request(app()).get('/api/v1/hr/me').set(auth(me));
    expect(profile.body.secondmentHistory).toHaveLength(1);
    expect(profile.body.secondment.destination).toBe('فرع جدة');
  });
});

describe('C18 — the manager can act on the secondment-report notification', () => {
  it('links the manager to the team page, which lists the report, and lets the manager download it', async () => {
    const { setSetting } = await import('../../core/settings/service');
    const { SYSTEM_ACTOR } = await import('../../core/http/context');
    await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
    const ops = await makeDepartment('ops3', 'التشغيل');
    await makeUser('hr3@eayni.local', [{ role: 'employee' }, { role: 'hr_officer' }]);
    const hr = await loginAs('hr3@eayni.local');
    const mk = (over: Record<string, unknown>) =>
      request(app())
        .post('/api/v1/hr/employees')
        .set(auth(hr))
        .send({
          firstNameAr: 'ندى',
          lastNameAr: 'الحربي',
          gender: 'female',
          nationality: 'سعودي',
          hireDate: '2025-01-10',
          departmentId: String(ops._id),
          ...over,
        });
    const boss = await mk({
      workEmail: 'boss3@eayni.local',
      identity: { type: 'national_id', number: '1000000031' },
    });
    const staff = await mk({
      workEmail: 'nada@eayni.local',
      identity: { type: 'national_id', number: '1000000032' },
      directManagerId: boss.body._id,
    });
    const mgr = await activateAccount('boss3@eayni.local', boss.body.temporaryPassword);
    const me = await activateAccount('nada@eayni.local', staff.body.temporaryPassword);
    await request(app())
      .post(`/api/v1/hr/employees/${staff.body._id}/status`)
      .set(auth(hr))
      .send({
        status: 'seconded',
        effectiveDate: '2026-11-01',
        reason: 'انتداب',
        secondment: { destination: 'فرع الدمام', startDate: '2026-11-01', endDate: '2026-11-03' },
      });
    const pdf = await uploadProof(me);
    await request(app()).post('/api/v1/hr/me/secondment-report').set(auth(me)).send({ attachmentId: pdf });
    const n = await Notification.findOne({ userId: boss.body.userId, titleAr: 'تم رفع تقرير انتداب' }).lean();
    expect(n?.link).toBe('/manager/team');
    const team = await request(app()).get('/api/v1/hr/team').set(auth(mgr));
    expect(team.status).toBe(200);
    expect(team.body.items).toHaveLength(1);
    expect(team.body.items[0]).toMatchObject({
      fullNameAr: 'ندى الحربي',
      secondment: { destination: 'فرع الدمام', reportAttachmentId: pdf },
    });
    // The manager may read the report (team access), an unrelated employee may not.
    expect((await request(app()).get(`/api/v1/files/${pdf}/url`).set(auth(mgr))).status).toBe(200);
    await makeUser('nobody@eayni.local');
    const nobody = await loginAs('nobody@eayni.local');
    expect((await request(app()).get(`/api/v1/files/${pdf}/url`).set(auth(nobody))).status).toBe(403);
    expect((await request(app()).get('/api/v1/hr/team').set(auth(nobody))).body.items).toEqual([]);
  });
});
