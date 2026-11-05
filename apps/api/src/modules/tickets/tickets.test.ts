import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { activateAccount, auth, loginAs, makeDepartment, makeUser, testApp } from '../../test/helpers';
import { setSetting } from '../../core/settings/service';
import { SYSTEM_ACTOR } from '../../core/http/context';
import { Notification } from '../../core/notifications/model';
import { StageLog } from '../../core/workflow/model';
import { User } from '../../core/auth/model';
import { Ticket, TicketAction } from './model';
import { runTicketFollowUps } from './jobs';

const app = () => testApp();

async function setup() {
  await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
  const it = await makeDepartment('it', 'التقنية');
  const ops = await makeDepartment('ops', 'التشغيل');
  await makeDepartment('finance', 'المالية');
  await makeDepartment('procurement', 'المشتريات');
  await makeUser('hr@eayni.local', [{ role: 'employee' }, { role: 'hr_officer' }]);
  const hr = await loginAs('hr@eayni.local');
  let n = 0;
  const mk = async (email: string, departmentId: unknown, directManagerId?: string) => {
    const r = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send({
        firstNameAr: 'موظف',
        lastNameAr: `التقني${++n}`,
        gender: 'male',
        nationality: 'سعودي',
        workEmail: email,
        identity: { type: 'national_id', number: `10${String(80000000 + n).padStart(8, '0')}` },
        hireDate: '2024-01-10',
        departmentId: String(departmentId),
        directManagerId,
      });
    expect(r.status).toBe(201);
    return {
      employeeId: r.body._id as string,
      userId: r.body.userId as string,
      token: await activateAccount(email, r.body.temporaryPassword),
    };
  };
  const itMgr = await mk('itmgr@eayni.local', it._id);
  await User.updateOne(
    { _id: itMgr.userId },
    { $push: { roles: { role: 'department_manager', departmentId: it._id } } },
  );
  const tech = await mk('tech@eayni.local', it._id, itMgr.employeeId);
  const opsMgr = await mk('opsmgr@eayni.local', ops._id);
  await User.updateOne(
    { _id: opsMgr.userId },
    { $push: { roles: { role: 'department_manager', departmentId: ops._id } } },
  );
  const emp = await mk('emp@eayni.local', ops._id, opsMgr.employeeId);
  const other = await mk('other@eayni.local', ops._id, opsMgr.employeeId);
  return {
    it,
    ops,
    itMgr: { ...itMgr, token: await loginAs('itmgr@eayni.local') },
    opsMgr: { ...opsMgr, token: await loginAs('opsmgr@eayni.local') },
    tech,
    emp,
    other,
  };
}

const open = (token: string, body: Record<string, unknown>) =>
  request(app())
    .post('/api/v1/tickets')
    .set(auth(token))
    .send({
      departmentCode: 'it',
      type: 'issue',
      subject: 'الطابعة لا تعمل',
      body: 'خطأ ورق محشور',
      priority: 'high',
      fields: { itType: 'device' },
      ...body,
    });
const act = (token: string, id: string, transition: string, extra: Record<string, unknown> = {}) =>
  request(app())
    .post(`/api/v1/tickets/${id}/transition`)
    .set(auth(token))
    .send({ transition, ...extra });

