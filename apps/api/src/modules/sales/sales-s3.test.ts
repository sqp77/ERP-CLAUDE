import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { DEFAULT_SALES_TAGS } from '@eayni/shared';
import { auth, loginAs, makeDepartment, makeUser, testApp } from '../../test/helpers';
import { setSetting } from '../../core/settings/service';
import { SYSTEM_ACTOR } from '../../core/http/context';
import { ensureDefaultTags } from '../../core/tags/service';
import { Notification } from '../../core/notifications/model';
import { EmailMessage } from '../../core/email/model';
import { PriceEntry } from './pricing.model';
import { Opportunity } from './model';
import { SalesContract } from './contracts.model';
import { runContractAlerts } from './contracts.service';
import { Invoice } from '../finance/invoices.model';
import { runInvoiceOverdueAlerts } from '../finance/invoices.service';

const app = () => testApp();

async function setup() {
  await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
  await ensureDefaultTags('sales', DEFAULT_SALES_TAGS);
  const sales = await makeDepartment('sales', 'المبيعات');
  const finance = await makeDepartment('finance', 'المالية');
  const u = {
    mgr: await makeUser(
      'sultan@eayni.local',
      [{ role: 'employee' }, { role: 'department_manager', departmentId: String(sales._id) }],
      { departmentId: sales._id },
    ),
    reem: await makeUser('reem@eayni.local', [{ role: 'employee' }], { departmentId: sales._id }),
    majed: await makeUser('majed@eayni.local', [{ role: 'employee' }], { departmentId: sales._id }),
    ceo: await makeUser('abdullah@eayni.local', [{ role: 'employee' }, { role: 'executive' }]),
    abdulaziz: await makeUser('abdulaziz@eayni.local', [{ role: 'employee' }, { role: 'finance_manager' }], {
      departmentId: finance._id,
    }),
    shahad: await makeUser('shahad@eayni.local', [{ role: 'employee' }, { role: 'finance_staff' }], {
      departmentId: finance._id,
    }),
  };
  const t = {} as Record<keyof typeof u, string>;
  for (const k of Object.keys(u) as (keyof typeof u)[]) t[k] = await loginAs(u[k].email);
  const customer = await request(app())
    .post('/api/v1/crm/customers')
    .set(auth(t.reem))
    .send({
      nameAr: 'شركة الخليج للتغليف',
      source: 'field_visits',
      phone: '0501234567',
      crNumber: '2050012345',
      vatNumber: '300123456700003',
      opportunity: { title: 'توريد حاويات' },
    });
  expect(customer.status).toBe(201);
  const opp = await Opportunity.findOne({ customerId: customer.body._id }).lean();
  // Price list: a ton of cardboard and a cleaning visit (Q6: filled from the screen by the editor roles).
  const cardboard = await request(app())
    .post('/api/v1/sales/pricelist/items')
    .set(auth(t.mgr))
    .send({ kind: 'material', nameAr: 'كرتون', category: 'ورق', unit: 'ton', priceHalalas: 60_000_00 });
  expect(cardboard.status, JSON.stringify(cardboard.body)).toBe(201);
  const visit = await request(app())
    .post('/api/v1/sales/pricelist/items')
    .set(auth(t.mgr))
    .send({ kind: 'service', nameAr: 'زيارة جمع', unit: 'visit', priceHalalas: 350_00 });
  return {
    u,
    t,
    customerId: customer.body._id as string,
    opportunityId: String(opp!._id),
    cardboardId: cardboard.body._id as string,
    visitId: visit.body._id as string,
  };
}
async function upload(token: string, name = 'doc.pdf') {
  const pre = await request(app())
    .post('/api/v1/files/presign')
    .set(auth(token))
    .send({ fileName: name, mimeType: 'application/pdf', size: 11 });
  const u = new URL(pre.body.upload.url);
  await request(app())
    .put(u.pathname + u.search)
    .set('Content-Type', 'application/pdf')
    .send(Buffer.from('%PDF-1.4 ok'));
  await request(app()).post(`/api/v1/files/${pre.body.attachmentId}/complete`).set(auth(token));
  return pre.body.attachmentId as string;
}

