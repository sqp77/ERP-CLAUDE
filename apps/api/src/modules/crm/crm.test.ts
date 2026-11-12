import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { DEFAULT_SALES_TAGS } from '@eayni/shared';
import { auth, loginAs, makeDepartment, makeUser, testApp } from '../../test/helpers';
import { setSetting } from '../../core/settings/service';
import { SYSTEM_ACTOR } from '../../core/http/context';
import { ensureDefaultTags } from '../../core/tags/service';
import { Notification } from '../../core/notifications/model';
import { AuditLog } from '../../core/audit/model';
import { CommunicationLog, Customer, Lead } from './model';
import { runFollowUpReminders, runLeadOverdueAlerts } from './jobs';
import { DUPLICATE_MESSAGE } from './service';

const app = () => testApp();

/** Sales department with an implied manager (DECISIONS §20 change 3), two reps, an executive, a CS agent and an outsider. */
async function setup() {
  await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
  await ensureDefaultTags('sales', DEFAULT_SALES_TAGS); // the baseline runs once per worker; the DB is wiped per test
  const sales = await makeDepartment('sales', 'المبيعات');
  const cs = await makeDepartment('cs', 'خدمة العملاء');
  const hr = await makeDepartment('hr', 'الموارد البشرية');
  const mgr = await makeUser(
    'sultan@eayni.local',
    [{ role: 'employee' }, { role: 'department_manager', departmentId: String(sales._id) }],
    { departmentId: sales._id },
  );
  const repA = await makeUser('reem@eayni.local', [{ role: 'employee' }, { role: 'sales_rep' }], {
    departmentId: sales._id,
  });
  const repB = await makeUser('majed@eayni.local', [{ role: 'employee' }, { role: 'sales_rep' }], {
    departmentId: sales._id,
  });
  const exec = await makeUser('ceo@eayni.local', [{ role: 'employee' }, { role: 'executive' }]);
  const agent = await makeUser('arwa@eayni.local', [{ role: 'employee' }], { departmentId: cs._id });
  const outsider = await makeUser('noura@eayni.local', [{ role: 'employee' }], { departmentId: hr._id });
  const tokens = {
    mgr: await loginAs('sultan@eayni.local'),
    repA: await loginAs('reem@eayni.local'),
    repB: await loginAs('majed@eayni.local'),
    exec: await loginAs('ceo@eayni.local'),
    agent: await loginAs('arwa@eayni.local'),
    outsider: await loginAs('noura@eayni.local'),
  };
  return { sales, cs, hr, mgr, repA, repB, exec, agent, outsider, t: tokens };
}

const customerBody = (over: Record<string, unknown> = {}) => ({
  nameAr: 'شركة الخليج للتغليف',
  country: 'السعودية',
  region: 'المنطقة الشرقية',
  city: 'الدمام',
  activity: 'تغليف',
  organizationType: 'خاص',
  facilitySize: 'متوسطة',
  source: 'field_visits',
  phone: '0501234567',
  contacts: [
    { nameAr: 'أحمد', jobTitle: 'مدير المشتريات', phone: '0551112222' },
    { nameAr: 'سعد', jobTitle: 'المدير المالي' },
    { nameAr: 'منى', jobTitle: 'منسقة' },
  ],
  ...over,
});

