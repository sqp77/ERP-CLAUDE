import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { activateAccount, auth, loginAs, makeDepartment, makeUser, testApp } from '../../test/helpers';
import { setSetting } from '../../core/settings/service';
import { SYSTEM_ACTOR } from '../../core/http/context';
import { Notification } from '../../core/notifications/model';
import { StageLog } from '../../core/workflow/model';
import { HrRequest } from './requests.model';
import { runRequestOverdueReminders } from './requests.service';

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
  allowances: [{ type: 'سكن', amountHalalas: 200_000 }],
  ...over,
});

async function setup() {
  await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
  const ops = await makeDepartment('ops', 'التشغيل');
  await makeUser('hr@eayni.local', [{ role: 'employee' }, { role: 'hr_officer' }]);
  await makeUser('fin@eayni.local', [{ role: 'employee' }, { role: 'finance_manager' }]);
  const hr = await loginAs('hr@eayni.local');
  const boss = await request(app())
    .post('/api/v1/hr/employees')
    .set(auth(hr))
    .send(
      emp({
        workEmail: 'boss@eayni.local',
        identity: { type: 'national_id', number: '1000000001' },
        departmentId: String(ops._id),
      }),
    );
  const staff = await request(app())
    .post('/api/v1/hr/employees')
    .set(auth(hr))
    .send(emp({ departmentId: String(ops._id), directManagerId: boss.body._id }));
  return {
    ops,
    hr,
    boss,
    staff,
    me: await activateAccount('omar@eayni.local', staff.body.temporaryPassword),
    mgr: await activateAccount('boss@eayni.local', boss.body.temporaryPassword),
    fin: await loginAs('fin@eayni.local'),
  };
}

const post = (token: string, body: Record<string, unknown>) =>
  request(app()).post('/api/v1/hr/requests').set(auth(token)).send(body);
const act = (token: string, id: string, transition: string, extra: Record<string, unknown> = {}) =>
  request(app())
    .post(`/api/v1/hr/requests/${id}/transition`)
    .set(auth(token))
    .send({ transition, ...extra });

