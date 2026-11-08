import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { activateAccount, auth, loginAs, makeDepartment, makeUser, testApp } from '../../test/helpers';
import { setSetting } from '../../core/settings/service';
import { SYSTEM_ACTOR } from '../../core/http/context';
import { User } from '../../core/auth/model';

const app = () => testApp();

async function upload(token: string, body: Record<string, unknown> = {}) {
  const pre = await request(app())
    .post('/api/v1/files/presign')
    .set(auth(token))
    .send({ fileName: 'f.pdf', mimeType: 'application/pdf', size: 11, ...body });
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
  await makeUser('hr@eayni.local', [{ role: 'employee' }, { role: 'hr_officer' }]);
  await makeUser('fin@eayni.local', [{ role: 'employee' }, { role: 'finance_manager' }]);
  await makeUser('exec@eayni.local', [{ role: 'employee' }, { role: 'executive' }]);
  const hr = await loginAs('hr@eayni.local');
  let n = 0;
  const mk = async (email: string, first: string, directManagerId?: string) => {
    const r = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send({
        firstNameAr: first,
        lastNameAr: 'الدوسري',
        gender: 'male',
        nationality: 'سعودي',
        religion: 'مسلم',
        birthDate: '1990-05-01',
        workEmail: email,
        identity: { type: 'national_id', number: `10${String(30000000 + ++n).padStart(8, '0')}` },
        hireDate: '2024-01-10',
        departmentId: String(ops._id),
        directManagerId,
        basicSalaryHalalas: 900_000,
        allowances: [{ type: 'سكن', amountHalalas: 200_000 }],
        bank: { bankName: 'الراجحي', iban: 'SA0380000000608010167519' },
      });
    expect(r.status).toBe(201);
    return {
      employeeId: r.body._id as string,
      userId: r.body.userId as string,
      token: await activateAccount(email, r.body.temporaryPassword),
    };
  };
  const deptMgr = await mk('dm@eayni.local', 'ماجد');
  await User.updateOne(
    { _id: deptMgr.userId },
    { $push: { roles: { role: 'department_manager', departmentId: ops._id } } },
  );
  const lead = await mk('lead@eayni.local', 'ليث', deptMgr.employeeId);
  const emp = await mk('emp@eayni.local', 'عمر', lead.employeeId);
  return {
    ops,
    hr,
    fin: await loginAs('fin@eayni.local'),
    exec: await loginAs('exec@eayni.local'),
    deptMgr: { ...deptMgr, token: await loginAs('dm@eayni.local') },
    lead,
    emp,
  };
}