describe('internal tickets [EP §9, DECISIONS §8]', () => {
  it('targets hide Finance and Procurement until their modules exist; IT fields are required and validated', async () => {
    const { emp, itMgr } = await setup();
    const targets = await request(app()).get('/api/v1/tickets/targets').set(auth(emp.token));
    const codes = targets.body.items.map((t: { code: string }) => t.code);
    expect(codes).toContain('it');
    expect(codes).not.toContain('finance');
    expect(codes).not.toContain('procurement');
    expect(codes).not.toContain('executive');
    // Hidden for managers too (DECISIONS §8), even though the managers-only rule would allow them.
    const mgrCodes = (
      await request(app()).get('/api/v1/tickets/targets').set(auth(itMgr.token))
    ).body.items.map((t: { code: string }) => t.code);
    expect(mgrCodes).not.toContain('finance');
    const itTarget = targets.body.items.find((t: { code: string }) => t.code === 'it');
    expect(itTarget.config.fields[0].key).toBe('itType');
    expect(itTarget.config.priorityLabelsAr.urgent).toBe('عاجل');
    const missing = await open(emp.token, { fields: {} });
    expect(missing.status).toBe(400);
    expect(missing.body.error.details[0].path).toBe('fields.itType');
    expect((await open(emp.token, { fields: { itType: 'bogus' } })).status).toBe(400);
    expect((await open(emp.token, { departmentCode: 'finance' })).status).toBe(400);
  });

  it('opens in the department queue, notifies its managers, is visible to the requester and the department only', async () => {
    const { emp, other, itMgr, opsMgr } = await setup();
    const r = await open(emp.token, {});
    expect(r.status).toBe(201);
    expect(r.body.number).toMatch(/^TKT-\d{4}-00001$/);
    expect(r.body.state).toBe('new');
    expect(r.body.pendingWith).toBe('department');
    expect(r.body.workflowType).toBe('ticket_it');
    expect(r.body.requester.employeeNumber).toBeTruthy();
    expect(await Notification.countDocuments({ userId: itMgr.userId, type: 'ticket.created' })).toBe(1);
    expect(await Notification.countDocuments({ userId: opsMgr.userId, type: 'ticket.created' })).toBe(0);
    expect((await request(app()).get(`/api/v1/tickets/${r.body._id}`).set(auth(emp.token))).status).toBe(200);
    expect((await request(app()).get(`/api/v1/tickets/${r.body._id}`).set(auth(other.token))).status).toBe(
      404,
    );
    expect((await request(app()).get(`/api/v1/tickets/${r.body._id}`).set(auth(opsMgr.token))).status).toBe(
      404,
    );
    const queue = await request(app())
      .get('/api/v1/tickets?view=department&unassigned=true')
      .set(auth(itMgr.token));
    expect(queue.body.total).toBe(1);
    // Staff see their own department's queue (Operations here), not IT's.
    const own = await request(app()).get('/api/v1/tickets?view=department').set(auth(emp.token));
    expect(own.status).toBe(200);
    expect(own.body.total).toBe(0);
    expect((await request(app()).get('/api/v1/tickets?view=mine').set(auth(emp.token))).body.total).toBe(1);
  });

  it('assign → processing start recorded → info requested → provided → resolved → only the requester closes, with a rating', async () => {
    const { emp, other, itMgr, tech, opsMgr } = await setup();
    const t = await open(emp.token, {});
    const id = t.body._id as string;
    // Only a member of the manager's department / team can be assigned.
    expect((await act(itMgr.token, id, 'assign', { assigneeId: other.userId })).status).toBe(403);
    expect((await act(opsMgr.token, id, 'assign', { assigneeId: tech.userId })).status).toBe(404);
    const assigned = await act(itMgr.token, id, 'assign', { assigneeId: tech.userId });
    expect(assigned.status).toBe(200);
    expect(assigned.body.state).toBe('in_progress');
    expect(assigned.body.processingStartedAt).toBeTruthy(); // IT §7.1 "تاريخ المعالجة"
    expect(await Notification.countDocuments({ userId: tech.userId, type: 'ticket.assigned' })).toBe(1);
    expect(await Notification.countDocuments({ userId: emp.userId, type: 'ticket.updated' })).toBe(1);
    // Assignee asks for more information; the requester answers with an attachment-free note.
    expect((await act(tech.token, id, 'request_info')).status).toBe(400);
    const waiting = await act(tech.token, id, 'request_info', { reason: 'ما رقم الطابعة؟' });
    expect(waiting.body.state).toBe('waiting_requester');
    expect(await Notification.countDocuments({ userId: emp.userId, type: 'ticket.info_requested' })).toBe(1);
    expect((await act(tech.token, id, 'provide_info', { note: 'x' })).status).toBe(403);
    expect((await act(emp.token, id, 'provide_info', { note: 'HP-204 في المستودع' })).body.state).toBe(
      'in_progress',
    );
    // Resolve needs a resolution; the requester cannot resolve; the department cannot close.
    expect((await act(tech.token, id, 'resolve')).status).toBe(400);
    expect((await act(emp.token, id, 'resolve', { resolution: 'x' })).status).toBe(403);
    const resolved = await act(tech.token, id, 'resolve', { resolution: 'تم تغيير بكرة السحب' });
    expect(resolved.body.state).toBe('resolved');
    expect(resolved.body.pendingWith).toBe('requester');
    expect(await Notification.countDocuments({ userId: emp.userId, type: 'ticket.resolved' })).toBe(1);
    expect((await act(tech.token, id, 'close')).status).toBe(403);
    expect((await act(itMgr.token, id, 'close')).status).toBe(403);
    expect((await act(emp.token, id, 'close')).status).toBe(400); // rating required
    const detail = await request(app()).get(`/api/v1/tickets/${id}`).set(auth(emp.token));
    expect(detail.body.actions.sort()).toEqual(['close', 'reopen']);
    const closed = await act(emp.token, id, 'close', { rating: { score: 4, comment: 'شكرًا' } });
    expect(closed.body.state).toBe('closed');
    expect(closed.body.rating.score).toBe(4);
    expect(await Notification.countDocuments({ userId: tech.userId, type: 'ticket.closed' })).toBe(1);
    const actions = await TicketAction.find({ ticketId: id }).sort({ at: 1 }).lean();
    expect(actions.map((a) => a.action)).toEqual([
      'created',
      'assign',
      'request_info',
      'provide_info',
      'resolve',
      'close',
    ]);
    expect(await StageLog.countDocuments({ recordType: 'ticket', recordId: id })).toBe(5);
  });

  it('after تم الحل: reminder after 3 business days, auto-close after 5, reopening allowed within 10 days only', async () => {
    const { emp, itMgr, tech } = await setup();
    const t = await open(emp.token, {});
    const id = t.body._id as string;
    await act(itMgr.token, id, 'assign', { assigneeId: tech.userId });
    await act(tech.token, id, 'resolve', { resolution: 'تم' });
    // Resolved on a Sunday → reminder on Wednesday, auto-close the Sunday after (Fri/Sat skipped).
    const sunday = new Date('2026-11-01T08:00:00Z');
    await Ticket.updateOne({ _id: id }, { $set: { resolvedAt: sunday } });
    expect(await runTicketFollowUps(new Date('2026-11-03T08:00:00Z'))).toEqual({
      reminded: 0,
      autoClosed: 0,
    });
    expect(await runTicketFollowUps(new Date('2026-11-04T09:00:00Z'))).toEqual({
      reminded: 1,
      autoClosed: 0,
    });
    expect((await Ticket.findById(id))!.state).toBe('awaiting_confirmation');
    expect(await Notification.countDocuments({ userId: emp.userId, type: 'ticket.confirm_reminder' })).toBe(
      1,
    );
    expect(await runTicketFollowUps(new Date('2026-11-05T09:00:00Z'))).toEqual({
      reminded: 0,
      autoClosed: 0,
    });
    expect(await runTicketFollowUps(new Date('2026-11-08T09:00:00Z'))).toEqual({
      reminded: 0,
      autoClosed: 1,
    });
    const closed = await Ticket.findById(id);
    expect(closed!.state).toBe('closed');
    expect(closed!.autoClosed).toBe(true);
    expect(await Notification.countDocuments({ userId: emp.userId, type: 'ticket.auto_closed' })).toBe(1);
    // Reopen within the window (reason required), then not after it.
    expect((await act(emp.token, id, 'reopen')).status).toBe(400);
    const reopened = await act(emp.token, id, 'reopen', { reason: 'المشكلة عادت' });
    expect(reopened.body.state).toBe('reopened');
    expect(reopened.body.reopenCount).toBe(1);
    expect(await Notification.countDocuments({ userId: tech.userId, type: 'ticket.reopened' })).toBe(1);
    await act(tech.token, id, 'start');
    await act(tech.token, id, 'resolve', { resolution: 'تم مرة أخرى' });
    await act(emp.token, id, 'close', { rating: { score: 3 } });
    await Ticket.updateOne({ _id: id }, { $set: { closedAt: new Date(Date.now() - 11 * 86_400_000) } });
    const late = await act(emp.token, id, 'reopen', { reason: 'مرة ثالثة' });
    expect(late.status).toBe(400);
    expect((await request(app()).get(`/api/v1/tickets/${id}`).set(auth(emp.token))).body.actions).toEqual([]);
  });

  it('IT has متعثر; other departments do not; concurrent moves are serialized', async () => {
    const { emp, itMgr, tech, opsMgr } = await setup();
    const t = await open(emp.token, {});
    await act(itMgr.token, t.body._id, 'assign', { assigneeId: tech.userId });
    const detail = await request(app()).get(`/api/v1/tickets/${t.body._id}`).set(auth(tech.token));
    expect(detail.body.actions).toContain('stall');
    const stalled = await act(tech.token, t.body._id, 'stall', { reason: 'بانتظار قطعة غيار' });
    expect(stalled.body.state).toBe('stalled');
    expect((await act(tech.token, t.body._id, 'resume')).body.state).toBe('in_progress');
    const [a, b] = await Promise.all([
      act(tech.token, t.body._id, 'resolve', { resolution: 'أ' }),
      act(tech.token, t.body._id, 'resolve', { resolution: 'ب' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await TicketAction.countDocuments({ ticketId: t.body._id, action: 'resolve' })).toBe(1);
    // An Operations ticket runs on the generic workflow: no stall.
    const o = await open(emp.token, { departmentCode: 'ops', fields: {} });
    expect(o.body.workflowType).toBe('ticket');
    await act(opsMgr.token, o.body._id, 'assign', { assigneeId: opsMgr.userId });
    const od = await request(app()).get(`/api/v1/tickets/${o.body._id}`).set(auth(opsMgr.token));
    expect(od.body.actions).not.toContain('stall');
    expect((await act(opsMgr.token, o.body._id, 'stall', { reason: 'x' })).status).toBe(400);
  });
});

describe('slice 4 review changes', () => {
  it('1: department staff see their department queue (view only) and may claim an unassigned ticket; per-department switch', async () => {
    const { it, emp, itMgr, tech } = await setup();
    // A second IT employee without any role.
    const hr = await loginAs('hr@eayni.local');
    const r = await request(app())
      .post('/api/v1/hr/employees')
      .set(auth(hr))
      .send({
        firstNameAr: 'نواف',
        lastNameAr: 'الشهري',
        gender: 'male',
        nationality: 'سعودي',
        workEmail: 'tech2@eayni.local',
        identity: { type: 'national_id', number: '1088999001' },
        hireDate: '2024-01-10',
        departmentId: String(it._id),
      });
    const tech2 = {
      userId: r.body.userId as string,
      token: await activateAccount('tech2@eayni.local', r.body.temporaryPassword),
    };
    const t = await open(emp.token, {});
    const id = t.body._id as string;
    const caps = await request(app()).get('/api/v1/tickets/targets').set(auth(tech2.token));
    expect(caps.body.queue).toMatchObject({ departmentCode: 'it', isManager: false, canView: true });
    const queue = await request(app()).get('/api/v1/tickets?view=department').set(auth(tech2.token));
    expect(queue.body.total).toBe(1);
    const detail = await request(app()).get(`/api/v1/tickets/${id}`).set(auth(tech2.token));
    expect(detail.status).toBe(200);
    expect(detail.body.actions).toEqual(['claim']); // view only, except taking it
    expect((await act(tech2.token, id, 'assign', { assigneeId: tech.userId })).status).toBe(403);
    const claimed = await act(tech2.token, id, 'claim');
    expect(claimed.status).toBe(200);
    expect(claimed.body.assigneeId).toBe(tech2.userId);
    expect(claimed.body.state).toBe('in_progress');
    expect(await Notification.countDocuments({ userId: itMgr.userId, type: 'ticket.updated' })).toBe(1);
    expect((await act(tech.token, id, 'claim')).status).toBe(400); // already taken
    // The manager can still reassign it.
    expect((await act(itMgr.token, id, 'assign', { assigneeId: tech.userId })).status).toBe(200);
    // Switch off for IT: no queue, no claim.
    await setSetting('tickets.staffQueueDepartments', { it: false }, SYSTEM_ACTOR);
    const t2 = await open(emp.token, {});
    expect((await request(app()).get('/api/v1/tickets?view=department').set(auth(tech2.token))).status).toBe(
      403,
    );
    expect((await request(app()).get(`/api/v1/tickets/${t2.body._id}`).set(auth(tech2.token))).status).toBe(
      404,
    );
    expect((await act(tech2.token, t2.body._id, 'claim')).status).toBe(404);
  });

  it('2: a reopened ticket goes back to whoever resolved it; to the queue only if they left the department', async () => {
    const { it, ops, emp, itMgr, tech } = await setup();
    const t = await open(emp.token, {});
    const id = t.body._id as string;
    await act(itMgr.token, id, 'assign', { assigneeId: tech.userId });
    await act(tech.token, id, 'resolve', { resolution: 'تم' });
    const back = await act(emp.token, id, 'reopen', { reason: 'لم يُحل' });
    expect(back.body.state).toBe('reopened');
    expect(back.body.assigneeId).toBe(tech.userId);
    expect(back.body.pendingWith).toBe('assignee');
    expect(await Notification.countDocuments({ userId: tech.userId, type: 'ticket.reopened' })).toBe(1);
    expect(await Notification.countDocuments({ userId: itMgr.userId, type: 'ticket.reopened' })).toBe(1);
    await act(tech.token, id, 'start');
    await act(tech.token, id, 'resolve', { resolution: 'تم فعلًا' });
    // The resolver moves to Operations → the reopened ticket lands in the IT queue instead.
    const hr = await loginAs('hr@eayni.local');
    const opsMgrEmp = await request(app()).get('/api/v1/hr/employees?limit=50').set(auth(hr));
    const opsManager = opsMgrEmp.body.items.find(
      (e: { workEmail: string }) => e.workEmail === 'opsmgr@eayni.local',
    );
    const techEmp = opsMgrEmp.body.items.find(
      (e: { workEmail: string }) => e.workEmail === 'tech@eayni.local',
    );
    const moved = await request(app())
      .post(`/api/v1/hr/employees/${techEmp._id}/transfer`)
      .set(auth(hr))
      .send({
        departmentId: String(ops._id),
        directManagerId: opsManager._id,
        effectiveDate: '2026-11-01',
        reason: 'نقل',
      });
    expect(moved.status).toBe(200);
    const again = await act(emp.token, id, 'reopen', { reason: 'عادت المشكلة' });
    expect(again.body.state).toBe('reopened');
    expect(again.body.assigneeId ?? null).toBeNull();
    expect(again.body.pendingWith).toBe('department');
    expect(String(it._id)).toBeTruthy();
  });
});
