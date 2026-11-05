import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { activateAccount, auth, loginAs, makeDepartment, makeUser, testApp } from '../../test/helpers';
import { setSetting } from '../../core/settings/service';
import { SYSTEM_ACTOR } from '../../core/http/context';
import { StageLog } from '../../core/workflow/model';
import { Outbox } from '../../core/outbox/model';
import { Attachment } from '../../core/files/model';
import { HrRequest, HrRequestAction } from './requests.model';
import { ProfileChangeRequest } from './profileChanges.model';
import { Employee } from './model';

const app = () => testApp();

const emp = (over: Record<string, unknown>) => ({
  firstNameAr: 'عمر',
  lastNameAr: 'عبدالرحمن',
  gender: 'male',
  nationality: 'سعودي',
  workEmail: 'omar@eayni.local',
  identity: { type: 'national_id', number: '1098765432' },
  hireDate: '2024-01-10',
  basicSalaryHalalas: 900_000,
  ...over,
});

async function setup() {
  await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
  const ops = await makeDepartment('ops', 'التشغيل');
  await makeUser('hr@eayni.local', [{ role: 'employee' }, { role: 'hr_officer' }]);
  await makeUser('hr2@eayni.local', [{ role: 'employee' }, { role: 'hr_officer' }]);
  await makeUser('fin@eayni.local', [{ role: 'employee' }, { role: 'finance_manager' }]);
  await makeUser('fin2@eayni.local', [{ role: 'employee' }, { role: 'finance_manager' }]);
  const hr = await loginAs('hr@eayni.local');
  const staff = await request(app())
    .post('/api/v1/hr/employees')
    .set(auth(hr))
    .send(emp({ departmentId: String(ops._id) }));
  return {
    hr,
    hr2: await loginAs('hr2@eayni.local'),
    fin: await loginAs('fin@eayni.local'),
    fin2: await loginAs('fin2@eayni.local'),
    me: await activateAccount('omar@eayni.local', staff.body.temporaryPassword),
    employeeId: staff.body._id as string,
  };
}

const act = (token: string, id: string, transition: string, extra: Record<string, unknown> = {}) =>
  request(app())
    .post(`/api/v1/hr/requests/${id}/transition`)
    .set(auth(token))
    .send({ transition, ...extra });

async function uploadProof(token: string) {
  const pre = await request(app())
    .post('/api/v1/files/presign')
    .set(auth(token))
    .send({ fileName: 'iban.pdf', mimeType: 'application/pdf', size: 11 });
  const u = new URL(pre.body.upload.url);
  await request(app())
    .put(u.pathname + u.search)
    .set('Content-Type', 'application/pdf')
    .send(Buffer.from('%PDF-1.4 ok'));
  await request(app()).post(`/api/v1/files/${pre.body.attachmentId}/complete`).set(auth(token));
  return pre.body.attachmentId as string;
}

describe('data integrity review B — concurrency and transactions [FIN §12, golden rule 3]', () => {
  it('B9: two concurrent approvals of one request → one 200 and one 409; one stage log, one certificate', async () => {
    const { hr, hr2, me } = await setup();
    const cert = await request(app())
      .post('/api/v1/hr/requests')
      .set(auth(me))
      .send({
        type: 'salary_certificate',
        details: { addressedTo: 'بنك الراجحي', purpose: 'تمويل', detailed: false },
      });
    expect(cert.body.state).toBe('awaiting_hr');
    const [a, b] = await Promise.all([act(hr, cert.body._id, 'approve'), act(hr2, cert.body._id, 'approve')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const after = await HrRequest.findById(cert.body._id).lean();
    expect(after!.state).toBe('approved');
    expect(await StageLog.countDocuments({ recordId: cert.body._id, transition: 'hr_approve' })).toBe(1);
    expect(await HrRequestAction.countDocuments({ requestId: cert.body._id, action: 'hr_approve' })).toBe(1);
    expect(await Attachment.countDocuments({ ownerType: 'hr_request', ownerId: cert.body._id })).toBe(1);
    expect(await Outbox.countDocuments({ type: 'hr.request.approved', aggregateId: cert.body._id })).toBe(1);
  });

  it('B9: two concurrent decisions on one bank-change request → one wins, the other gets 409', async () => {
    const { fin, fin2, me, employeeId } = await setup();
    const proof = await uploadProof(me);
    const pcr = await request(app())
      .post('/api/v1/hr/me/bank-change')
      .set(auth(me))
      .send({ bankName: 'الراجحي', iban: 'SA0380000000608010167519', proofAttachmentId: proof });
    expect(pcr.status).toBe(201);
    const [a, b] = await Promise.all([
      request(app()).post(`/api/v1/hr/profile-changes/${pcr.body._id}/approve`).set(auth(fin)).send({}),
      request(app())
        .post(`/api/v1/hr/profile-changes/${pcr.body._id}/reject`)
        .set(auth(fin2))
        .send({ reason: 'مستند غير واضح' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const stored = await ProfileChangeRequest.findById(pcr.body._id).lean();
    const employee = await Employee.findById(employeeId).lean();
    if (a.status === 200) {
      expect(stored!.state).toBe('approved');
      expect(employee!.bank?.ibanLast4).toBe('7519');
    } else {
      expect(stored!.state).toBe('rejected');
      expect(employee!.bank?.ibanLast4).toBeUndefined();
    }
  });

  it('B10: a transition is one transaction — a failure after the record update rolls everything back', async () => {
    const { hr, me } = await setup();
    const cert = await request(app())
      .post('/api/v1/hr/requests')
      .set(auth(me))
      .send({
        type: 'salary_certificate',
        details: { addressedTo: 'بنك الراجحي', purpose: 'تمويل', detailed: false },
      });
    const spy = vi.spyOn(HrRequestAction, 'create').mockRejectedValueOnce(new Error('disk full'));
    const res = await act(hr, cert.body._id, 'approve');
    spy.mockRestore();
    expect(res.status).toBe(500);
    const after = await HrRequest.findById(cert.body._id).lean();
    expect(after!.state).toBe('awaiting_hr');
    expect(after!.certificate?.number).toBeUndefined();
    expect(await StageLog.countDocuments({ recordId: cert.body._id, transition: 'hr_approve' })).toBe(0);
    expect(await Outbox.countDocuments({ type: 'hr.request.approved', aggregateId: cert.body._id })).toBe(0);
    // And it still works afterwards.
    expect((await act(hr, cert.body._id, 'approve')).status).toBe(200);
  });
});