describe('go-live review E — access control', () => {
  it('E1: sensitive fields are default-deny — team lead and department manager never see them, HR sees all, Finance sees pay and bank only', async () => {
    const { hr, fin, exec, deptMgr, lead, emp } = await setup();
    await request(app())
      .post(`/api/v1/hr/employees/${emp.employeeId}/promote`)
      .set(auth(hr))
      .send({
        positionId:
          (await request(app()).get('/api/v1/org/positions?all=true').set(auth(hr))).body.items[0]?._id ??
          undefined,
        grade: 'G5',
        basicSalaryHalalas: 1_000_000,
        effectiveDate: '2026-11-01',
        reason: 'ترقية',
      })
      .catch(() => undefined);
    const forLead = await request(app()).get(`/api/v1/hr/employees/${emp.employeeId}`).set(auth(lead.token));
    expect(forLead.status).toBe(200);
    for (const k of ['basicSalaryHalalas', 'allowances', 'religion', 'birthDate'])
      expect(forLead.body[k]).toBeUndefined();
    expect(forLead.body.identity.number).toBeUndefined();
    expect(forLead.body.bank?.iban).toBeUndefined();
    const forDm = await request(app()).get(`/api/v1/hr/employees/${emp.employeeId}`).set(auth(deptMgr.token));
    expect(forDm.body.basicSalaryHalalas).toBeUndefined();
    expect(forDm.body.identity.number).toBeUndefined();
    const forExec = await request(app()).get(`/api/v1/hr/employees/${emp.employeeId}`).set(auth(exec));
    expect(forExec.body.identity.number).toBeUndefined();
    const forHr = await request(app()).get(`/api/v1/hr/employees/${emp.employeeId}`).set(auth(hr));
    expect(forHr.body.identity.number).toMatch(/^10/);
    expect(forHr.body.bank.iban).toBe('SA0380000000608010167519');
    expect(forHr.body.basicSalaryHalalas).toBe(900_000);
    const forFin = await request(app()).get(`/api/v1/hr/employees/${emp.employeeId}`).set(auth(fin));
    expect(forFin.body.bank.iban).toBe('SA0380000000608010167519');
    expect(forFin.body.basicSalaryHalalas).toBe(900_000);
    expect(forFin.body.identity.number).toBeUndefined();
    expect(forFin.body.religion).toBeUndefined();
    // History: pay inside promotion events follows the same rule.
    const hist = await request(app())
      .get(`/api/v1/hr/employees/${emp.employeeId}/history`)
      .set(auth(lead.token));
    const promo = hist.body.items.find((h: { type: string }) => h.type === 'promotion');
    if (promo) {
      expect(promo.to.basicSalaryHalalas).toBeUndefined();
      expect(promo.from.basicSalaryHalalas).toBeUndefined();
    }
    const histHr = await request(app()).get(`/api/v1/hr/employees/${emp.employeeId}/history`).set(auth(hr));
    expect(histHr.status).toBe(200);
    // The employee sees their own data in full.
    const self = await request(app()).get('/api/v1/hr/employees/me').set(auth(emp.token));
    expect(self.body.bank.iban).toBe('SA0380000000608010167519');
  });

  it('E2: sensitive documents list as type + expiry only and their files are refused; the lead reads only the secondment report', async () => {
    const { hr, deptMgr, lead, emp } = await setup();
    const idScan = await upload(hr, { ownerType: 'employee', ownerId: emp.employeeId });
    const doc = await request(app())
      .post('/api/v1/documents')
      .set(auth(hr))
      .send({
        ownerType: 'employee',
        ownerId: emp.employeeId,
        type: 'identity',
        titleAr: 'صورة الهوية',
        attachmentId: idScan,
        expiryDate: '2027-01-01',
      });
    expect(doc.status).toBe(201);
    const cert = await upload(hr, { ownerType: 'employee', ownerId: emp.employeeId });
    await request(app())
      .post('/api/v1/documents')
      .set(auth(hr))
      .send({
        ownerType: 'employee',
        ownerId: emp.employeeId,
        type: 'professional_certificate',
        titleAr: 'شهادة',
        attachmentId: cert,
      });
    const listLead = await request(app())
      .get(`/api/v1/documents?ownerType=employee&ownerId=${emp.employeeId}`)
      .set(auth(lead.token));
    expect(listLead.status).toBe(200);
    const idRow = listLead.body.items.find((d: { type: string }) => d.type === 'identity');
    expect(idRow.expiryDate).toBeTruthy();
    expect(idRow.attachmentId).toBeUndefined();
    expect(idRow.restricted).toBe(true);
    const listDm = await request(app())
      .get(`/api/v1/documents?ownerType=employee&ownerId=${emp.employeeId}`)
      .set(auth(deptMgr.token));
    expect(
      listDm.body.items.find((d: { type: string }) => d.type === 'identity').attachmentId,
    ).toBeUndefined();
    expect((await request(app()).get(`/api/v1/files/${idScan}/url`).set(auth(lead.token))).status).toBe(403);
    expect((await request(app()).get(`/api/v1/files/${idScan}/url`).set(auth(deptMgr.token))).status).toBe(
      403,
    );
    expect((await request(app()).get(`/api/v1/files/${idScan}/url`).set(auth(emp.token))).status).toBe(200);
    expect((await request(app()).get(`/api/v1/files/${idScan}/url`).set(auth(hr))).status).toBe(200);
    // Non-sensitive document: the department manager may open it; the lead (org chart only) may not.
    expect((await request(app()).get(`/api/v1/files/${cert}/url`).set(auth(deptMgr.token))).status).toBe(200);
    expect((await request(app()).get(`/api/v1/files/${cert}/url`).set(auth(lead.token))).status).toBe(403);
    // Secondment report: the lead reads it.
    await request(app())
      .post(`/api/v1/hr/employees/${emp.employeeId}/status`)
      .set(auth(hr))
      .send({
        status: 'seconded',
        effectiveDate: '2026-11-01',
        reason: 'انتداب',
        secondment: { destination: 'جدة', startDate: '2026-11-01', endDate: '2026-11-03' },
      });
    const report = await upload(emp.token);
    await request(app())
      .post('/api/v1/hr/me/secondment-report')
      .set(auth(emp.token))
      .send({ attachmentId: report });
    expect((await request(app()).get(`/api/v1/files/${report}/url`).set(auth(lead.token))).status).toBe(200);
    // Contracts are sensitive files too.
    const contractFile = await upload(hr, { ownerType: 'employee', ownerId: emp.employeeId });
    const c = await request(app())
      .post(`/api/v1/hr/employees/${emp.employeeId}/contracts`)
      .set(auth(hr))
      .send({ type: 'open_ended', startDate: '2026-01-01', attachmentId: contractFile });
    expect(c.status).toBe(201);
    expect(
      (await request(app()).get(`/api/v1/files/${contractFile}/url`).set(auth(deptMgr.token))).status,
    ).toBe(403);
    expect((await request(app()).get(`/api/v1/files/${contractFile}/url`).set(auth(emp.token))).status).toBe(
      200,
    );
  });

  it('E3: only the requester and HR download a certificate; managers, executives and Finance get 403 but still see the request', async () => {
    const { hr, fin, exec, deptMgr, lead, emp } = await setup();
    const req1 = await request(app())
      .post('/api/v1/hr/requests')
      .set(auth(emp.token))
      .send({
        type: 'salary_certificate',
        details: { addressedTo: 'بنك', purpose: 'تمويل', detailed: true },
      });
    const approved = await request(app())
      .post(`/api/v1/hr/requests/${req1.body._id}/transition`)
      .set(auth(hr))
      .send({ transition: 'approve' });
    expect(approved.body.state).toBe('approved');
    const url = `/api/v1/hr/requests/${req1.body._id}/certificate`;
    expect((await request(app()).get(url).set(auth(emp.token))).status).toBe(200);
    expect((await request(app()).get(url).set(auth(hr))).status).toBe(200);
    for (const token of [deptMgr.token, lead.token, exec, fin]) {
      const r = await request(app()).get(url).set(auth(token));
      expect([403, 404]).toContain(r.status);
    }
    expect(
      (await request(app()).get(`/api/v1/hr/requests/${req1.body._id}`).set(auth(deptMgr.token))).status,
    ).toBe(200);
    expect((await request(app()).get(`/api/v1/hr/requests/${req1.body._id}`).set(auth(fin))).status).toBe(
      200,
    );
  });
});
