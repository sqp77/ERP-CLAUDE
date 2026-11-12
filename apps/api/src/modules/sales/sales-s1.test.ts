import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { DEFAULT_SALES_TAGS } from '@eayni/shared';
import { auth, loginAs, makeDepartment, makeUser, testApp } from '../../test/helpers';
import { setSetting } from '../../core/settings/service';
import { SYSTEM_ACTOR } from '../../core/http/context';
import { ensureDefaultTags } from '../../core/tags/service';
import { Notification } from '../../core/notifications/model';
import { Opportunity } from './model';

const app = () => testApp();

async function setup() {
  await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
  await ensureDefaultTags('sales', DEFAULT_SALES_TAGS);
  const sales = await makeDepartment('sales', 'المبيعات');
  const mgr = await makeUser(
    'sultan@eayni.local',
    [{ role: 'employee' }, { role: 'sales_manager', departmentId: String(sales._id) }],
    { departmentId: sales._id },
  );
  const repA = await makeUser('reem@eayni.local', [{ role: 'employee' }, { role: 'sales_rep' }], {
    departmentId: sales._id,
  });
  const repB = await makeUser('majed@eayni.local', [{ role: 'employee' }, { role: 'sales_rep' }], {
    departmentId: sales._id,
  });
  const t = {
    mgr: await loginAs('sultan@eayni.local'),
    repA: await loginAs('reem@eayni.local'),
    repB: await loginAs('majed@eayni.local'),
  };
  const customer = await request(app())
    .post('/api/v1/crm/customers')
    .set(auth(t.repA))
    .send({ nameAr: 'مصنع البلاستيك الحديث', source: 'direct_contact', phone: '0501111111' });
  expect(customer.status).toBe(201);
  return { sales, mgr, repA, repB, t, customerId: customer.body._id as string };
}