describe('Sales S3 — price list, discount matrix, quotes, orders, contracts, invoice register [SAL §3, §6.3, §7]', () => {
  it('price list: only editor roles write; every price change is a new append-only entry with its valid-from; market prices are weekly rows', async () => {
    const { t, cardboardId } = await setup();
    expect(
      (
        await request(app())
          .post('/api/v1/sales/pricelist/items')
          .set(auth(t.reem))
          .send({ kind: 'material', nameAr: 'بلاستيك', unit: 'ton', priceHalalas: 1 })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app())
          .post(`/api/v1/sales/pricelist/items/${cardboardId}/prices`)
          .set(auth(t.reem))
          .send({ priceHalalas: 1 })
      ).status,
    ).toBe(403);
    // A future price does not apply yet; a past one is the effective price.
    expect(
      (
        await request(app())
          .post(`/api/v1/sales/pricelist/items/${cardboardId}/prices`)
          .set(auth(t.mgr))
          .send({ priceHalalas: 70_000_00, validFrom: '2030-01-01T00:00:00+03:00', note: 'زيادة مخططة' })
      ).status,
    ).toBe(201);
    const list = await request(app()).get('/api/v1/sales/pricelist').set(auth(t.reem));
    const item = list.body.items.find((x: { _id: string }) => x._id === cardboardId);
    expect(item.priceHalalas).toBe(60_000_00);
    expect(list.body.matrix.limitsUnset).toBe(true);
    expect(list.body.canEdit).toBe(false);
    expect(await PriceEntry.countDocuments({ itemId: cardboardId })).toBe(2);
    expect(
      (
        await request(app())
          .post(`/api/v1/sales/pricelist/items/${cardboardId}/market`)
          .set(auth(t.mgr))
          .send({ priceHalalas: 58_000_00, source: 'سوق الدمام' })
      ).status,
    ).toBe(201);
    const hist = await request(app())
      .get(`/api/v1/sales/pricelist/items/${cardboardId}/history`)
      .set(auth(t.mgr));
    expect(hist.body.entries).toHaveLength(2);
    expect(hist.body.market).toHaveLength(1);
    // No route edits or deletes an entry.
    expect(
      (
        await request(app())
          .patch(`/api/v1/sales/pricelist/items/${cardboardId}/prices/${hist.body.entries[0]._id}`)
          .set(auth(t.mgr))
          .send({ priceHalalas: 1 })
      ).status,
    ).toBe(404);
  });

  it('discount matrix: with the limits unset every discount needs the executive and the quote says so; the author never approves; the customer document has no discount or list price', async () => {
    const { t, u, customerId, opportunityId, cardboardId, visitId } = await setup();
    const q = await request(app())
      .post('/api/v1/sales/quotes')
      .set(auth(t.reem))
      .send({
        customerId,
        opportunityId,
        lines: [
          { itemId: cardboardId, quantity: 10, discountPercentBp: 500 },
          { itemId: visitId, quantity: 4 },
        ],
      });
    expect(q.status, JSON.stringify(q.body)).toBe(201);
    expect(q.body.number).toMatch(/^QUO-/);
    expect(q.body.lines[0]).toMatchObject({
      listPriceHalalas: 60_000_00,
      discountPercentBp: 500,
      discountHalalas: 3_000_00,
      netUnitPriceHalalas: 57_000_00,
      lineTotalHalalas: 570_000_00,
      vatHalalas: 85_500_00,
    });
    expect(q.body.subtotalHalalas).toBe(570_000_00 + 1_400_00);
    expect(q.body.totalHalalas).toBe(q.body.subtotalHalalas + q.body.vatTotalHalalas);
    expect(q.body.approval).toMatchObject({ requiredLevel: 'executive', limitsUnset: true });
    const id = q.body._id as string;
    const submitted = await request(app()).post(`/api/v1/sales/quotes/${id}/submit`).set(auth(t.reem));
    expect(submitted.body.state).toBe('pending_approval');
    expect(
      await Notification.exists({ userId: u.ceo._id, type: 'sales.quote.approval_requested' }),
    ).toBeTruthy();
    // The manager cannot approve while the limits are unset (executive level); the author never can.
    expect((await request(app()).post(`/api/v1/sales/quotes/${id}/approve`).set(auth(t.mgr))).status).toBe(
      403,
    );
    expect((await request(app()).post(`/api/v1/sales/quotes/${id}/approve`).set(auth(t.reem))).status).toBe(
      403,
    );
    const approved = await request(app())
      .post(`/api/v1/sales/quotes/${id}/approve`)
      .set(auth(t.ceo))
      .send({ note: 'ضمن السياسة' });
    expect(approved.status).toBe(200);
    expect(approved.body.approval.approvedByName).toBe('abdullah');
    expect(await Notification.exists({ userId: u.reem._id, type: 'sales.quote.decided' })).toBeTruthy();
    // Customer-facing document: net prices only — no list price, discount or previous price anywhere.
    const doc = await request(app()).get(`/api/v1/sales/quotes/${id}/document`).set(auth(t.reem));
    expect(doc.status).toBe(200);
    expect(doc.text).toContain('570');
    expect(doc.text).not.toContain('60,000');
    expect(doc.text).not.toMatch(/خصم|discount|listPrice/);
    // Sending: the mailbox adapter is disabled (Q5) → the message is kept as an unsent draft with a mailto link; the opportunity moves to «عرض سعر مرسل».
    const sent = await request(app())
      .post(`/api/v1/sales/quotes/${id}/send`)
      .set(auth(t.reem))
      .send({ to: ['ahmed@gulfpack.example'] });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.state).toBe('sent');
    expect(sent.body.emailState).toBe('draft_unsent');
    expect(sent.body.mailto).toMatch(/^mailto:ahmed@gulfpack\.example/);
    expect((await EmailMessage.findOne({ recordType: 'quote', recordId: id }))!.state).toBe('draft_unsent');
    expect((await Opportunity.findById(opportunityId))!.stage).toBe('quote_sent');
    expect(await Notification.exists({ userId: u.mgr._id, type: 'sales.quote.status' })).toBeTruthy();
    // The stored customer document is the same net-only HTML.
    const { Attachment } = await import('../../core/files/model');
    expect(await Attachment.exists({ _id: sent.body.documentAttachmentId, ownerType: 'quote' })).toBeTruthy();
    // Another rep sees nothing; the manager sees the internal fields; a rejection needs a reason from the list.
    expect((await request(app()).get(`/api/v1/sales/quotes/${id}`).set(auth(t.majed))).status).toBe(404);
    expect((await request(app()).get(`/api/v1/sales/quotes/${id}`).set(auth(t.mgr))).body.maxDiscountBp).toBe(
      500,
    );
    expect(
      (
        await request(app())
          .post(`/api/v1/sales/quotes/${id}/respond`)
          .set(auth(t.reem))
          .send({ response: 'rejected' })
      ).status,
    ).toBe(400);
    const rejected = await request(app())
      .post(`/api/v1/sales/quotes/${id}/respond`)
      .set(auth(t.reem))
      .send({ response: 'rejected', reason: 'السعر' });
    expect(rejected.body.state).toBe('rejected');
    // A revision carries the lines into a new draft version.
    const v2 = await request(app()).post(`/api/v1/sales/quotes/${id}/revise`).set(auth(t.reem));
    expect(v2.status).toBe(201);
    expect(v2.body.version).toBe(2);
    expect(v2.body.state).toBe('draft');
  });

  it('with limits set: within the rep limit auto-approves, above it the manager, above the manager the executive; every approval is logged with the approver', async () => {
    const { t, customerId, cardboardId } = await setup();
    await setSetting('sales.discountLimitBp', { rep: 500, manager: 1500 }, SYSTEM_ACTOR);
    const mk = async (bp: number) =>
      (
        await request(app())
          .post('/api/v1/sales/quotes')
          .set(auth(t.reem))
          .send({ customerId, lines: [{ itemId: cardboardId, quantity: 1, discountPercentBp: bp }] })
      ).body;
    const low = await mk(300);
    expect(
      (await request(app()).post(`/api/v1/sales/quotes/${low._id}/submit`).set(auth(t.reem))).body.state,
    ).toBe('approved');
    const mid = await mk(1000);
    expect(
      (await request(app()).post(`/api/v1/sales/quotes/${mid._id}/submit`).set(auth(t.reem))).body.approval
        .requiredLevel,
    ).toBe('manager');
    expect(
      (await request(app()).post(`/api/v1/sales/quotes/${mid._id}/approve`).set(auth(t.reem))).status,
    ).toBe(403); // the author never approves; another rep holds no level
    expect(
      (await request(app()).post(`/api/v1/sales/quotes/${mid._id}/approve`).set(auth(t.majed))).status,
    ).toBe(403);
    const midOk = await request(app()).post(`/api/v1/sales/quotes/${mid._id}/approve`).set(auth(t.mgr));
    expect(midOk.body.state).toBe('approved');
    expect(midOk.body.approval.approvedByName).toBe('sultan');
    expect(midOk.body.approval.approvedLevel).toBe('manager');
    const high = await mk(2000);
    expect(
      (await request(app()).post(`/api/v1/sales/quotes/${high._id}/submit`).set(auth(t.reem))).body.approval
        .requiredLevel,
    ).toBe('executive');
    expect(
      (await request(app()).post(`/api/v1/sales/quotes/${high._id}/approve`).set(auth(t.mgr))).status,
    ).toBe(403);
    const refused = await request(app())
      .post(`/api/v1/sales/quotes/${high._id}/reject-approval`)
      .set(auth(t.ceo))
      .send({ note: 'خصم مرتفع' });
    expect(refused.body.state).toBe('draft');
    expect(refused.body.events.map((e: { type: string }) => e.type)).toContain('approval_rejected');
    const { AuditLog } = await import('../../core/audit/model');
    expect(
      await AuditLog.countDocuments({ resource: 'sales.quotes', action: 'transition' }),
    ).toBeGreaterThanOrEqual(5);
  });

  it('acceptance → sales order; Finance registers the issued invoice (option A) with ZATCA fields, records payments; Sales reads only; notifications 11 and 12', async () => {
    const { t, u, customerId, cardboardId } = await setup();
    await setSetting('sales.discountLimitBp', { rep: 500, manager: 1500 }, SYSTEM_ACTOR);
    const q = (
      await request(app())
        .post('/api/v1/sales/quotes')
        .set(auth(t.reem))
        .send({ customerId, lines: [{ itemId: cardboardId, quantity: 2 }] })
    ).body;
    await request(app()).post(`/api/v1/sales/quotes/${q._id}/submit`).set(auth(t.reem));
    await request(app())
      .post(`/api/v1/sales/quotes/${q._id}/send`)
      .set(auth(t.reem))
      .send({ to: ['a@b.example'] });
    const signed = await upload(t.reem, 'signed.pdf');
    const accepted = await request(app())
      .post(`/api/v1/sales/quotes/${q._id}/respond`)
      .set(auth(t.reem))
      .send({ response: 'accepted', signedFileAttachmentId: signed });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body.state).toBe('accepted');
    expect(accepted.body.salesOrder.number).toMatch(/^SO-/);
    const orderId = accepted.body.salesOrder._id as string;
    const order = await request(app()).get(`/api/v1/sales/quotes/orders/${orderId}`).set(auth(t.reem));
    expect(order.body.lines[0]).toMatchObject({ unitPriceHalalas: 60_000_00, quantity: 2 });
    expect(order.body.lines[0].listPriceHalalas).toBeUndefined();
    // Sales cannot write any financial figure; Finance registers the invoice issued in the current system.
    const body = {
      salesOrderId: orderId,
      externalNumber: 'INV-2026-0042',
      issueDateTime: '2026-11-12T09:00:00+03:00',
      dueDate: '2026-12-12',
    };
    expect((await request(app()).post('/api/v1/finance/invoices').set(auth(t.reem)).send(body)).status).toBe(
      403,
    );
    expect((await request(app()).post('/api/v1/finance/invoices').set(auth(t.mgr)).send(body)).status).toBe(
      403,
    );
    const inv = await request(app()).post('/api/v1/finance/invoices').set(auth(t.shahad)).send(body);
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    expect(inv.body.number).toMatch(/^INV-/);
    expect(inv.body.totalHalalas).toBe(order.body.totalHalalas);
    expect(inv.body.customer.vatNumber).toBe('300123456700003');
    expect(inv.body.zatca).toMatchObject({ state: 'pending' });
    expect(inv.body.zatca.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(inv.body.collectionState).toBe('due');
    expect(await Notification.exists({ userId: u.reem._id, type: 'finance.invoice.issued' })).toBeTruthy();
    expect(
      (await request(app()).post('/api/v1/finance/invoices').set(auth(t.shahad)).send(body)).status,
    ).toBe(409); // same external number / order already invoiced
    expect(
      (await request(app()).get(`/api/v1/sales/quotes/orders/${orderId}`).set(auth(t.reem))).body.state,
    ).toBe('invoiced');
    // Sales reads its own invoices; another rep does not; payments are Finance's and append-only.
    expect((await request(app()).get('/api/v1/finance/invoices').set(auth(t.reem))).body.total).toBe(1);
    expect((await request(app()).get('/api/v1/finance/invoices').set(auth(t.majed))).body.total).toBe(0);
    expect(
      (
        await request(app())
          .post(`/api/v1/finance/invoices/${inv.body._id}/payments`)
          .set(auth(t.reem))
          .send({ amountHalalas: 1 })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app())
          .post(`/api/v1/finance/invoices/${inv.body._id}/payments`)
          .set(auth(t.abdulaziz))
          .send({ amountHalalas: inv.body.totalHalalas + 1 })
      ).status,
    ).toBe(400);
    const part = await request(app())
      .post(`/api/v1/finance/invoices/${inv.body._id}/payments`)
      .set(auth(t.abdulaziz))
      .send({ amountHalalas: 50_000_00, method: 'bank_transfer', reference: 'TRX-1' });
    expect(part.body.collectionState).toBe('partially_collected');
    const rest = await request(app())
      .post(`/api/v1/finance/invoices/${inv.body._id}/payments`)
      .set(auth(t.abdulaziz))
      .send({ amountHalalas: inv.body.totalHalalas - 50_000_00 });
    expect(rest.body.collectionState).toBe('collected');
    expect(rest.body.remainingHalalas).toBe(0);
    expect(rest.body.payments).toHaveLength(2);
    expect(
      (await request(app()).get(`/api/v1/sales/quotes/orders/${orderId}`).set(auth(t.reem))).body.state,
    ).toBe('closed');
    // The customer copy carries net prices and the e-invoicing state; viewing is audited as sensitive.
    const doc = await request(app())
      .get(`/api/v1/finance/invoices/${inv.body._id}/document`)
      .set(auth(t.reem));
    expect(doc.text).toContain('INV-2026-0042');
    expect(doc.text).toContain('بانتظار الإرسال');
    // Overdue: a second invoice past due with a balance → notification 12 once.
    const q2 = (
      await request(app())
        .post('/api/v1/sales/quotes')
        .set(auth(t.reem))
        .send({ customerId, lines: [{ itemId: cardboardId, quantity: 1 }] })
    ).body;
    await request(app()).post(`/api/v1/sales/quotes/${q2._id}/submit`).set(auth(t.reem));
    await request(app())
      .post(`/api/v1/sales/quotes/${q2._id}/send`)
      .set(auth(t.reem))
      .send({ to: ['a@b.example'] });
    const acc2 = await request(app())
      .post(`/api/v1/sales/quotes/${q2._id}/respond`)
      .set(auth(t.reem))
      .send({ response: 'accepted' });
    const inv2 = await request(app()).post('/api/v1/finance/invoices').set(auth(t.shahad)).send({
      salesOrderId: acc2.body.salesOrder._id,
      externalNumber: 'INV-2026-0043',
      issueDateTime: '2026-10-01T09:00:00+03:00',
      dueDate: '2026-10-31',
    });
    expect(inv2.status).toBe(201);
    await Notification.deleteMany({ type: 'finance.invoice.overdue' });
    expect(await runInvoiceOverdueAlerts(new Date('2026-11-12T06:00:00.000Z'))).toEqual({ notified: 1 });
    expect(await runInvoiceOverdueAlerts(new Date('2026-11-12T07:00:00.000Z'))).toEqual({ notified: 0 });
    expect(await Notification.exists({ userId: u.reem._id, type: 'finance.invoice.overdue' })).toBeTruthy();
    expect((await Invoice.findById(inv2.body._id))!.collectionState).toBe('overdue');
    expect(
      (await request(app()).get('/api/v1/finance/invoices?overdue=true').set(auth(t.abdulaziz))).body.total,
    ).toBe(1);
  });

  it('contracts: schedule dates are tracked, a contract of a year or more alerts three months before the end and may issue a cooperation certificate from then; the alert fires once', async () => {
    const { t, u, customerId } = await setup();
    const c = await request(app())
      .post('/api/v1/sales/contracts')
      .set(auth(t.reem))
      .send({
        customerId,
        contractType: 'عقد نظافة سنوي',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        items: [
          { descriptionAr: 'جمع نفايات عامة', quantity: 48, unit: 'visit', agreedPriceHalalas: 300_00 },
        ],
        schedule: [{ plannedAt: '2026-11-20T06:00:00.000Z', kind: 'pickup' }],
      });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body.number).toMatch(/^CNT-/);
    expect(c.body.yearOrMore).toBe(true);
    expect(c.body.durationMonths).toBe(12);
    const id = c.body._id as string;
    // Not yet in the certificate window on 2026-09-01; inside it on 2026-11-12 (90 days before 2026-12-31 = 2026-10-02).
    expect(c.body.canCertify).toBe(true);
    const short = await request(app())
      .post('/api/v1/sales/contracts')
      .set(auth(t.reem))
      .send({ customerId, startDate: '2026-11-01', endDate: '2026-11-30' });
    expect(
      (await request(app()).post(`/api/v1/sales/contracts/${short.body._id}/certificates`).set(auth(t.reem)))
        .status,
    ).toBe(400);
    // Schedule tracking [SAL §7.4]
    const added = await request(app())
      .post(`/api/v1/sales/contracts/${id}/schedule`)
      .set(auth(t.reem))
      .send({ plannedAt: '2026-12-05T06:00:00.000Z', kind: 'delivery' });
    expect(added.body.schedule).toHaveLength(2);
    const done = await request(app())
      .post(`/api/v1/sales/contracts/${id}/schedule/${added.body.schedule[0]._id}/status`)
      .set(auth(t.reem))
      .send({ status: 'done', note: 'تم الاستلام' });
    expect(done.body.schedule[0].status).toBe('done');
    expect(done.body.events.map((e: { type: string }) => e.type)).toContain('schedule_status');
    // Alert job: 90 days before the end → «اقتراب انتهاء عقد» to Sales and «اقتراب موعد تجديد التعاون» to the owner, once.
    await Notification.deleteMany({});
    expect((await runContractAlerts(new Date('2026-10-05T06:00:00.000Z'))).expiring).toBe(1);
    expect((await runContractAlerts(new Date('2026-10-06T06:00:00.000Z'))).expiring).toBe(0);
    expect(await Notification.exists({ userId: u.mgr._id, type: 'sales.contract.expiring' })).toBeTruthy();
    expect(
      await Notification.exists({ userId: u.reem._id, type: 'sales.contract.renewal_due' }),
    ).toBeTruthy();
    expect((await SalesContract.findById(id))!.state).toBe('expiring');
    // Certificate: numbered CRT, stored, with a send log through the (disabled) mailbox adapter.
    const cert = await request(app()).post(`/api/v1/sales/contracts/${id}/certificates`).set(auth(t.reem));
    expect(cert.status, JSON.stringify(cert.body)).toBe(201);
    expect(cert.body.certificates[0].number).toMatch(/^CRT-/);
    const sentCert = await request(app())
      .post(`/api/v1/sales/contracts/${id}/certificates/${cert.body.certificates[0]._id}/send`)
      .set(auth(t.reem))
      .send({ to: ['ahmed@gulfpack.example'] });
    expect(sentCert.status).toBe(200);
    expect(sentCert.body.certificates[0].sendLog).toHaveLength(1);
    expect(sentCert.body.emailState).toBe('draft_unsent');
    // Another rep sees nothing; the manager sees it; past the end the contract expires.
    expect((await request(app()).get(`/api/v1/sales/contracts/${id}`).set(auth(t.majed))).status).toBe(404);
    expect((await request(app()).get(`/api/v1/sales/contracts/${id}`).set(auth(t.mgr))).status).toBe(200);
    expect((await runContractAlerts(new Date('2027-01-02T06:00:00.000Z'))).expired).toBe(2); // the year contract and the short one
    // Renewal: a new contract linked to the old one, which is marked renewed.
    const renewed = await request(app())
      .post(`/api/v1/sales/contracts/${id}/renew`)
      .set(auth(t.reem))
      .send({ startDate: '2027-01-01', endDate: '2027-12-31', items: [] });
    expect(renewed.status).toBe(201);
    expect(renewed.body.renewalOf).toBe(id);
    expect((await SalesContract.findById(id))!.state).toBe('renewed');
  });

  it('S3 fix 3: a quote whose author is the only holder of the required level escalates to the executive at submit; the executive may decide any level and the acting level is recorded', async () => {
    const { t, u, customerId, cardboardId } = await setup();
    await setSetting('sales.discountLimitBp', { rep: 500, manager: 1500 }, SYSTEM_ACTOR);
    // The Sales manager's own quote at 10% needs the manager level — but the manager is the author.
    const own = (
      await request(app())
        .post('/api/v1/sales/quotes')
        .set(auth(t.mgr))
        .send({ customerId, lines: [{ itemId: cardboardId, quantity: 1, discountPercentBp: 1000 }] })
    ).body;
    expect(own.approval.requiredLevel).toBe('manager');
    await Notification.deleteMany({});
    const submitted = await request(app()).post(`/api/v1/sales/quotes/${own._id}/submit`).set(auth(t.mgr));
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect(submitted.body.state).toBe('pending_approval');
    expect(submitted.body.approval).toMatchObject({
      requiredLevel: 'executive',
      escalatedFrom: 'manager',
      escalationReason: 'author_is_only_approver',
    });
    expect(
      await Notification.exists({ userId: u.ceo._id, type: 'sales.quote.approval_requested' }),
    ).toBeTruthy();
    expect(
      await Notification.exists({ userId: u.mgr._id, type: 'sales.quote.approval_requested' }),
    ).toBeFalsy();
    // The author cannot approve; the executive can, and the level acted at is kept.
    expect(
      (await request(app()).post(`/api/v1/sales/quotes/${own._id}/approve`).set(auth(t.mgr))).status,
    ).toBe(403);
    expect(
      (await request(app()).get(`/api/v1/sales/quotes/${own._id}`).set(auth(t.mgr))).body.canApprove,
    ).toBe(false);
    expect(
      (await request(app()).get(`/api/v1/sales/quotes/${own._id}`).set(auth(t.ceo))).body.canApprove,
    ).toBe(true);
    const approved = await request(app()).post(`/api/v1/sales/quotes/${own._id}/approve`).set(auth(t.ceo));
    expect(approved.body.state).toBe('approved');
    expect(approved.body.approval).toMatchObject({ approvedLevel: 'executive', approvedByName: 'abdullah' });
    // A rep's manager-level quote is not escalated (the manager is a different person) …
    const reps = (
      await request(app())
        .post('/api/v1/sales/quotes')
        .set(auth(t.reem))
        .send({ customerId, lines: [{ itemId: cardboardId, quantity: 1, discountPercentBp: 1000 }] })
    ).body;
    const sub2 = await request(app()).post(`/api/v1/sales/quotes/${reps._id}/submit`).set(auth(t.reem));
    expect(sub2.body.approval.requiredLevel).toBe('manager');
    expect(sub2.body.approval.escalatedFrom).toBeUndefined();
    // … yet the executive may still decide it as the higher authority, and that is recorded as the executive level.
    const byCeo = await request(app()).post(`/api/v1/sales/quotes/${reps._id}/approve`).set(auth(t.ceo));
    expect(byCeo.body.state).toBe('approved');
    expect(byCeo.body.approval.approvedLevel).toBe('executive');
    const { AuditLog } = await import('../../core/audit/model');
    expect(await AuditLog.exists({ resource: 'sales.quotes', 'meta.escalatedFrom': 'manager' })).toBeTruthy();
  });

  it('S3 fix 1: several invoices per order (sum ≤ order total, 400 above it) and the order closes when fully invoiced and collected; actual figures that differ from the prefilled ones need a reason, kept in the audit and shown to Sales', async () => {
    const { t, customerId, cardboardId } = await setup();
    const q = (
      await request(app())
        .post('/api/v1/sales/quotes')
        .set(auth(t.reem))
        .send({ customerId, lines: [{ itemId: cardboardId, quantity: 2 }] })
    ).body;
    await request(app()).post(`/api/v1/sales/quotes/${q._id}/submit`).set(auth(t.reem));
    await request(app())
      .post(`/api/v1/sales/quotes/${q._id}/send`)
      .set(auth(t.reem))
      .send({ to: ['a@b.example'] });
    const acc = await request(app())
      .post(`/api/v1/sales/quotes/${q._id}/respond`)
      .set(auth(t.reem))
      .send({ response: 'accepted' });
    const orderId = acc.body.salesOrder._id as string;
    const orderTotal = acc.body.totalHalalas as number; // 2 × 60,000 + 15% = 138,000 SAR
    // Prefill comes from the order; Sales cannot ask for it.
    expect(
      (
        await request(app())
          .post('/api/v1/finance/invoices/prefill')
          .set(auth(t.reem))
          .send({ salesOrderId: orderId })
      ).status,
    ).toBe(403);
    const pre = await request(app())
      .post('/api/v1/finance/invoices/prefill')
      .set(auth(t.shahad))
      .send({ salesOrderId: orderId });
    expect(pre.status, JSON.stringify(pre.body)).toBe(200);
    expect(pre.body).toMatchObject({ source: 'order', remainingHalalas: orderTotal });
    expect(pre.body.totals.totalHalalas).toBe(orderTotal);
    // Order or contract, never both or neither.
    expect(
      (await request(app()).post('/api/v1/finance/invoices/prefill').set(auth(t.shahad)).send({})).status,
    ).toBe(400);
    // First instalment: the issued invoice carries half the order — a difference from the prefilled total → reason required.
    const half = {
      subtotalHalalas: 60_000_00,
      vatTotalHalalas: 9_000_00,
      totalHalalas: 69_000_00,
    };
    const base = { salesOrderId: orderId, issueDateTime: '2026-11-12T09:00:00+03:00', dueDate: '2026-12-12' };
    const noReason = await request(app())
      .post('/api/v1/finance/invoices')
      .set(auth(t.shahad))
      .send({ ...base, externalNumber: 'X-1', totals: half });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.details?.[0]?.path).toBe('differenceReason');
    const first = await request(app())
      .post('/api/v1/finance/invoices')
      .set(auth(t.shahad))
      .send({
        ...base,
        externalNumber: 'X-1',
        lines: [
          { descriptionAr: 'كرتون — الدفعة الأولى', unit: 'ton', quantity: 1, unitPriceHalalas: 60_000_00 },
        ],
        differenceReason: 'فاتورة الدفعة الأولى (نصف الكمية)',
      });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.totalHalalas).toBe(69_000_00);
    expect(first.body.prefilled.totalHalalas).toBe(orderTotal);
    expect(first.body.difference).toMatchObject({
      halalas: 69_000_00 - orderTotal,
      reason: 'فاتورة الدفعة الأولى (نصف الكمية)',
    });
    const order1 = await request(app()).get(`/api/v1/sales/quotes/orders/${orderId}`).set(auth(t.reem));
    expect(order1.body).toMatchObject({ state: 'partially_invoiced', invoicedHalalas: 69_000_00 });
    // Sales sees the difference and its reason read-only; the audit keeps it.
    const asSales = await request(app()).get(`/api/v1/finance/invoices/${first.body._id}`).set(auth(t.reem));
    expect(asSales.body.difference.reason).toBe('فاتورة الدفعة الأولى (نصف الكمية)');
    const { AuditLog } = await import('../../core/audit/model');
    expect(
      await AuditLog.exists({
        resource: 'finance.invoices',
        action: 'create',
        'after.difference.reason': 'فاتورة الدفعة الأولى (نصف الكمية)',
      }),
    ).toBeTruthy();
    // Prefill now shows the remaining half; more than the remaining is refused.
    const pre2 = (
      await request(app())
        .post('/api/v1/finance/invoices/prefill')
        .set(auth(t.shahad))
        .send({ salesOrderId: orderId })
    ).body;
    expect(pre2.remainingHalalas).toBe(orderTotal - 69_000_00);
    expect(pre2.totals).toEqual(half);
    expect(pre2.previousInvoices).toHaveLength(1);
    const tooMuch = await request(app())
      .post('/api/v1/finance/invoices')
      .set(auth(t.shahad))
      .send({
        ...base,
        externalNumber: 'X-2',
        totals: { subtotalHalalas: 60_000_01, vatTotalHalalas: 9_000_00, totalHalalas: 69_000_01 },
        differenceReason: 'تقريب',
      });
    expect(tooMuch.status).toBe(400);
    // Second instalment = the prefilled remainder (no reason needed).
    const second = await request(app())
      .post('/api/v1/finance/invoices')
      .set(auth(t.shahad))
      .send({ ...base, externalNumber: 'X-2' });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.body.totalHalalas).toBe(orderTotal - 69_000_00);
    expect(second.body.difference).toBeUndefined();
    expect(
      (await request(app()).get(`/api/v1/sales/quotes/orders/${orderId}`).set(auth(t.reem))).body.state,
    ).toBe('invoiced');
    // Nothing more can be invoiced on it.
    expect(
      (
        await request(app())
          .post('/api/v1/finance/invoices/prefill')
          .set(auth(t.shahad))
          .send({ salesOrderId: orderId })
      ).status,
    ).toBe(409);
    // The order closes only when every invoice is collected.
    await request(app())
      .post(`/api/v1/finance/invoices/${first.body._id}/payments`)
      .set(auth(t.abdulaziz))
      .send({ amountHalalas: 69_000_00 });
    expect(
      (await request(app()).get(`/api/v1/sales/quotes/orders/${orderId}`).set(auth(t.reem))).body.state,
    ).toBe('invoiced');
    await request(app())
      .post(`/api/v1/finance/invoices/${second.body._id}/payments`)
      .set(auth(t.abdulaziz))
      .send({ amountHalalas: orderTotal - 69_000_00 });
    expect(
      (await request(app()).get(`/api/v1/sales/quotes/orders/${orderId}`).set(auth(t.reem))).body.state,
    ).toBe('closed');
    expect(
      (await request(app()).get(`/api/v1/finance/invoices?salesOrderId=${orderId}`).set(auth(t.reem))).body
        .total,
    ).toBe(2);
  });

  it('S3 fix 1: a periodic contract is invoiced per period from the quantities recorded on its completed schedule entries; two monthly invoices; an entry is never invoiced twice', async () => {
    const { t, u, customerId, visitId } = await setup();
    const c = await request(app())
      .post('/api/v1/sales/contracts')
      .set(auth(t.reem))
      .send({
        customerId,
        contractType: 'عقد نظافة سنوي',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        items: [
          {
            itemId: visitId,
            descriptionAr: 'زيارة جمع',
            quantity: 48,
            unit: 'visit',
            agreedPriceHalalas: 300_00,
          },
          { descriptionAr: 'كرتون مجمَّع', unit: 'kg', agreedPriceHalalas: 50 },
        ],
        schedule: [
          { plannedAt: '2026-10-05T06:00:00.000Z', kind: 'pickup' },
          { plannedAt: '2026-10-19T06:00:00.000Z', kind: 'pickup' },
          { plannedAt: '2026-11-02T06:00:00.000Z', kind: 'pickup' },
          { plannedAt: '2026-11-16T06:00:00.000Z', kind: 'pickup' },
        ],
      });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const id = c.body._id as string;
    const entries = c.body.schedule as { _id: string }[];
    const done = (i: number, body: Record<string, unknown>) =>
      request(app())
        .post(`/api/v1/sales/contracts/${id}/schedule/${entries[i]._id}/status`)
        .set(auth(t.reem))
        .send({ status: 'done', ...body });
    // October: two visits, 120 kg and 80 kg of cardboard recorded on them.
    expect(
      (
        await done(0, {
          doneAt: '2026-10-05T07:00:00.000Z',
          quantities: [
            { itemId: visitId, quantity: 1 },
            { descriptionAr: 'كرتون مجمَّع', quantity: 120 },
          ],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await done(1, {
          doneAt: '2026-10-19T07:00:00.000Z',
          quantities: [
            { itemId: visitId, quantity: 1 },
            { descriptionAr: 'كرتون مجمَّع', quantity: 80 },
          ],
        })
      ).status,
    ).toBe(200);
    // November: one visit done without recorded quantities (counts one visit, no cardboard); the other still planned.
    expect((await done(2, { doneAt: '2026-11-02T07:00:00.000Z' })).status).toBe(200);
    // Nothing done in September.
    expect(
      (
        await request(app())
          .post('/api/v1/finance/invoices/prefill')
          .set(auth(t.shahad))
          .send({ contractId: id, periodFrom: '2026-09-01', periodTo: '2026-09-30' })
      ).status,
    ).toBe(400);
    // Contract needs a period or entries.
    expect(
      (
        await request(app())
          .post('/api/v1/finance/invoices/prefill')
          .set(auth(t.shahad))
          .send({ contractId: id })
      ).status,
    ).toBe(400);
    const octPre = await request(app())
      .post('/api/v1/finance/invoices/prefill')
      .set(auth(t.shahad))
      .send({ contractId: id, periodFrom: '2026-10-01', periodTo: '2026-10-31' });
    expect(octPre.status, JSON.stringify(octPre.body)).toBe(200);
    expect(octPre.body.source).toBe('contract');
    expect(octPre.body.scheduleEntryIds).toEqual([entries[0]._id, entries[1]._id]);
    expect(octPre.body.lines).toEqual([
      expect.objectContaining({
        descriptionAr: 'زيارة جمع',
        quantity: 2,
        unitPriceHalalas: 300_00,
        lineTotalHalalas: 600_00,
        vatHalalas: 90_00,
      }),
      expect.objectContaining({
        descriptionAr: 'كرتون مجمَّع',
        quantity: 200,
        unitPriceHalalas: 50,
        lineTotalHalalas: 100_00,
        vatHalalas: 15_00,
      }),
    ]);
    expect(octPre.body.totals).toEqual({
      subtotalHalalas: 700_00,
      vatTotalHalalas: 105_00,
      totalHalalas: 805_00,
    });
    const oct = await request(app())
      .post('/api/v1/finance/invoices')
      .set(auth(t.shahad))
      .send({
        contractId: id,
        periodFrom: '2026-10-01',
        periodTo: '2026-10-31',
        externalNumber: 'C-OCT',
        issueDateTime: '2026-11-01T09:00:00+03:00',
        dueDate: '2026-12-01',
      });
    expect(oct.status, JSON.stringify(oct.body)).toBe(201);
    expect(oct.body).toMatchObject({
      source: 'contract',
      contractId: id,
      totalHalalas: 805_00,
      scheduleEntryIds: [entries[0]._id, entries[1]._id],
    });
    expect(oct.body.customer.vatNumber).toBe('300123456700003');
    expect(await Notification.exists({ userId: u.reem._id, type: 'finance.invoice.issued' })).toBeTruthy();
    // The October entries are now marked invoiced and locked; invoicing them again is refused (period or explicit ids).
    const after = await request(app()).get(`/api/v1/sales/contracts/${id}`).set(auth(t.reem));
    expect(after.body.schedule[0].invoiceId).toBe(oct.body._id);
    expect(after.body.events.map((e: { type: string }) => e.type)).toContain('invoiced');
    expect((await done(0, { note: 'تعديل بعد الفوترة' })).status).toBe(409);
    expect(
      (
        await request(app())
          .post('/api/v1/finance/invoices/prefill')
          .set(auth(t.shahad))
          .send({ contractId: id, periodFrom: '2026-10-01', periodTo: '2026-10-31' })
      ).status,
    ).toBe(400); // nothing un-invoiced left in October
    expect(
      (
        await request(app())
          .post('/api/v1/finance/invoices/prefill')
          .set(auth(t.shahad))
          .send({ contractId: id, scheduleEntryIds: [entries[0]._id] })
      ).status,
    ).toBe(409);
    // A planned (not done) entry cannot be invoiced by id.
    expect(
      (
        await request(app())
          .post('/api/v1/finance/invoices/prefill')
          .set(auth(t.shahad))
          .send({ contractId: id, scheduleEntryIds: [entries[3]._id] })
      ).status,
    ).toBe(400);
    // November: the one completed visit, by explicit entry.
    const nov = await request(app())
      .post('/api/v1/finance/invoices')
      .set(auth(t.shahad))
      .send({
        contractId: id,
        scheduleEntryIds: [entries[2]._id],
        externalNumber: 'C-NOV',
        issueDateTime: '2026-12-01T09:00:00+03:00',
        dueDate: '2026-12-31',
      });
    expect(nov.status, JSON.stringify(nov.body)).toBe(201);
    expect(nov.body.lines).toHaveLength(1);
    expect(nov.body.totals ?? nov.body.totalHalalas).toBe(345_00);
    expect(
      (await request(app()).get(`/api/v1/finance/invoices?contractId=${id}`).set(auth(t.reem))).body.total,
    ).toBe(2);
    expect(
      (await request(app()).get(`/api/v1/finance/invoices?contractId=${id}`).set(auth(t.majed))).body.total,
    ).toBe(0);
  });

  it('S3 fix 2: two Finance users registering the full order at the same moment → one 201 and one 409, one invoice on the order', async () => {
    const { t, customerId, cardboardId } = await setup();
    const q = (
      await request(app())
        .post('/api/v1/sales/quotes')
        .set(auth(t.reem))
        .send({ customerId, lines: [{ itemId: cardboardId, quantity: 1 }] })
    ).body;
    await request(app()).post(`/api/v1/sales/quotes/${q._id}/submit`).set(auth(t.reem));
    await request(app())
      .post(`/api/v1/sales/quotes/${q._id}/send`)
      .set(auth(t.reem))
      .send({ to: ['a@b.example'] });
    const acc = await request(app())
      .post(`/api/v1/sales/quotes/${q._id}/respond`)
      .set(auth(t.reem))
      .send({ response: 'accepted' });
    const orderId = acc.body.salesOrder._id as string;
    const base = { salesOrderId: orderId, issueDateTime: '2026-11-12T09:00:00+03:00', dueDate: '2026-12-12' };
    const results = await Promise.all([
      request(app())
        .post('/api/v1/finance/invoices')
        .set(auth(t.shahad))
        .send({ ...base, externalNumber: 'R-1' }),
      request(app())
        .post('/api/v1/finance/invoices')
        .set(auth(t.abdulaziz))
        .send({ ...base, externalNumber: 'R-2' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await Invoice.countDocuments({ salesOrderId: orderId })).toBe(1);
    const order = await request(app()).get(`/api/v1/sales/quotes/orders/${orderId}`).set(auth(t.reem));
    expect(order.body.invoiceIds).toHaveLength(1);
    expect(order.body).toMatchObject({ state: 'invoiced', invoicedHalalas: order.body.totalHalalas });
  });
});
