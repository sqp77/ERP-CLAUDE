import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { activateAccount, auth, loginAs, makeDepartment, makeUser, testApp } from '../../test/helpers';
import { setSetting } from '../settings/service';
import { SYSTEM_ACTOR } from '../http/context';
import { Attachment } from './model';

const app = () => testApp();

async function upload(token: string, body: Record<string, unknown>) {
  const pre = await request(app())
    .post('/api/v1/files/presign')
    .set(auth(token))
    .send({ fileName: 'id.pdf', mimeType: 'application/pdf', size: 11, ...body });
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
  const dept = await makeDepartment('ops', 'التشغيل');
  await makeUser('hr@eayni.local', [{ role: 'employee' }, { role: 'hr_officer' }]);
  await makeUser('other@eayni.local');
  const hr = await loginAs('hr@eayni.local');
  const e = await request(app())
    .post('/api/v1/hr/employees')
    .set(auth(hr))
    .send({
      firstNameAr: 'سلمان',
      lastNameAr: 'العتيبي',
      gender: 'male',
      nationality: 'سعودي',
      workEmail: 'salman@eayni.local',
      identity: { type: 'national_id', number: '1055555555' },
      hireDate: '2024-01-10',
      departmentId: String(dept._id),
    });
  expect(e.status).toBe(201);
  const me = await activateAccount('salman@eayni.local', e.body.temporaryPassword);
  return { hr, me, other: await loginAs('other@eayni.local'), employeeId: e.body._id as string };
}

describe('security review A — file and comment access [EP §5.2, CS §6.6, golden rule 4]', () => {
  it('A3: an attachment is reachable only through its owner record; sensitivity is set by the server', async () => {
    const { hr, me, other, employeeId } = await setup();
    const id = await upload(hr, { ownerType: 'employee', ownerId: employeeId, sensitive: false });
    // Sensitivity is decided by the server when the document record is created (identity copies are sensitive).
    expect((await Attachment.findById(id))!.sensitive).toBe(false);
    const doc = await request(app())
      .post('/api/v1/documents')
      .set(auth(hr))
      .send({
        ownerType: 'employee',
        ownerId: employeeId,
        type: 'identity',
        titleAr: 'صورة الهوية',
        attachmentId: id,
        sensitive: false,
      });
    expect(doc.status).toBe(201);
    expect((await Attachment.findById(id))!.sensitive).toBe(true);
    // The employee sees their own file; an unrelated employee does not; HR does.
    expect((await request(app()).get(`/api/v1/files/${id}/url`).set(auth(me))).status).toBe(200);
    expect((await request(app()).get(`/api/v1/files/${id}`).set(auth(other))).status).toBe(403);
    expect((await request(app()).get(`/api/v1/files/${id}/url`).set(auth(other))).status).toBe(403);
    expect((await request(app()).delete(`/api/v1/files/${id}`).set(auth(other))).status).toBe(403);
    expect((await request(app()).get(`/api/v1/files/${id}/url`).set(auth(hr))).status).toBe(200);
  });

  it('A3: an attachment with no owner record is private to its uploader until a record claims it', async () => {
    const { hr, me, other } = await setup();
    const id = await upload(me, {});
    expect((await request(app()).get(`/api/v1/files/${id}/url`).set(auth(me))).status).toBe(200);
    expect((await request(app()).get(`/api/v1/files/${id}/url`).set(auth(other))).status).toBe(403);
    expect((await request(app()).get(`/api/v1/files/${id}/url`).set(auth(hr))).status).toBe(403);
    // Attaching it to an HR request makes it visible to those who may see the request.
    const req = await request(app())
      .post('/api/v1/hr/requests')
      .set(auth(me))
      .send({
        type: 'salary_certificate',
        details: { addressedTo: 'بنك الراجحي', purpose: 'تمويل', detailed: false },
        attachmentIds: [id],
      });
    expect(req.status).toBe(201);
    expect((await request(app()).get(`/api/v1/files/${id}/url`).set(auth(hr))).status).toBe(200);
    expect((await request(app()).get(`/api/v1/files/${id}/url`).set(auth(other))).status).toBe(403);
  });

  it('A4: comments require access to the record they hang on', async () => {
    const { me, other, employeeId } = await setup();
    const denied = await request(app())
      .post('/api/v1/comments')
      .set(auth(other))
      .send({ recordType: 'employee', recordId: employeeId, body: 'تعليق' });
    expect(denied.status).toBe(403);
    const ok = await request(app())
      .post('/api/v1/comments')
      .set(auth(me))
      .send({ recordType: 'employee', recordId: employeeId, body: 'تعليق' });
    expect(ok.status).toBe(201);
    const list = await request(app())
      .get('/api/v1/comments')
      .query({ recordType: 'employee', recordId: employeeId })
      .set(auth(other));
    expect(list.status).toBe(403);
  });
});