describe('Sales S1 — opportunities and pipeline [SAL §4.1 رابعاً, §4.2, §8.1]', () => {
  it('stages move with history; خاسرة requires a reason from the configurable list; won/lost are stamped; races get 409', async () => {
    const { t, customerId } = await setup();
    const o = await request(app())
      .post('/api/v1/sales/opportunities')
      .set(auth(t.repA))
      .send({
        customerId,
        title: 'توريد 50 حاوية',
        serviceType: 'containerSale',
        expectedValueHalalas: 2_000_000,
        tags: ['#تأجير_حاويات'],
      });
    expect(o.status, JSON.stringify(o.body)).toBe(201);
    expect(o.body.number).toMatch(/^OPP-/);
    expect(o.body.stage).toBe('new');
    const id = o.body._id as string;
    expect(
      (
        await request(app())
          .post(`/api/v1/sales/opportunities/${id}/stage`)
          .set(auth(t.repA))
          .send({ stage: 'lost' })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app())
          .post(`/api/v1/sales/opportunities/${id}/stage`)
          .set(auth(t.repA))
          .send({ stage: 'lost', lostReason: 'سبب من خارج القائمة' })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app())
          .post(`/api/v1/sales/opportunities/${id}/stage`)
          .set(auth(t.repA))
          .send({ stage: 'lost', lostReason: 'أخرى (مع توضيح)' })
      ).status,
    ).toBe(400);
    for (const stage of ['contacted', 'meeting_scheduled', 'negotiating']) {
      const r = await request(app())
        .post(`/api/v1/sales/opportunities/${id}/stage`)
        .set(auth(t.repA))
        .send({ stage });
      expect(r.status).toBe(200);
      expect(r.body.stage).toBe(stage);
    }
    const lost = await request(app())
      .post(`/api/v1/sales/opportunities/${id}/stage`)
      .set(auth(t.repA))
      .send({ stage: 'lost', lostReason: 'السعر', lostNote: 'عرض منافس أقل' });
    expect(lost.status).toBe(200);
    expect(lost.body.lostAt).toBeTruthy();
    expect(lost.body.events.map((e: { type: string; to?: string }) => e.to)).toEqual([
      'new',
      'contacted',
      'meeting_scheduled',
      'negotiating',
      'lost',
    ]);
    expect(lost.body.events.at(-1).note).toContain('السعر');
    // Same stage again → 409.
    expect(
      (
        await request(app())
          .post(`/api/v1/sales/opportunities/${id}/stage`)
          .set(auth(t.repA))
          .send({ stage: 'lost', lostReason: 'السعر' })
      ).status,
    ).toBe(409);
  });

  it('a rep cannot see or move another rep’s opportunity; the manager reassigns and both reps are told; the pipeline summary follows the scope', async () => {
    const { t, repB, customerId } = await setup();
    const o = await request(app())
      .post('/api/v1/sales/opportunities')
      .set(auth(t.repA))
      .send({ customerId, title: 'عقد فرز', serviceType: 'sortingContract', expectedValueHalalas: 800_000 });
    const id = o.body._id as string;
    expect((await request(app()).get(`/api/v1/sales/opportunities/${id}`).set(auth(t.repB))).status).toBe(
      404,
    );
    expect(
      (
        await request(app())
          .post(`/api/v1/sales/opportunities/${id}/stage`)
          .set(auth(t.repB))
          .send({ stage: 'contacted' })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app())
          .post('/api/v1/sales/opportunities/reassign')
          .set(auth(t.repA))
          .send({ opportunityIds: [id], toUserId: String(repB._id), reason: 'x y' })
      ).status,
    ).toBe(403);
    const summaryBefore = await request(app()).get('/api/v1/sales/opportunities/pipeline').set(auth(t.mgr));
    expect(summaryBefore.body.stages.new).toMatchObject({ count: 1, valueHalalas: 800_000 });
    const moved = await request(app())
      .post('/api/v1/sales/opportunities/reassign')
      .set(auth(t.mgr))
      .send({ opportunityIds: [id], toUserId: String(repB._id), reason: 'توازن الأعباء' });
    expect(moved.status).toBe(200);
    expect(moved.body.moved).toBe(1);
    expect((await request(app()).get(`/api/v1/sales/opportunities/${id}`).set(auth(t.repB))).status).toBe(
      200,
    );
    expect(
      (await request(app()).get('/api/v1/sales/opportunities/pipeline').set(auth(t.repA))).body.stages.new,
    ).toBeUndefined();
    expect(await Notification.exists({ userId: repB._id, type: 'sales.opportunity.assigned' })).toBeTruthy();
    expect((await Opportunity.findById(id))!.ownerUserId.toString()).toBe(String(repB._id));
  });

  it('«عميل جديد / فرصة بيعية جديدة» creates the customer and its first opportunity together; the landing counters reflect them', async () => {
    const { t } = await setup();
    const c = await request(app())
      .post('/api/v1/crm/customers')
      .set(auth(t.repA))
      .send({
        nameAr: 'جمعية البر',
        source: 'referrals',
        phone: '0502222222',
        opportunity: {
          title: 'إتلاف أرشيف',
          serviceType: 'destruction',
          expectedValueHalalas: 300_000,
          nextFollowUpAt: '2020-01-01T09:00:00+03:00',
        },
      });
    expect(c.status).toBe(201);
    const opps = await request(app())
      .get(`/api/v1/sales/opportunities?customerId=${c.body._id}`)
      .set(auth(t.repA));
    expect(opps.body.items).toHaveLength(1);
    expect(opps.body.items[0]).toMatchObject({
      title: 'إتلاف أرشيف',
      serviceType: 'destruction',
      customerName: 'جمعية البر',
    });
    const home = await request(app()).get('/api/v1/sales/home').set(auth(t.repA));
    expect(home.body).toMatchObject({
      myCustomers: 2,
      openOpportunities: 1,
      overdueOpportunities: 1,
      isManager: false,
    });
    const mgrHome = await request(app()).get('/api/v1/sales/home').set(auth(t.mgr));
    expect(mgrHome.body).toMatchObject({ deptCustomers: 2, isManager: true });
    // Follow-up filter [SAL §13 ثالثاً «الفرص التي تجاوزت موعد المتابعة»].
    expect(
      (await request(app()).get('/api/v1/sales/opportunities?followUpDue=true').set(auth(t.repA))).body.total,
    ).toBe(1);
  });
});
