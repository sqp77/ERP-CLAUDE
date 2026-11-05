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
import { Position } from '../../core/org/model';
import { Contract, Employee } from './model';
import { runAccountDeactivation, runContractAlerts, runProbationAlerts } from './jobs';
import { registerManagerChangeHandler } from './service';

const app = () => testApp();

async function setup() {
  await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
  const hrDept = await makeDepartment('hr', 'الموارد البشرية');
  const ops = await makeDepartment('ops', 'التشغيل');
  await makeUser('hr@eayni.local', [{ role: 'employee' }, { role: 'hr_officer' }], {
    departmentId: hrDept._id,
  });
  const hr = await loginAs('hr@eayni.local');
  return { hrDept, ops, hr };
}

const base = (over: Record<string, unknown> = {}) => ({
  firstNameAr: 'سعود',
  lastNameAr: 'القحطاني',
  gender: 'male',
  nationality: 'سعودي',
  identity: { type: 'national_id', number: '1098765432', expiryDate: '2030-01-01' },
  workEmail: 'saud@eayni.local',
  hireDate: '2026-01-10',
  basicSalaryHalalas: 1_200_000,
  bank: { bankName: 'الراجحي', iban: 'SA0380000000608010167519' },
  ...over,
});

describe('HR employee file [HR §3.1, §3.3]', () => {
  it('HR creates an employee with a generated number and a portal account; the employee sees own sensitive data, colleagues do not', async () => {
    const { ops, hr } = await setup();
    const created = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send(base({ departmentId: String(ops._id) }));
    expect(created.status).toBe(201);
    expect(created.body.employeeNumber).toMatch(/^EMP-\d{4}-00001$/);
    expect(created.body.temporaryPassword).toBeTruthy();
    expect(created.body.identity.number).toBe('1098765432'); // HR may see it
    const stored = await Employee.findById(created.body._id).lean();
    expect(stored?.identity?.numberEnc).not.toContain('1098765432'); // encrypted at rest
    expect(stored?.bank?.ibanEnc).not.toContain('0167519');

    // The employee logs in with the temporary password and reads own file.
    const meToken = await activateAccount('saud@eayni.local', created.body.temporaryPassword);
    const own = await request(app()).get('/api/v1/hr/employees/me').set(auth(meToken));
    expect(own.status).toBe(200);
    expect(own.body.bank.iban).toBe('SA0380000000608010167519');
    expect(own.body.basicSalaryHalalas).toBe(1_200_000);

    // A department manager of the same department sees the record but not salary / IBAN / identity number.
    await makeUser(
      'mgr@eayni.local',
      [{ role: 'employee' }, { role: 'department_manager', departmentId: String(ops._id) }],
      { departmentId: ops._id },
    );
    const mgr = await loginAs('mgr@eayni.local');
    const seen = await request(app()).get(`/api/v1/hr/employees/${created.body._id}`).set(auth(mgr));
    expect(seen.status).toBe(200);
    expect(seen.body.basicSalaryHalalas).toBeUndefined();
    expect(seen.body.identity.number).toBeUndefined();
    expect(seen.body.identity.numberMasked).toBe('••••••5432');
    expect(seen.body.bank.iban).toBeUndefined();
    expect(seen.body.bank.ibanMasked).toMatch(/7519$/);

    // An unrelated employee cannot see the record at all.
    await makeUser('other@eayni.local');
    const other = await loginAs('other@eayni.local');
    expect(
      (await request(app()).get(`/api/v1/hr/employees/${created.body._id}`).set(auth(other))).status,
    ).toBe(404);
    expect((await request(app()).get('/api/v1/hr/employees').set(auth(other))).body.total).toBe(0);
    // HR viewing sensitive data of someone else is audited.
    expect(
      await AuditLog.countDocuments({ resource: 'hr.employees', action: 'view', sensitive: true }),
    ).toBeGreaterThan(0);
  });

  it('transfer, promotion and manager change append history and notify the employee [HR §3.1.8–3.1.10, EP §15.15–16]', async () => {
    const { hrDept, ops, hr } = await setup();
    const pos = await Position.create({ code: 'sup', titleAr: 'مشرف', active: true });
    const boss = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send(
        base({
          departmentId: String(ops._id),
          workEmail: 'boss@eayni.local',
          identity: { type: 'national_id', number: '1000000001' },
        }),
      );
    const emp = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send(base({ departmentId: String(ops._id), directManagerId: boss.body._id }));
    const id = emp.body._id as string;
    const tr = await request(app())
      .post(`/api/v1/hr/employees/${id}/transfer`)
      .set(auth(hr))
      .send({
        departmentId: String(hrDept._id),
        directManagerId: boss.body._id,
        effectiveDate: '2026-11-01',
        reason: 'إعادة هيكلة',
      });
    expect(tr.status).toBe(200);
    expect(tr.body.departmentId).toBe(String(hrDept._id));
    const pr = await request(app())
      .post(`/api/v1/hr/employees/${id}/promote`)
      .set(auth(hr))
      .send({
        positionId: String(pos._id),
        grade: 'G5',
        basicSalaryHalalas: 1_500_000,
        effectiveDate: '2026-11-01',
        reason: 'ترقية سنوية',
      });
    expect(pr.status).toBe(200);
    expect(pr.body.basicSalaryHalalas).toBe(1_500_000);
    const self = await request(app())
      .post(`/api/v1/hr/employees/${id}/manager`)
      .set(auth(hr))
      .send({ directManagerId: id, effectiveDate: '2026-11-01', reason: 'x' });
    expect(self.status).toBe(400);
    const history = await request(app()).get(`/api/v1/hr/employees/${id}/history`).set(auth(hr));
    expect(history.body.items.map((h: { type: string }) => h.type)).toEqual([
      'promotion',
      'transfer',
      'created',
    ]);
    expect(
      await Notification.countDocuments({
        userId: emp.body.userId,
        type: 'employee.manager_or_department_changed',
      }),
    ).toBe(1);
    expect(await Notification.countDocuments({ userId: emp.body.userId, type: 'employee.promotion' })).toBe(
      1,
    );
    // Team scope: the boss sees the direct report through "team" (via the user-level resolver).
    const reports = await request(app()).get(`/api/v1/hr/employees/${boss.body._id}/reports`).set(auth(hr));
    expect(reports.body.items).toHaveLength(1);
  });

  it('end of service keeps access until the last working day; the daily job disables the account after it [EP §3.10, DECISIONS §11.3]', async () => {
    const { ops, hr } = await setup();
    const emp = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send(base({ departmentId: String(ops._id) }));
    const token = await activateAccount('saud@eayni.local', emp.body.temporaryPassword);
    const lastDay = new Date(Date.now() + 3 * 86_400_000);
    await request(app())
      .post(`/api/v1/hr/employees/${emp.body._id}/status`)
      .set(auth(hr))
      .send({ status: 'resigned', effectiveDate: lastDay.toISOString(), reason: 'استقالة' });
    // Still working: normal access.
    expect((await request(app()).get('/api/v1/auth/me').set(auth(token))).status).toBe(200);
    expect(await runAccountDeactivation(new Date())).toBe(0);
    expect(await runAccountDeactivation(lastDay)).toBe(0); // the last day itself is still a working day
    expect(await runAccountDeactivation(new Date(lastDay.getTime() + 86_400_000))).toBe(1);
    expect((await request(app()).get('/api/v1/auth/me').set(auth(token))).status).toBe(401);
    const login = await request(app())
      .post('/api/v1/auth/login')
      .send({ email: 'saud@eayni.local', password: PASSWORD });
    expect(login.body.error.code).toBe('account_disabled');
    expect(await runAccountDeactivation(new Date(lastDay.getTime() + 2 * 86_400_000))).toBe(0); // idempotent
  });

  it('transfer names the new manager; pending items move through the registered handler and both managers are notified [DECISIONS §11.4]', async () => {
    const { hrDept, ops, hr } = await setup();
    const oldBoss = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send(
        base({
          departmentId: String(ops._id),
          workEmail: 'old@eayni.local',
          identity: { type: 'national_id', number: '1000000011' },
        }),
      );
    const newBoss = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send(
        base({
          departmentId: String(hrDept._id),
          workEmail: 'new@eayni.local',
          identity: { type: 'national_id', number: '1000000012' },
        }),
      );
    const emp = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send(base({ departmentId: String(ops._id), directManagerId: oldBoss.body._id }));
    const calls: { from?: string; to?: string }[] = [];
    const off = registerManagerChangeHandler(async ({ fromManagerUserId, toManagerUserId }) => {
      calls.push({ from: fromManagerUserId, to: toManagerUserId });
      return 2; // pretend two pending requests moved
    });
    try {
      const missing = await request(app())
        .post(`/api/v1/hr/employees/${emp.body._id}/transfer`)
        .set(auth(hr))
        .send({ departmentId: String(hrDept._id), effectiveDate: '2026-11-01', reason: 'x' });
      expect(missing.status).toBe(400); // new manager is mandatory
      const tr = await request(app())
        .post(`/api/v1/hr/employees/${emp.body._id}/transfer`)
        .set(auth(hr))
        .send({
          departmentId: String(hrDept._id),
          directManagerId: newBoss.body._id,
          effectiveDate: '2026-11-01',
          reason: 'نقل',
        });
      expect(tr.status).toBe(200);
      expect(calls).toEqual([{ from: oldBoss.body.userId, to: newBoss.body.userId }]);
      const oldN = await Notification.findOne({
        userId: oldBoss.body.userId,
        type: 'employee.manager_or_department_changed',
      }).lean();
      const newN = await Notification.findOne({
        userId: newBoss.body.userId,
        type: 'employee.manager_or_department_changed',
      }).lean();
      expect(oldN?.bodyAr).toContain('2 طلبًا');
      expect(newN?.bodyAr).toContain('2 طلبًا');
    } finally {
      off();
    }
  });

  it('contracts: renewal supersedes the previous one; expiry and probation alerts fire once per offset [HR §3.9, EP §6]', async () => {
    const { ops, hr } = await setup();
    const emp = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send(base({ departmentId: String(ops._id) }));
    const id = emp.body._id as string;
    const in20 = new Date(Date.now() + 20 * 86_400_000).toISOString();
    const c1 = await request(app())
      .post(`/api/v1/hr/employees/${id}/contracts`)
      .set(auth(hr))
      .send({
        type: 'fixed_term',
        startDate: '2025-01-01',
        endDate: in20,
        probationEndDate: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      });
    expect(c1.status).toBe(201);
    expect(c1.body.number).toMatch(/^CNT-/);
    const r1 = await runContractAlerts();
    expect(r1.alerts).toBe(2); // offsets 90 and 30 already passed for a contract ending in 20 days
    expect((await runContractAlerts()).alerts).toBe(0);
    // Probation ends in 3 days: both offsets (30 and 7) are due at once, then nothing more.
    expect(await runProbationAlerts()).toBe(2);
    expect(await runProbationAlerts()).toBe(0);
    const c3 = await request(app())
      .post(`/api/v1/hr/employees/${id}/contracts`)
      .set(auth(hr))
      .send({
        type: 'fixed_term',
        startDate: '2026-01-01',
        probationEndDate: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      });
    expect(c3.status).toBe(201);
    expect(await runProbationAlerts()).toBe(1); // only the 30-day offset
    expect(await runProbationAlerts(new Date(Date.now() + 14 * 86_400_000))).toBe(1); // then the 7-day one
    expect(await Notification.countDocuments({ type: 'probation.ending' })).toBeGreaterThan(0);
    expect(await Notification.countDocuments({ type: 'contract.expiring' })).toBeGreaterThan(0);

    const c2 = await request(app())
      .post(`/api/v1/hr/employees/${id}/contracts`)
      .set(auth(hr))
      .send({ type: 'open_ended', startDate: in20 });
    expect(c2.body.version).toBe(3);
    expect((await Contract.findById(c1.body._id))?.status).toBe('expired');
    expect((await Contract.findById(c3.body._id))?.status).toBe('expired');
    const list = await request(app()).get(`/api/v1/hr/employees/${id}/contracts`).set(auth(hr));
    expect(list.body.items).toHaveLength(3);
    // The employee can read own contracts but cannot add one.
    const token = await activateAccount('saud@eayni.local', emp.body.temporaryPassword);
    expect((await request(app()).get(`/api/v1/hr/employees/${id}/contracts`).set(auth(token))).status).toBe(
      200,
    );
    expect(
      (
        await request(app())
          .post(`/api/v1/hr/employees/${id}/contracts`)
          .set(auth(token))
          .send({ type: 'open_ended', startDate: in20 })
      ).status,
    ).toBe(403);
  });

  it('custody items are issued and returned; documents of an employee are reachable only within scope', async () => {
    const { ops, hr } = await setup();
    const emp = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send(base({ departmentId: String(ops._id) }));
    const id = emp.body._id as string;
    const c = await request(app())
      .post(`/api/v1/hr/employees/${id}/custody`)
      .set(auth(hr))
      .send({ itemName: 'لابتوب Dell', assetTag: 'IT-0042', issuedAt: '2026-02-01' });
    expect(c.status).toBe(201);
    const ret = await request(app())
      .post(`/api/v1/hr/employees/${id}/custody/${c.body._id}/return`)
      .set(auth(hr))
      .send({ returnedAt: '2026-11-01', condition: 'سليم' });
    expect(ret.body.returnedAt).toBeTruthy();
    await makeUser('other2@eayni.local');
    const other = await loginAs('other2@eayni.local', PASSWORD);
    expect(
      (await request(app()).get(`/api/v1/documents?ownerType=employee&ownerId=${id}`).set(auth(other)))
        .status,
    ).toBe(403);
    expect(
      (await request(app()).get(`/api/v1/documents?ownerType=employee&ownerId=${id}`).set(auth(hr))).status,
    ).toBe(200);
  });
});