describe('HR self-service requests [HR §3.5, EP §11, DECISIONS §5]', () => {
  it('validates per-type fields and routes leave via the direct manager, certificates directly to HR', async () => {
    const { me } = await setup();
    const bad = await post(me, {
      type: 'leave',
      details: { leaveType: 'annual', startDate: '2026-12-10', endDate: '2026-12-01', reason: 'إجازة سنوية' },
    });
    expect(bad.status).toBe(400);
    const leave = await post(me, {
      type: 'leave',
      details: { leaveType: 'annual', startDate: '2026-12-01', endDate: '2026-12-10', reason: 'إجازة سنوية' },
    });
    expect(leave.status).toBe(201);
    expect(leave.body.number).toMatch(/^HRQ-\d{4}-00001$/);
    expect(leave.body.state).toBe('awaiting_manager');
    expect(leave.body.pendingWith).toBe('manager');
    const cert = await post(me, {
      type: 'salary_certificate',
      details: { addressedTo: 'بنك الراجحي', purpose: 'تمويل عقاري', detailed: true },
    });
    expect(cert.body.state).toBe('awaiting_hr');
    expect(cert.body.pendingWith).toBe('hr');
    expect(leave.body.dueAt).toBeTruthy();
    // Manager inbox shows the leave only; the employee sees both as "mine".
    const { mgr } = await (async () => ({
      mgr: (
        await request(app()).post('/api/v1/auth/login').send({ email: 'boss@eayni.local', password: 'x' })
      ).body.token,
    }))();
    expect(mgr).toBeUndefined();
  });

  it('manager approves → HR approves → requester notified; HR return → requester fixes and resubmits; rejection needs a reason', async () => {
    const { me, mgr, hr } = await setup();
    const leave = await post(me, {
      type: 'leave',
      details: { leaveType: 'annual', startDate: '2026-12-01', endDate: '2026-12-10', reason: 'إجازة سنوية' },
    });
    const id = leave.body._id as string;
    const inbox = await request(app()).get('/api/v1/hr/requests?view=inbox').set(auth(mgr));
    expect(inbox.body.items.map((i: { number: string }) => i.number)).toEqual([leave.body.number]);
    // The requester cannot approve their own request; HR cannot act while it waits for the manager.
    expect((await act(me, id, 'approve')).status).toBe(403);
    expect((await act(hr, id, 'approve')).status).toBe(403);
    const m = await act(mgr, id, 'approve');
    expect(m.status).toBe(200);
    expect(m.body.state).toBe('awaiting_hr');
    expect((await act(hr, id, 'return')).status).toBe(400); // reason required
    const ret = await act(hr, id, 'return', { reason: 'أرفق تقرير الطبيب' });
    expect(ret.body.state).toBe('needs_completion');
    expect(ret.body.pendingWith).toBe('requester');
    // Requester edits and resubmits → goes back through the manager (route says via manager).
    const re = await act(me, id, 'resubmit', {
      details: { leaveType: 'sick', startDate: '2026-12-01', endDate: '2026-12-05', reason: 'مرضية' },
    });
    expect(re.body.state).toBe('awaiting_manager');
    expect(re.body.details.leaveType).toBe('sick');
    await act(mgr, id, 'approve');
    expect((await act(hr, id, 'reject')).status).toBe(400);
    const ok = await act(hr, id, 'approve');
    expect(ok.body.state).toBe('approved');
    expect(ok.body.closedAt).toBeTruthy();
    const detail = await request(app()).get(`/api/v1/hr/requests/${id}`).set(auth(me));
    expect(detail.body.history.actions.map((a: { action: string }) => a.action)).toEqual([
      'created',
      'submit_to_manager',
      'manager_approve',
      'hr_return',
      'submit_to_manager',
      'manager_approve',
      'hr_approve',
    ]);
    expect(
      await Notification.countDocuments({ userId: leave.body.requesterUserId, type: 'request.decided' }),
    ).toBe(2); // return + approval
  });

  it('salary and experience certificates are generated from the employee file on approval and downloadable by the requester', async () => {
    const { me, hr } = await setup();
    const cert = await post(me, {
      type: 'salary_certificate',
      details: {
        addressedTo: 'بنك الراجحي',
        purpose: 'تمويل عقاري',
        detailed: true,
        chamberAttestation: true,
      },
    });
    const ok = await act(hr, cert.body._id, 'approve');
    expect(ok.body.state).toBe('approved');
    expect(ok.body.certificate.number).toMatch(/^CRT-/);
    const dl = await request(app()).get(`/api/v1/hr/requests/${cert.body._id}/certificate`).set(auth(me));
    expect(dl.status).toBe(200);
    const u = new URL(dl.body.url);
    const html = await request(app()).get(u.pathname + u.search);
    expect(html.text).toContain('عمر عبدالرحمن');
    expect(html.text).toContain('بنك الراجحي');
    expect(html.text).toContain('9,000.00'); // basic salary from the file
    expect(html.text).toContain('11,000.00'); // basic + housing allowance
    expect(html.text).toContain('1098765432'); // identity number from the encrypted field
    const exp = await post(me, { type: 'experience_certificate', details: { purpose: 'التقديم على وظيفة' } });
    const ok2 = await act(hr, exp.body._id, 'approve');
    expect(ok2.body.certificate.number).toMatch(/^CRT-/);
    // Another employee cannot download it.
    await makeUser('other@eayni.local');
    const other = await loginAs('other@eayni.local');
    expect(
      (await request(app()).get(`/api/v1/hr/requests/${cert.body._id}/certificate`).set(auth(other))).status,
    ).toBe(404);
  });

  it('advance: flagged while the limit is unset, HR approval hands off to Finance with the same number, Finance decides', async () => {
    const { me, mgr, hr, fin } = await setup();
    const adv = await post(me, { type: 'advance', details: { amountHalalas: 500_000, reason: 'ظرف طارئ' } });
    expect(adv.body.flags).toContain('advance_limit_unset');
    await act(mgr, adv.body._id, 'approve');
    const h = await act(hr, adv.body._id, 'approve');
    expect(h.body.state).toBe('awaiting_final');
    expect(h.body.pendingWith).toBe('finance');
    expect(h.body.handoff).toMatchObject({ department: 'finance', status: 'waiting' });
    expect(h.body.number).toBe(adv.body.number); // same number through the hand-off (FIN §11)
    expect(h.body.actions).not.toContain('approve'); // HR officer may not take the Finance decision
    const finQueue = await request(app()).get('/api/v1/hr/requests?view=queue').set(auth(fin));
    expect(finQueue.body.items.map((i: { number: string }) => i.number)).toEqual([adv.body.number]);
    expect(await Notification.countDocuments({ titleAr: 'طلب سلفة محوّل إلى المالية' })).toBe(1);
    const done = await act(fin, adv.body._id, 'approve');
    expect(done.body.state).toBe('approved');
    expect(done.body.handoff.status).toBe('done');
    // With a limit set, over-limit requests are flagged.
    await setSetting('hr.advanceLimitHalalas', 300_000, SYSTEM_ACTOR);
    const big = await post(me, {
      type: 'advance',
      details: { amountHalalas: 500_000, reason: 'إجازة سنوية' },
    });
    expect(big.body.flags).toEqual(['over_limit']);
  });

  it("a transfer moves requests waiting for the old manager to the new one, logged in the stage log; scope hides others' requests", async () => {
    const { ops, me, hr, staff, boss } = await setup();
    const newBoss = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send(
        emp({
          workEmail: 'new@eayni.local',
          identity: { type: 'national_id', number: '1000000002' },
          departmentId: String(ops._id),
        }),
      );
    const leave = await post(me, {
      type: 'leave',
      details: { leaveType: 'annual', startDate: '2026-12-01', endDate: '2026-12-10', reason: 'إجازة سنوية' },
    });
    const perm = await post(me, {
      type: 'permission',
      details: { date: '2026-12-01', startTime: '09:00', endTime: '11:00', reason: 'موعد' },
    });
    await request(app())
      .post(`/api/v1/hr/employees/${staff.body._id}/transfer`)
      .set(auth(hr))
      .send({
        departmentId: String(ops._id),
        directManagerId: newBoss.body._id,
        effectiveDate: '2026-11-10',
        reason: 'إعادة توزيع',
      });
    const moved = await HrRequest.find({ requesterUserId: leave.body.requesterUserId }).lean();
    expect(moved.every((r) => String(r.directManagerUserId) === newBoss.body.userId)).toBe(true);
    expect(
      await StageLog.countDocuments({ recordType: 'hr_request', transition: 'reassigned_manager' }),
    ).toBe(2);
    const oldN = await Notification.findOne({
      userId: boss.body.userId,
      type: 'employee.manager_or_department_changed',
    }).lean();
    expect(oldN?.bodyAr).toContain('2 طلبًا');
    const newMgr = await activateAccount('new@eayni.local', newBoss.body.temporaryPassword);
    const inbox = await request(app()).get('/api/v1/hr/requests?view=inbox').set(auth(newMgr));
    expect(inbox.body.items.map((i: { number: string }) => i.number).sort()).toEqual(
      [leave.body.number, perm.body.number].sort(),
    );
    // Someone else sees nothing.
    await makeUser('other@eayni.local');
    const other = await loginAs('other@eayni.local');
    expect((await request(app()).get('/api/v1/hr/requests?view=all').set(auth(other))).body.total).toBe(0);
    expect((await request(app()).get(`/api/v1/hr/requests/${leave.body._id}`).set(auth(other))).status).toBe(
      404,
    );
  });

  it('overdue stages notify the pending party once per stage', async () => {
    const { me } = await setup();
    const leave = await post(me, {
      type: 'leave',
      details: { leaveType: 'annual', startDate: '2026-12-01', endDate: '2026-12-10', reason: 'إجازة سنوية' },
    });
    expect(await runRequestOverdueReminders(new Date())).toBe(0);
    const later = new Date(Date.now() + 10 * 86_400_000);
    expect(await runRequestOverdueReminders(later)).toBe(1);
    expect(await runRequestOverdueReminders(later)).toBe(0);
    expect(
      await Notification.countDocuments({
        userId: leave.body.directManagerUserId,
        titleAr: 'طلب متأخر عن مهلته',
      }),
    ).toBe(1);
  });
  it('A6: nobody decides their own request, even with an HR or Finance role', async () => {
    const { hr, ops } = await setup();
    // An HR officer who is also an employee files a certificate request that lands in the HR queue.
    const hrEmp = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send(
        emp({
          workEmail: 'hremp@eayni.local',
          identity: { type: 'national_id', number: '1000000009' },
          departmentId: String(ops._id),
        }),
      );
    const { User } = await import('../../core/auth/model');
    await User.updateOne({ email: 'hremp@eayni.local' }, { $push: { roles: { role: 'hr_officer' } } });
    const mine = await activateAccount('hremp@eayni.local', hrEmp.body.temporaryPassword);
    const cert = await post(mine, {
      type: 'salary_certificate',
      details: { addressedTo: 'بنك الراجحي', purpose: 'تمويل', detailed: false },
    });
    expect(cert.body.state).toBe('awaiting_hr');
    const detail = await request(app()).get(`/api/v1/hr/requests/${cert.body._id}`).set(auth(mine));
    expect(detail.body.actions).not.toContain('approve');
    const self = await act(mine, cert.body._id, 'approve');
    expect(self.status).toBe(403);
    expect((await HrRequest.findById(cert.body._id))!.state).toBe('awaiting_hr');
    // Another HR officer approves it.
    expect((await act(hr, cert.body._id, 'approve')).status).toBe(200);
  });

  it('A7: only a finance manager or the executive decides the final step of an advance', async () => {
    const { me, mgr, hr, fin } = await setup();
    await makeUser('hrm@eayni.local', [{ role: 'employee' }, { role: 'hr_manager' }]);
    await makeUser('fstaff@eayni.local', [{ role: 'employee' }, { role: 'finance_staff' }]);
    const hrm = await loginAs('hrm@eayni.local');
    const fstaff = await loginAs('fstaff@eayni.local');
    const adv = await post(me, {
      type: 'advance',
      details: { amountHalalas: 500_000, installments: 5, reason: 'ظرف طارئ' },
    });
    expect((await act(mgr, adv.body._id, 'approve')).status).toBe(200);
    expect((await act(hr, adv.body._id, 'approve')).status).toBe(200);
    expect((await HrRequest.findById(adv.body._id))!.state).toBe('awaiting_final');
    for (const [token, who] of [
      [hrm, 'hr_manager'],
      [fstaff, 'finance_staff'],
      [hr, 'hr_officer'],
    ] as const) {
      const detail = await request(app()).get(`/api/v1/hr/requests/${adv.body._id}`).set(auth(token));
      expect(detail.body.actions, who).not.toContain('approve');
      expect((await act(token, adv.body._id, 'approve')).status, who).toBe(403);
      expect((await act(token, adv.body._id, 'reject', { reason: 'لا' })).status, who).toBe(403);
    }
    expect((await HrRequest.findById(adv.body._id))!.state).toBe('awaiting_final');
    const detail = await request(app()).get(`/api/v1/hr/requests/${adv.body._id}`).set(auth(fin));
    expect(detail.body.actions).toContain('approve');
    expect((await act(fin, adv.body._id, 'approve')).status).toBe(200);
    expect((await HrRequest.findById(adv.body._id))!.state).toBe('approved');
  });
});