describe('CRM core — customer file, contacts, log, duplicates [SAL §4.1, §15, §19]', () => {
  it('a rep sees only their own customers; the duplicate check never leaks another rep’s file; the manager sees both', async () => {
    const { t } = await setup();
    const created = await request(app()).post('/api/v1/crm/customers').set(auth(t.repA)).send(customerBody());
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.number).toMatch(/^CUS-\d{4}-\d{5}$/);
    const id = created.body._id as string;
    // Rep B: not in the list, 404 on the record, and the duplicate check gives only the message.
    expect((await request(app()).get('/api/v1/crm/customers').set(auth(t.repB))).body.total).toBe(0);
    expect((await request(app()).get(`/api/v1/crm/customers/${id}`).set(auth(t.repB))).status).toBe(404);
    const dupB = await request(app())
      .post('/api/v1/crm/customers/check-duplicate')
      .set(auth(t.repB))
      .send({ nameAr: 'شركه الخليج للتغليف' });
    expect(dupB.body).toMatchObject({
      duplicate: true,
      visible: [],
      hiddenCount: 1,
      message: DUPLICATE_MESSAGE,
    });
    const createB = await request(app())
      .post('/api/v1/crm/customers')
      .set(auth(t.repB))
      .send(customerBody({ phone: '0509999999' }));
    expect(createB.status).toBe(409);
    expect(createB.body.error.message).toBe(DUPLICATE_MESSAGE);
    expect(createB.body.error.details.number).toBeUndefined();
    // Same phone, different name → still a duplicate for the rep.
    const byPhone = await request(app())
      .post('/api/v1/crm/customers/check-duplicate')
      .set(auth(t.repB))
      .send({ nameAr: 'اسم آخر', phone: '+966501234567' });
    expect(byPhone.body.duplicate).toBe(true);
    // Manager (implied sales_manager): sees the match with its owner, and may confirm a same-name file knowingly.
    const dupM = await request(app())
      .post('/api/v1/crm/customers/check-duplicate')
      .set(auth(t.mgr))
      .send({ nameAr: 'شركة الخليج للتغليف' });
    expect(dupM.body.visible[0]).toMatchObject({ number: created.body.number, ownerName: 'reem' });
    expect(
      (
        await request(app())
          .post('/api/v1/crm/customers')
          .set(auth(t.mgr))
          .send(customerBody({ phone: '0507777777' }))
      ).status,
    ).toBe(409);
    const confirmed = await request(app())
      .post('/api/v1/crm/customers')
      .set(auth(t.mgr))
      .send(customerBody({ phone: '0507777777', confirmDuplicateName: true }));
    expect(confirmed.status).toBe(201);
    expect((await request(app()).get('/api/v1/crm/customers').set(auth(t.mgr))).body.total).toBe(2);
    // The same CR number is a hard duplicate, even for the manager (FIN §8 party master).
    const withCr = await request(app())
      .post('/api/v1/crm/customers')
      .set(auth(t.repA))
      .send(customerBody({ nameAr: 'مصنع الشرق', phone: '0503333333', crNumber: '1010101010' }));
    expect(withCr.status).toBe(201);
    expect(withCr.body.partyId).toBeTruthy();
    const sameCr = await request(app())
      .post('/api/v1/crm/customers')
      .set(auth(t.mgr))
      .send(
        customerBody({
          nameAr: 'مصنع الشرق الجديد',
          phone: '0504444444',
          crNumber: '1010101010',
          confirmDuplicateName: true,
        }),
      );
    expect(sameCr.status).toBe(409);
    // Executive: read-only over everything [SAL §15].
    expect((await request(app()).get('/api/v1/crm/customers').set(auth(t.exec))).body.total).toBe(3);
    expect(
      (
        await request(app())
          .post('/api/v1/crm/customers')
          .set(auth(t.exec))
          .send(customerBody({ nameAr: 'x y' }))
      ).status,
    ).toBe(403);
    // Outsider: nothing.
    expect((await request(app()).get('/api/v1/crm/customers').set(auth(t.outsider))).status).toBe(403);
    expect(
      await AuditLog.exists({ resource: 'crm.customers', action: 'create', resourceId: id }),
    ).toBeTruthy();
  });

  it('at most three contact persons per organization — the fourth is refused by the server', async () => {
    const { t } = await setup();
    const c = await request(app()).post('/api/v1/crm/customers').set(auth(t.repA)).send(customerBody());
    const fourth = await request(app())
      .post(`/api/v1/crm/customers/${c.body._id}/contacts`)
      .set(auth(t.repA))
      .send({ nameAr: 'رابع' });
    expect(fourth.status).toBe(409);
    expect(fourth.body.error.details.code).toBe('max_contacts');
    // Removing one makes room again.
    const detail = await request(app()).get(`/api/v1/crm/customers/${c.body._id}`).set(auth(t.repA));
    expect(detail.body.contacts).toHaveLength(3);
    await request(app())
      .delete(`/api/v1/crm/customers/${c.body._id}/contacts/${detail.body.contacts[0]._id}`)
      .set(auth(t.repA));
    expect(
      (
        await request(app())
          .post(`/api/v1/crm/customers/${c.body._id}/contacts`)
          .set(auth(t.repA))
          .send({ nameAr: 'رابع' })
      ).status,
    ).toBe(201);
    // Creating with four at once is a validation error.
    expect(
      (
        await request(app())
          .post('/api/v1/crm/customers')
          .set(auth(t.repA))
          .send(
            customerBody({
              nameAr: 'جهة أخرى',
              phone: '0500000001',
              contacts: [{ nameAr: '1' }, { nameAr: '2' }, { nameAr: '3' }, { nameAr: '4' }],
            }),
          )
      ).status,
    ).toBe(400);
  });

  it('the communication log is append-only, keeps author and time, and survives a transfer that notifies both reps and moves open opportunities', async () => {
    const { t, repA, repB } = await setup();
    const c = await request(app())
      .post('/api/v1/crm/customers')
      .set(auth(t.repA))
      .send(customerBody({ opportunity: { title: 'توريد حاويات', expectedValueHalalas: 1_500_000 } }));
    const id = c.body._id as string;
    const log = await request(app()).post(`/api/v1/crm/customers/${id}/logs`).set(auth(t.repA)).send({
      method: 'call',
      details: 'اتصال أولي، العميل مهتم',
      customerNeed: '20 حاوية',
      nextStep: 'زيارة',
      nextFollowUpAt: '2030-01-10T09:00:00+03:00',
    });
    expect(log.status).toBe(201);
    expect(log.body.authorName).toBe('reem');
    expect(new Date(log.body.at).getTime()).toBeGreaterThan(Date.now() - 60_000);
    // No way to edit or delete an entry.
    expect(
      (
        await request(app())
          .patch(`/api/v1/crm/customers/${id}/logs/${log.body._id}`)
          .set(auth(t.repA))
          .send({ details: 'x' })
      ).status,
    ).toBe(404);
    expect(
      (await request(app()).delete(`/api/v1/crm/customers/${id}/logs/${log.body._id}`).set(auth(t.mgr)))
        .status,
    ).toBe(404);
    expect((await Customer.findById(id))!.nextFollowUpAt?.toISOString()).toBe('2030-01-10T06:00:00.000Z');
    // Transfer: rep only → 403; manager → history row with reason, both reps notified, opportunity follows.
    expect(
      (
        await request(app())
          .post('/api/v1/crm/customers/transfer')
          .set(auth(t.repA))
          .send({ customerIds: [id], toUserId: String(repB._id), reason: 'إعادة توزيع' })
      ).status,
    ).toBe(403);
    const moved = await request(app())
      .post('/api/v1/crm/customers/transfer')
      .set(auth(t.mgr))
      .send({ customerIds: [id], toUserId: String(repB._id), reason: 'إعادة توزيع المنطقة' });
    expect(moved.status).toBe(200);
    expect(moved.body.moved).toBe(1);
    expect((await request(app()).get(`/api/v1/crm/customers/${id}`).set(auth(t.repA))).status).toBe(404);
    const forB = await request(app()).get(`/api/v1/crm/customers/${id}`).set(auth(t.repB));
    expect(forB.status).toBe(200);
    expect(forB.body.events.map((e: { type: string }) => e.type)).toEqual(['created', 'owner_changed']);
    expect(forB.body.events[1]).toMatchObject({
      reason: 'إعادة توزيع المنطقة',
      fromUserName: 'reem',
      toUserName: 'majed',
    });
    const logsForB = await request(app()).get(`/api/v1/crm/customers/${id}/logs`).set(auth(t.repB));
    expect(logsForB.body.items).toHaveLength(1);
    expect(logsForB.body.items[0].authorName).toBe('reem');
    expect(await CommunicationLog.countDocuments({ customerId: id })).toBe(1);
    expect(await Notification.exists({ userId: repB._id, type: 'crm.customer.assigned' })).toBeTruthy();
    expect(await Notification.exists({ userId: repA._id, type: 'crm.owner_changed' })).toBeTruthy();
    const opps = await request(app()).get(`/api/v1/sales/opportunities?customerId=${id}`).set(auth(t.repB));
    expect(opps.body.items).toHaveLength(1);
    expect(opps.body.items[0].ownerUserId).toBe(String(repB._id));
  });

  it('leads: Customer Service refers, Sales managers are told, the manager assigns, the rep converts keeping the link; the 24-hour rule fires once', async () => {
    const { t, mgr, repA, agent } = await setup();
    // An employee outside Customer Service without a grant cannot refer.
    expect(
      (
        await request(app())
          .post('/api/v1/crm/leads')
          .set(auth(t.outsider))
          .send({ customerName: 'مطعم النخيل', interest: 'عقد نظافة' })
      ).status,
    ).toBe(403);
    const lead = await request(app()).post('/api/v1/crm/leads').set(auth(t.agent)).send({
      customerName: 'مطعم النخيل',
      contactName: 'فهد',
      phone: '0561234567',
      interest: 'عقد نظافة أسبوعي',
      channel: 'واتساب',
    });
    expect(lead.status, JSON.stringify(lead.body)).toBe(201);
    expect(lead.body.number).toMatch(/^LED-/);
    expect(lead.body.state).toBe('new');
    expect(await Notification.exists({ userId: mgr._id, type: 'crm.lead.referred' })).toBeTruthy();
    // The agent sees their own referrals; a rep sees nothing yet; the manager sees the department queue.
    expect((await request(app()).get('/api/v1/crm/leads?view=referred').set(auth(t.agent))).body.total).toBe(
      1,
    );
    expect((await request(app()).get('/api/v1/crm/leads').set(auth(t.repA))).body.total).toBe(0);
    expect((await request(app()).get('/api/v1/crm/leads').set(auth(t.mgr))).body.total).toBe(1);
    // Only the manager assigns [SAL §8.1].
    expect(
      (
        await request(app())
          .post(`/api/v1/crm/leads/${lead.body._id}/assign`)
          .set(auth(t.repA))
          .send({ assigneeUserId: String(repA._id) })
      ).status,
    ).toBe(403);
    const assigned = await request(app())
      .post(`/api/v1/crm/leads/${lead.body._id}/assign`)
      .set(auth(t.mgr))
      .send({ assigneeUserId: String(repA._id) });
    expect(assigned.status).toBe(200);
    expect(assigned.body.state).toBe('referred');
    expect(await Notification.exists({ userId: repA._id, type: 'crm.customer.assigned' })).toBeTruthy();
    // The rep converts: a customer with source «خدمة العملاء», the first opportunity, and the lead marked converted.
    const converted = await request(app())
      .post(`/api/v1/crm/leads/${lead.body._id}/convert`)
      .set(auth(t.repA))
      .send({ createOpportunity: true, expectedValueHalalas: 500_000 });
    expect(converted.status, JSON.stringify(converted.body)).toBe(200);
    expect(converted.body.state).toBe('converted');
    const customer = await request(app())
      .get(`/api/v1/crm/customers/${converted.body.customerId}`)
      .set(auth(t.repA));
    expect(customer.body).toMatchObject({
      source: 'customer_service',
      nameAr: 'مطعم النخيل',
      ownerUserId: String(repA._id),
      leadId: lead.body._id,
    });
    expect(customer.body.contacts[0].nameAr).toBe('فهد');
    const opps = await request(app())
      .get(`/api/v1/sales/opportunities?customerId=${converted.body.customerId}`)
      .set(auth(t.repA));
    expect(opps.body.items[0]).toMatchObject({
      title: 'عقد نظافة أسبوعي',
      leadId: lead.body._id,
      expectedValueHalalas: 500_000,
    });
    expect((await Lead.findById(lead.body._id))!.registeredAt).toBeTruthy();
    // 24-hour rule: a second lead referred 25 hours ago and never registered is flagged once; the managers are told.
    const late = await request(app())
      .post('/api/v1/crm/leads')
      .set(auth(t.agent))
      .send({ customerName: 'مدرسة الرواد', interest: 'حاويات', phone: '0567654321' });
    await Lead.updateOne(
      { _id: late.body._id },
      { $set: { referredAt: new Date(Date.now() - 25 * 3_600_000) } },
    );
    await Notification.deleteMany({});
    expect(await runLeadOverdueAlerts()).toEqual({ flagged: 1 });
    expect(await Notification.exists({ userId: mgr._id, type: 'crm.lead.overdue' })).toBeTruthy();
    expect(await Notification.exists({ userId: agent._id, type: 'crm.lead.overdue' })).toBeFalsy();
    expect(await runLeadOverdueAlerts()).toEqual({ flagged: 0 });
    const list = await request(app()).get('/api/v1/crm/leads?overdue=true').set(auth(t.mgr));
    expect(list.body.items.map((l: { number: string }) => l.number)).toEqual([late.body.number]);
    expect(list.body.items[0].overdue).toBe(true);
  });

  it('the follow-up reminder reaches the responsible employee once per follow-up date [SAL §10.2, §14]', async () => {
    const { t, repA } = await setup();
    const c = await request(app()).post('/api/v1/crm/customers').set(auth(t.repA)).send(customerBody());
    const soon = new Date(Date.now() + 2 * 3_600_000).toISOString();
    await request(app())
      .post(`/api/v1/crm/customers/${c.body._id}/logs`)
      .set(auth(t.repA))
      .send({ method: 'visit', details: 'زيارة', nextFollowUpAt: soon });
    expect(await runFollowUpReminders()).toEqual({ notified: 1 });
    expect(await runFollowUpReminders()).toEqual({ notified: 0 });
    expect(await Notification.countDocuments({ userId: repA._id, type: 'crm.followup.due' })).toBe(1);
    // A new follow-up date → a new reminder.
    await request(app())
      .post(`/api/v1/crm/customers/${c.body._id}/logs`)
      .set(auth(t.repA))
      .send({
        method: 'call',
        details: 'اتصال',
        nextFollowUpAt: new Date(Date.now() + 3 * 3_600_000).toISOString(),
      });
    expect(await runFollowUpReminders()).toEqual({ notified: 1 });
  });

  it('tags: the eight spec hashtags are seeded, the manager adds and edits, reps only pick existing ones [SAL §10.4]', async () => {
    const { t } = await setup();
    const tags = await request(app()).get('/api/v1/tags?scope=sales').set(auth(t.repA));
    expect(tags.status).toBe(200);
    expect(tags.body.items.map((x: { name: string }) => x.name).sort()).toEqual(
      [...DEFAULT_SALES_TAGS].sort(),
    );
    expect(
      (await request(app()).post('/api/v1/tags').set(auth(t.repA)).send({ scope: 'sales', name: '#جديد' }))
        .status,
    ).toBe(403);
    expect(
      (await request(app()).post('/api/v1/tags').set(auth(t.mgr)).send({ scope: 'sales', name: 'عميل_جديد' }))
        .status,
    ).toBe(400); // exists (with #)
    const made = await request(app())
      .post('/api/v1/tags')
      .set(auth(t.mgr))
      .send({ scope: 'sales', name: 'منطقة_الشرقية' });
    expect(made.status).toBe(201);
    expect(made.body.name).toBe('#منطقة_الشرقية');
    expect(
      (
        await request(app())
          .post('/api/v1/crm/customers')
          .set(auth(t.repA))
          .send(customerBody({ tags: ['#غير_معرّف'] }))
      ).status,
    ).toBe(400);
    const c = await request(app())
      .post('/api/v1/crm/customers')
      .set(auth(t.repA))
      .send(customerBody({ tags: ['#منطقة_الشرقية', '#عميل_جديد'] }));
    expect(c.status).toBe(201);
    expect(c.body.tags).toEqual(['#منطقة_الشرقية', '#عميل_جديد']);
    // Renaming a tag rewrites it on the records; filtering by tag works.
    await request(app()).patch(`/api/v1/tags/${made.body._id}`).set(auth(t.mgr)).send({ name: '#الشرقية' });
    expect((await Customer.findById(c.body._id))!.tags).toEqual(['#الشرقية', '#عميل_جديد']);
    expect(
      (await request(app()).get('/api/v1/crm/customers?tag=%23الشرقية').set(auth(t.repA))).body.total,
    ).toBe(1);
  });

  it('classification is the manager’s call and every change is in the history [SAL §12, DECISIONS §20 Q9]', async () => {
    const { t } = await setup();
    const c = await request(app()).post('/api/v1/crm/customers').set(auth(t.repA)).send(customerBody());
    expect(
      (
        await request(app())
          .patch(`/api/v1/crm/customers/${c.body._id}`)
          .set(auth(t.repA))
          .send({ classification: 'strategic' })
      ).status,
    ).toBe(403);
    const ok = await request(app())
      .patch(`/api/v1/crm/customers/${c.body._id}`)
      .set(auth(t.mgr))
      .send({ classification: 'strategic', status: 'active' });
    expect(ok.status).toBe(200);
    expect(ok.body.classification).toBe('strategic');
    expect(ok.body.events.map((e: { type: string }) => e.type)).toEqual([
      'created',
      'status_changed',
      'classification_changed',
    ]);
  });
});

describe('S1 approval fixes [DECISIONS §20]', () => {
  it('1: customers, leads and opportunities can only be handed to on-duty Sales staff — four paths, 400 «الموظف المستلم ليس من موظفي المبيعات»', async () => {
    const { t, hr, sales, repA } = await setup();
    const hrUser = await makeUser('salma@eayni.local', [{ role: 'employee' }], { departmentId: hr._id });
    const disabled = await makeUser('old@eayni.local', [{ role: 'employee' }], {
      departmentId: sales._id,
      status: 'disabled',
    });
    const c = await request(app()).post('/api/v1/crm/customers').set(auth(t.repA)).send(customerBody());
    const o = await request(app())
      .post('/api/v1/sales/opportunities')
      .set(auth(t.repA))
      .send({ customerId: c.body._id, title: 'فرصة' });
    const lead = await request(app())
      .post('/api/v1/crm/leads')
      .set(auth(t.agent))
      .send({ customerName: 'جهة', interest: 'اهتمام' });
    for (const target of [String(hrUser._id), String(disabled._id)]) {
      const transfer = await request(app())
        .post('/api/v1/crm/customers/transfer')
        .set(auth(t.mgr))
        .send({ customerIds: [c.body._id], toUserId: target, reason: 'تجربة' });
      expect(transfer.status).toBe(400);
      expect(transfer.body.error.message).toBe('الموظف المستلم ليس من موظفي المبيعات');
      expect(
        (
          await request(app())
            .post(`/api/v1/crm/leads/${lead.body._id}/assign`)
            .set(auth(t.mgr))
            .send({ assigneeUserId: target })
        ).status,
      ).toBe(400);
      expect(
        (
          await request(app())
            .post('/api/v1/sales/opportunities/reassign')
            .set(auth(t.mgr))
            .send({ opportunityIds: [o.body._id], toUserId: target, reason: 'تجربة' })
        ).status,
      ).toBe(400);
      expect(
        (
          await request(app())
            .post('/api/v1/crm/customers')
            .set(auth(t.mgr))
            .send(customerBody({ nameAr: 'جهة جديدة', phone: '0500000009', ownerUserId: target }))
        ).status,
      ).toBe(400);
      expect(
        (
          await request(app())
            .post('/api/v1/sales/opportunities')
            .set(auth(t.mgr))
            .send({ customerId: c.body._id, title: 'فرصة للمدير', ownerUserId: target })
        ).status,
      ).toBe(400);
    }
    // Nothing moved and the outsider was never notified.
    expect((await Customer.findById(c.body._id))!.ownerUserId.toString()).toBe(String(repA._id));
    expect(await Notification.countDocuments({ userId: hrUser._id })).toBe(0);
    // A Sales member is a valid target.
    expect(
      (
        await request(app())
          .post(`/api/v1/crm/leads/${lead.body._id}/assign`)
          .set(auth(t.mgr))
          .send({ assigneeUserId: String(repA._id) })
      ).status,
    ).toBe(200);
  });

  it('2: every active member of the Sales department is a sales_rep implicitly; HR placing someone in Sales is enough', async () => {
    const { t, sales, hr } = await setup();
    await makeUser('newrep@eayni.local', [{ role: 'employee' }], { departmentId: sales._id });
    const tok = await loginAs('newrep@eayni.local');
    const me = await request(app()).get('/api/v1/auth/me').set(auth(tok));
    expect(me.body.user.roles).toContainEqual({ role: 'sales_rep', implied: true });
    const created = await request(app())
      .post('/api/v1/crm/customers')
      .set(auth(tok))
      .send(customerBody({ nameAr: 'جهة الموظف الجديد', phone: '0500000010' }));
    expect(created.status).toBe(201);
    // The manager may hand them a customer; an HR member stays out.
    expect(
      (
        await request(app())
          .post('/api/v1/crm/customers/transfer')
          .set(auth(t.mgr))
          .send({
            customerIds: [created.body._id],
            toUserId: String(
              (await makeUser('x@eayni.local', [{ role: 'employee' }], { departmentId: hr._id }))._id,
            ),
            reason: 'تجربة',
          })
      ).status,
    ).toBe(400);
    // Someone outside Sales gets no Sales rights from the mechanism.
    await makeUser('hrperson@eayni.local', [{ role: 'employee' }], { departmentId: hr._id });
    expect(
      (
        await request(app())
          .get('/api/v1/crm/customers')
          .set(auth(await loginAs('hrperson@eayni.local')))
      ).status,
    ).toBe(403);
  });
});
