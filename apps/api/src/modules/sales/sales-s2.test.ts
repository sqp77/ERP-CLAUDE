import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { DEFAULT_SALES_TAGS, SALES_SERVICE_TYPES } from '@eayni/shared';
import { auth, loginAs, makeDepartment, makeUser, testApp } from '../../test/helpers';
import { setSetting } from '../../core/settings/service';
import { SYSTEM_ACTOR } from '../../core/http/context';
import { ensureDefaultTags } from '../../core/tags/service';
import { Notification } from '../../core/notifications/model';
import { StageLog } from '../../core/workflow/model';
import { Holiday } from '../../core/dates/model';
import { CalendarEvent } from '../../core/calendar/model';
import { Attachment } from '../../core/files/model';
import { Outbox } from '../../core/outbox/model';
import { SalesRequest } from './requests.model';
import { runRequestOverdueAlerts } from './requests.service';
import { SALES_WORKFLOWS } from './workflows';

const app = () => testApp();

/** Sales (manager + two reps), Procurement, Finance (manager + staff), Operations (manager + staff), an outsider. */
async function setup() {
  await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
  await ensureDefaultTags('sales', DEFAULT_SALES_TAGS);
  const d = {
    sales: await makeDepartment('sales', 'المبيعات'),
    procurement: await makeDepartment('procurement', 'المشتريات'),
    finance: await makeDepartment('finance', 'المالية'),
    ops: await makeDepartment('ops', 'التشغيل'),
    hr: await makeDepartment('hr', 'الموارد البشرية'),
  };
  const u = {
    mgr: await makeUser(
      'sultan@eayni.local',
      [{ role: 'employee' }, { role: 'department_manager', departmentId: String(d.sales._id) }],
      { departmentId: d.sales._id },
    ),
    reem: await makeUser('reem@eayni.local', [{ role: 'employee' }], { departmentId: d.sales._id }),
    majed: await makeUser('majed@eayni.local', [{ role: 'employee' }], { departmentId: d.sales._id }),
    nasser: await makeUser(
      'nasser@eayni.local',
      [{ role: 'employee' }, { role: 'department_manager', departmentId: String(d.procurement._id) }],
      { departmentId: d.procurement._id },
    ),
    talal: await makeUser('talal@eayni.local', [{ role: 'employee' }], { departmentId: d.procurement._id }),
    abdulaziz: await makeUser(
      'abdulaziz@eayni.local',
      [
        { role: 'employee' },
        { role: 'finance_manager' },
        { role: 'department_manager', departmentId: String(d.finance._id) },
      ],
      { departmentId: d.finance._id },
    ),
    shahad: await makeUser('shahad@eayni.local', [{ role: 'employee' }, { role: 'finance_staff' }], {
      departmentId: d.finance._id,
    }),
    khalid: await makeUser(
      'khalid@eayni.local',
      [{ role: 'employee' }, { role: 'department_manager', departmentId: String(d.ops._id) }],
      { departmentId: d.ops._id },
    ),
    omar: await makeUser('omar@eayni.local', [{ role: 'employee' }], { departmentId: d.ops._id }),
    noura: await makeUser('noura@eayni.local', [{ role: 'employee' }], { departmentId: d.hr._id }),
  };
  const t: Record<keyof typeof u, string> = {} as never;
  for (const k of Object.keys(u) as (keyof typeof u)[]) t[k] = await loginAs(u[k].email);
  const customer = await request(app())
    .post('/api/v1/crm/customers')
    .set(auth(t.reem))
    .send({ nameAr: 'شركة الخليج للتغليف', source: 'field_visits', phone: '0501234567' });
  expect(customer.status).toBe(201);
  return { d, u, t, customerId: customer.body._id as string };
}

async function upload(token: string, name = 'doc.pdf') {
  const pre = await request(app())
    .post('/api/v1/files/presign')
    .set(auth(token))
    .send({ fileName: name, mimeType: 'application/pdf', size: 11 });
  expect(pre.status).toBe(201);
  const u = new URL(pre.body.upload.url);
  await request(app())
    .put(u.pathname + u.search)
    .set('Content-Type', 'application/pdf')
    .send(Buffer.from('%PDF-1.4 ok'));
  await request(app()).post(`/api/v1/files/${pre.body.attachmentId}/complete`).set(auth(token));
  return pre.body.attachmentId as string;
}

const move = (token: string, id: string, transition: string, extra: Record<string, unknown> = {}) =>
  request(app())
    .post(`/api/v1/sales/requests/${id}/transition`)
    .set(auth(token))
    .send({ transition, ...extra });

describe('Sales S2 — service requests and the route between departments [SAL §5, §6, §14, §19]', () => {
  it('seven workflow definitions, one prefix per service, every request hangs off a customer', async () => {
    const { t, customerId } = await setup();
    expect(SALES_WORKFLOWS).toHaveLength(7);
    const prefixes: Record<string, string> = {
      containerSale: 'CSR',
      sortingContract: 'SRT',
      cleaningContract: 'CLN',
      destruction: 'DST',
      containerRental: 'RNT',
      scrap: 'SCR',
      assetReturn: 'ARO',
    };
    const details: Record<string, Record<string, unknown>> = {
      containerSale: { count: 10, containerType: 'حاوية 1100 لتر', color: 'أخضر' },
      sortingContract: { materialTypes: ['كرتون'], expectedQuantityKg: 5000 },
      cleaningContract: { mode: 'provide_container', containerCount: 2, visitCount: 8 },
      destruction: { materialType: 'أرشيف ورقي', estimatedQuantityKg: 800 },
      containerRental: { containerCount: 3, deliveryZone: 'inside_eastern', rentalDurationDays: 30 },
      scrap: { materialType: 'حديد', estimatedQuantityKg: 2000 },
      assetReturn: { tenderSource: 'منصة اعتماد', assetType: 'أثاث' },
    };
    for (const type of SALES_SERVICE_TYPES) {
      const r = await request(app())
        .post('/api/v1/sales/requests')
        .set(auth(t.reem))
        .send({ type, customerId, details: details[type] });
      expect(r.status, `${type}: ${JSON.stringify(r.body)}`).toBe(201);
      expect(r.body.number).toMatch(new RegExp(`^${prefixes[type]}-\\d{4}-\\d{5}$`));
      expect(r.body.holder).toBe('sales');
    }
    // A required service field is validated per type (rental needs the delivery zone and the count).
    expect(
      (
        await request(app())
          .post('/api/v1/sales/requests')
          .set(auth(t.reem))
          .send({ type: 'containerRental', customerId, details: { containerCount: 1 } })
      ).status,
    ).toBe(400);
    // Another rep's customer is invisible → 404; an outsider has no create right.
    expect(
      (
        await request(app())
          .post('/api/v1/sales/requests')
          .set(auth(t.majed))
          .send({ type: 'scrap', customerId, details: {} })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app())
          .post('/api/v1/sales/requests')
          .set(auth(t.noura))
          .send({ type: 'scrap', customerId, details: {} })
      ).status,
    ).toBe(403);
    expect((await request(app()).get('/api/v1/sales/requests').set(auth(t.reem))).body.total).toBe(7);
    expect((await request(app()).get('/api/v1/sales/requests').set(auth(t.majed))).body.total).toBe(0);
    expect((await request(app()).get('/api/v1/sales/requests').set(auth(t.mgr))).body.total).toBe(7);
  });

  it('container sale: Sales → Procurement → Finance (approver ≠ creator, needs-info loop) → execution → Operations (3 business days over a weekend and a holiday) → closed, with a stage log and notifications 7–10', async () => {
    const { t, u, customerId } = await setup();
    const r = await request(app())
      .post('/api/v1/sales/requests')
      .set(auth(t.reem))
      .send({ type: 'containerSale', customerId, details: { count: 50, containerType: 'حاوية 1100 لتر' } });
    const id = r.body._id as string;
    for (const step of ['start_quote', 'send_quote', 'customer_approve'])
      expect((await move(t.reem, id, step)).status, step).toBe(200);
    // Procurement does not even see the record while Sales holds it; Operations neither.
    expect((await move(t.talal, id, 'procurement_to_finance')).status).toBe(404);
    expect((await request(app()).get(`/api/v1/sales/requests/${id}`).set(auth(t.omar))).status).toBe(404);
    const sent = await move(t.reem, id, 'send_to_procurement');
    expect(sent.status).toBe(200);
    expect(sent.body.holder).toBe('procurement');
    expect(
      await Notification.exists({ userId: u.nasser._id, type: 'sales.request.to_procurement' }),
    ).toBeTruthy();
    expect(
      await Notification.exists({ userId: u.talal._id, type: 'sales.request.to_procurement' }),
    ).toBeTruthy();
    expect(await Outbox.exists({ type: 'sales.request.sent_to_procurement', aggregateId: id })).toBeTruthy();
    // The queue «الطلبات الواردة من المبيعات» of Procurement; the rep still sees her request read-only for that stage.
    const queue = await request(app()).get('/api/v1/sales/requests?view=incoming').set(auth(t.talal));
    expect(queue.body.items.map((x: { number: string }) => x.number)).toEqual([r.body.number]);
    expect(
      (await request(app()).get('/api/v1/sales/requests?view=incoming').set(auth(t.omar))).body.total,
    ).toBe(0);
    expect((await move(t.reem, id, 'procurement_to_finance')).status).toBe(403);
    const quote = await upload(t.talal, 'supplier-quote.pdf');
    const toFin = await move(t.talal, id, 'procurement_to_finance', {
      payload: { supplierName: 'مصنع الحاويات الوطني', supplierQuoteAttachmentIds: [quote] },
    });
    expect(toFin.status, JSON.stringify(toFin.body)).toBe(200);
    expect(toFin.body.procurement.supplierName).toBe('مصنع الحاويات الوطني');
    expect(
      await Notification.exists({ userId: u.abdulaziz._id, type: 'sales.request.to_finance' }),
    ).toBeTruthy();
    // Finance staff may ask for completion (change 4) but may not approve; the manager approves; Sales is told (notification 8).
    expect((await move(t.shahad, id, 'finance_approve')).status).toBe(403);
    const info = await move(t.shahad, id, 'finance_request_info', { reason: 'أرفقوا عرض المورد الثاني' });
    expect(info.status).toBe(200);
    expect(info.body.state).toBe('finance_needs_info');
    expect(info.body.holder).toBe('sales');
    expect(
      await Notification.exists({ userId: u.reem._id, type: 'sales.request.finance_decided' }),
    ).toBeTruthy();
    expect((await move(t.reem, id, 'finance_resubmit')).status).toBe(200);
    // Segregation: the creator may never decide — give reem the Finance role and try.
    await makeUser('reem2@eayni.local', [{ role: 'employee' }, { role: 'finance_manager' }], {
      departmentId: u.reem.departmentId,
    });
    const approved = await move(t.abdulaziz, id, 'finance_approve', { payload: { notes: 'ضمن الميزانية' } });
    expect(approved.status).toBe(200);
    expect(approved.body.state).toBe('execution_started');
    expect(approved.body.holder).toBe('procurement');
    expect(
      await Notification.countDocuments({ userId: u.reem._id, type: 'sales.request.finance_decided' }),
    ).toBe(2);
    expect(
      await Notification.exists({ userId: u.nasser._id, type: 'sales.request.finance_decided' }),
    ).toBeTruthy();
    // Procurement execution states (notification 9 to Sales), then hand-off to Operations.
    await Notification.deleteMany({ type: 'sales.request.procurement_updated' });
    expect(
      (
        await move(t.nasser, id, 'execution_progress', {
          payload: { deliveryDate: '2026-12-01T09:00:00+03:00' },
        })
      ).status,
    ).toBe(200);
    expect(
      await Notification.exists({ userId: u.reem._id, type: 'sales.request.procurement_updated' }),
    ).toBeTruthy();
    const receipt = await upload(t.nasser, 'receipt.pdf');
    expect(
      (await move(t.nasser, id, 'execution_done', { payload: { receiptFormAttachmentId: receipt } })).status,
    ).toBe(200);
    const toOps = await move(t.nasser, id, 'send_to_operations');
    expect(toOps.status).toBe(200);
    expect(toOps.body.state).toBe('ops_new');
    expect(toOps.body.stateAr).toBe('جديد');
    expect(
      await Notification.exists({ userId: u.khalid._id, type: 'sales.request.to_operations' }),
    ).toBeTruthy();
    // SLA: 3 business days over Fri–Sat and a holiday. Entered on a Wednesday 2026-11-04 → Thu 5, (Fri/Sat skipped), Sun 8 (holiday), Mon 9, Tue 10.
    await Holiday.create({ date: '2026-11-08', nameAr: 'عطلة تجريبية' });
    const entered = new Date('2026-11-04T07:00:00.000Z');
    const def = SALES_WORKFLOWS.find((w) => w.type === 'sales_request_containerSale')!;
    expect(def.states.ops_new.slaBusinessDays).toBe(3);
    const { addBusinessDays, loadHolidaySet } = await import('../../core/dates/businessDays');
    const due = addBusinessDays(entered, 3, await loadHolidaySet());
    expect(due.toISOString().slice(0, 10)).toBe('2026-11-10');
    // Overdue reminder fires once when the deadline passes.
    await SalesRequest.updateOne({ _id: id }, { $set: { stateEnteredAt: entered, dueAt: due } });
    expect(await runRequestOverdueAlerts(new Date('2026-11-11T05:00:00.000Z'))).toEqual({ notified: 1 });
    expect(await runRequestOverdueAlerts(new Date('2026-11-11T06:00:00.000Z'))).toEqual({ notified: 0 });
    expect(await Notification.exists({ userId: u.khalid._id, type: 'sales.request.overdue' })).toBeTruthy();
    expect(await Notification.exists({ userId: u.reem._id, type: 'sales.request.overdue' })).toBeTruthy();
    // Operations schedules (a calendar visit is created with the Sales owner as participant), executes and completes (notification 10).
    const scheduled = await move(t.omar, id, 'ops_schedule', {
      payload: { scheduledVisitAt: '2026-11-19T06:00:00.000Z' },
    });
    expect(scheduled.status, JSON.stringify(scheduled.body)).toBe(200);
    expect(scheduled.body.stateAr).toBe('مجدول');
    const ev = await CalendarEvent.findOne({ 'link.type': 'sales_request', 'link.id': id });
    expect(ev?.type).toBe('visit');
    expect(ev?.participantIds.map(String)).toContain(String(u.reem._id));
    // The overdue stage carries a delay reason with the responsible department [SAL §19].
    const detail = await request(app()).get(`/api/v1/sales/requests/${id}`).set(auth(t.mgr));
    const late = detail.body.stageLog.find((s: { overdue: boolean }) => s.overdue);
    expect(late).toBeTruthy();
    const reasoned = await request(app())
      .post(`/api/v1/sales/requests/${id}/stage-log/${late._id}/delay-reason`)
      .set(auth(t.mgr))
      .send({ delayReason: 'انتظار مركبة', responsibleDepartment: 'ops' });
    expect(reasoned.status).toBe(200);
    expect(await StageLog.exists({ _id: late._id, delayReason: 'انتظار مركبة' })).toBeTruthy();
    expect((await move(t.omar, id, 'ops_start')).status).toBe(200);
    const report = await upload(t.omar, 'delivery.pdf');
    const done = await move(t.omar, id, 'ops_complete', {
      payload: { quantitiesKg: 50000, deliveryReportAttachmentIds: [report] },
    });
    expect(done.status).toBe(200);
    expect(done.body.state).toBe('ops_completed');
    expect(done.body.holder).toBe('sales');
    expect(
      await Notification.exists({ userId: u.reem._id, type: 'sales.request.operations_completed' }),
    ).toBeTruthy();
    // Closing successfully notifies Operations [SAL §6.2]; the stage log has every hop.
    await Notification.deleteMany({ type: 'sales.request.closed' });
    const closed = await move(t.reem, id, 'close_success');
    expect(closed.status).toBe(200);
    expect(closed.body.closingOutcome).toBe('closed_success');
    expect(await Notification.exists({ userId: u.khalid._id, type: 'sales.request.closed' })).toBeTruthy();
    expect(await Outbox.exists({ type: 'sales.request.closed_success', aggregateId: id })).toBeTruthy();
    const stages = closed.body.stageLog.map((s: { toState: string }) => s.toState);
    expect(stages).toEqual([
      'quoting',
      'quote_sent',
      'customer_approved',
      'at_procurement',
      'at_finance',
      'finance_needs_info',
      'at_finance',
      'execution_started',
      'execution_in_progress',
      'execution_done',
      'ops_new',
      'ops_scheduled',
      'ops_in_progress',
      'ops_completed',
      'closed_success',
    ]);
    // Procurement keeps the closed request in its history view.
    expect(
      (
        await request(app())
          .get('/api/v1/sales/requests?view=incoming&includeHistory=true')
          .set(auth(t.talal))
      ).body.total,
    ).toBe(1);
    expect(
      (await request(app()).get('/api/v1/sales/requests?view=incoming').set(auth(t.talal))).body.total,
    ).toBe(0);
  });

  it('destruction: photos to Operations for an estimate, back to Sales for pricing, Finance, then Operations within 3 business days; a closing outcome needs a reason', async () => {
    const { t, customerId } = await setup();
    const photo = await upload(t.reem, 'photo.pdf');
    const r = await request(app())
      .post('/api/v1/sales/requests')
      .set(auth(t.reem))
      .send({
        type: 'destruction',
        customerId,
        details: { materialType: 'أرشيف', estimatedQuantityKg: 500 },
        photoIds: [photo],
      });
    const id = r.body._id as string;
    expect((await move(t.reem, id, 'send_for_estimate')).body.holder).toBe('ops');
    expect((await move(t.omar, id, 'estimate_done', { payload: {} })).status).toBe(400); // estimate required
    const est = await move(t.omar, id, 'estimate_done', {
      payload: { estimatedWeightKg: 620, estimatedQuantity: '40 صندوقًا' },
    });
    expect(est.status).toBe(200);
    expect(est.body.state).toBe('quoting');
    expect(est.body.operations.estimatedWeightKg).toBe(620);
    for (const step of ['send_quote', 'customer_approve', 'send_to_finance'])
      expect((await move(t.reem, id, step)).status, step).toBe(200);
    const fin = await move(t.abdulaziz, id, 'finance_approve');
    expect(fin.body.state).toBe('ops_new');
    expect(fin.body.dueAt).toBeTruthy();
    expect((await move(t.reem, id, 'close_incomplete')).status).toBe(400); // reason required
    expect((await move(t.reem, id, 'close_incomplete', { reason: 'العميل ألغى' })).status).toBe(200);
  });

  it('rental: straight to Operations, three separate inspection forms with photos, time, employee and condition; the container number becomes free text on the request', async () => {
    const { t, customerId } = await setup();
    const r = await request(app())
      .post('/api/v1/sales/requests')
      .set(auth(t.reem))
      .send({
        type: 'containerRental',
        customerId,
        details: {
          containerCount: 2,
          deliveryZone: 'outside_eastern',
          requestedDeliveryDate: '2026-12-01T09:00:00+03:00',
        },
      });
    const id = r.body._id as string;
    expect((await move(t.reem, id, 'send_to_operations')).body.holder).toBe('ops');
    expect(
      (
        await request(app())
          .post(`/api/v1/sales/requests/${id}/inspections`)
          .set(auth(t.omar))
          .send({ phase: 'before_delivery', photoIds: [], containerCondition: 'سليمة' })
      ).status,
    ).toBe(400); // photos required
    const photo = await upload(t.omar, 'c1.pdf');
    const insp = await request(app())
      .post(`/api/v1/sales/requests/${id}/inspections`)
      .set(auth(t.omar))
      .send({
        phase: 'before_delivery',
        photoIds: [photo],
        containerCondition: 'سليمة، خدوش خفيفة',
        containerNumber: 'C-0417',
        notes: 'جاهزة',
      });
    expect(insp.status, JSON.stringify(insp.body)).toBe(201);
    expect(insp.body.byName).toBe('omar');
    expect(insp.body.at).toBeTruthy();
    // No edit or delete route for an inspection.
    expect(
      (
        await request(app())
          .patch(`/api/v1/sales/requests/${id}/inspections/${insp.body._id}`)
          .set(auth(t.omar))
          .send({ notes: 'x' })
      ).status,
    ).toBe(404);
    const detail = await request(app()).get(`/api/v1/sales/requests/${id}`).set(auth(t.reem));
    expect(detail.body.inspections).toHaveLength(1);
    expect(detail.body.details.containerNumbers).toEqual(['C-0417']);
    // An HR user cannot file an inspection.
    expect(
      (
        await request(app())
          .post(`/api/v1/sales/requests/${id}/inspections`)
          .set(auth(t.noura))
          .send({ phase: 'after_delivery', photoIds: [photo], containerCondition: 'x' })
      ).status,
    ).toBe(403);
  });

  it('scrap: visible to Sales and Operations from the start, OPS §2.2 steps, «رفع مهمة» with حالة المهمة / حالة تحويل المبلغ, transfer needs proof and the allowed role, Finance is told', async () => {
    const { t, u, d, customerId } = await setup();
    const r = await request(app())
      .post('/api/v1/sales/requests')
      .set(auth(t.reem))
      .send({
        type: 'scrap',
        customerId,
        details: { materialType: 'حديد', estimatedQuantityKg: 3000, mobile: '0551234567' },
      });
    const id = r.body._id as string;
    // Operations sees a scrap request even before any hand-off [SAL §5.6].
    expect((await request(app()).get(`/api/v1/sales/requests/${id}`).set(auth(t.omar))).status).toBe(200);
    expect((await request(app()).get(`/api/v1/sales/requests/${id}`).set(auth(t.talal))).status).toBe(404);
    await Notification.deleteMany({});
    expect((await move(t.reem, id, 'request_visit')).status).toBe(200);
    expect(
      await Notification.exists({ userId: u.khalid._id, type: 'sales.request.to_operations' }),
    ).toBeTruthy();
    expect(
      (await move(t.omar, id, 'ops_schedule', { payload: { scheduledVisitAt: '2026-11-20T06:00:00.000Z' } }))
        .status,
    ).toBe(200);
    expect(await Notification.exists({ userId: u.reem._id, type: 'sales.request.updated' })).toBeTruthy(); // the other department hears about every status change
    const photo = await upload(t.omar, 'scrap.pdf');
    const assess = await request(app())
      .post(`/api/v1/sales/requests/${id}/assessments`)
      .set(auth(t.omar))
      .send({
        result: 'حديد نظيف',
        photoIds: [photo],
        estimatedWeightKg: 2800,
        categories: ['حديد'],
        proposedPriceHalalas: 90_000_00,
        nextAction: 'الاتفاق مع المبيعات',
      });
    expect(assess.status, JSON.stringify(assess.body)).toBe(201);
    expect(
      (
        await move(t.omar, id, 'record_assessment', {
          payload: { estimatedWeightKg: 2800, proposedPriceHalalas: 90_000_00 },
        })
      ).body.state,
    ).toBe('assessed');
    expect(
      (await move(t.omar, id, 'agree_price', { payload: { agreedPriceHalalas: 85_000_00 } })).status,
    ).toBe(403); // Sales agrees the price
    const agreed = await move(t.reem, id, 'agree_price', { payload: { agreedPriceHalalas: 85_000_00 } });
    expect(agreed.status).toBe(200);
    expect(agreed.body.details.agreedPriceHalalas).toBe(85_000_00);
    expect(
      (
        await move(t.omar, id, 'schedule_pickup', {
          payload: { scheduledVisitAt: '2026-11-22T06:00:00.000Z' },
        })
      ).status,
    ).toBe(200);
    expect((await move(t.omar, id, 'record_collection', { payload: { actualWeightKg: 2750 } })).status).toBe(
      400,
    ); // receipt report required
    const receipt = await upload(t.omar, 'receipt.pdf');
    await Notification.deleteMany({});
    const collected = await move(t.omar, id, 'record_collection', {
      payload: { actualWeightKg: 2750, receiptReportAttachmentIds: [receipt] },
    });
    expect(collected.status).toBe(200);
    expect(collected.body.scrap.actualWeightKg).toBe(2750);
    // «notify Sales and Finance» [OPS §2.2]
    expect(
      await Notification.exists({ userId: u.reem._id, type: 'sales.request.operations_completed' }),
    ).toBeTruthy();
    expect(
      await Notification.exists({ userId: u.abdulaziz._id, type: 'sales.request.operations_completed' }),
    ).toBeTruthy();
    // Transfer: proof required, role from `sales.scrapTransferRoles` (default: sales_manager, finance_*); the rep and Operations cannot.
    expect((await move(t.reem, id, 'record_transfer', { payload: {} })).status).toBe(403);
    expect((await move(t.omar, id, 'record_transfer', { payload: {} })).status).toBe(403);
    expect((await move(t.mgr, id, 'record_transfer', { payload: {} })).status).toBe(400);
    const proof = await upload(t.mgr, 'transfer.pdf');
    await Notification.deleteMany({});
    const transferred = await move(t.mgr, id, 'record_transfer', {
      payload: { transferProofAttachmentId: proof, transferredHalalas: 85_000_00 },
    });
    expect(transferred.status, JSON.stringify(transferred.body)).toBe(200);
    expect(transferred.body.scrap.transferStatus).toBe('transferred');
    expect(await Notification.exists({ userId: u.shahad._id, type: 'sales.scrap.transfer' })).toBeTruthy();
    expect((await Attachment.findById(proof))!.ownerType).toBe('sales_request');
    // «رفع مهمة»: a core task for an Operations employee with the scrap payload and the two statuses. The core task
    // rules read the HR employee file, so give omar one.
    const { Employee } = await import('../hr/model');
    await Employee.create({
      userId: u.omar._id,
      employeeNumber: 'EMP-T-1',
      firstNameAr: 'عمر',
      lastNameAr: 'عبدالرحمن',
      fullNameAr: 'عمر عبدالرحمن',
      gender: 'male',
      nationality: 'سعودي',
      identity: { type: 'national_id', numberEnc: 'x', last4: '0000' },
      workEmail: 'omar@eayni.local',
      departmentId: d.ops._id,
      hireDate: new Date('2024-01-01'),
      status: 'active',
    });
    const task = await request(app())
      .post(`/api/v1/sales/requests/${id}/tasks`)
      .set(auth(t.khalid))
      .send({
        assigneeUserId: String(u.omar._id),
        taskType: 'زيارة شراء',
        customersToContact: 3,
        visitAt: '2026-11-25T06:00:00.000Z',
        agreedPriceHalalas: 85_000_00,
      });
    expect(task.status, JSON.stringify(task.body)).toBe(201);
    expect(task.body.task.number).toMatch(/^TSK-/);
    expect(task.body.transferStatus).toBe('not_transferred');
    const detail = await request(app()).get(`/api/v1/sales/requests/${id}`).set(auth(t.reem));
    expect(detail.body.scrapTasks[0].taskStatus).toBe('not_done');
    expect(
      (
        await request(app())
          .patch(`/api/v1/sales/requests/${id}/tasks/${task.body._id}`)
          .set(auth(t.omar))
          .send({ transferStatus: 'transferred' })
      ).status,
    ).toBe(403);
    const marked = await request(app())
      .patch(`/api/v1/sales/requests/${id}/tasks/${task.body._id}`)
      .set(auth(t.omar))
      .send({ taskStatus: 'done' });
    expect(marked.status).toBe(200);
    expect(marked.body.scrapTasks[0].taskStatus).toBe('done');
    expect((await move(t.reem, id, 'close_success')).status).toBe(200);
  });

  it('asset return: the cooperation status is the state, «لم يتم التعاون» needs a reason, the next-conversation reminder fires', async () => {
    const { t, u, customerId } = await setup();
    const soon = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const r = await request(app())
      .post('/api/v1/sales/requests')
      .set(auth(t.reem))
      .send({
        type: 'assetReturn',
        customerId,
        details: { tenderSource: 'اعتماد', assetType: 'أثاث', nextConversationAt: soon },
      });
    expect(r.body.state).toBe('under_study');
    const id = r.body._id as string;
    const { runAssetReturnReminders } = await import('./requests.service');
    expect(await runAssetReturnReminders()).toEqual({ notified: 1 });
    expect(await runAssetReturnReminders()).toEqual({ notified: 0 });
    expect(
      await Notification.exists({ userId: u.reem._id, type: 'sales.assetreturn.reminder' }),
    ).toBeTruthy();
    expect((await move(t.reem, id, 'negotiate')).body.stateAr).toBe('قيد التفاوض');
    expect((await move(t.reem, id, 'decline')).status).toBe(400);
    const declined = await move(t.reem, id, 'decline', { reason: 'لم تُقبل المناقصة' });
    expect(declined.status).toBe(200);
    expect(declined.body.stateAr).toBe('لم يتم التعاون');
    expect(declined.body.assetReturn.nonCooperationReason).toBe('لم تُقبل المناقصة');
  });

  it('a rep cannot act on another rep’s request; the manager can; the executive reads only', async () => {
    const { t, customerId } = await setup();
    await makeUser('ceo@eayni.local', [{ role: 'employee' }, { role: 'executive' }]);
    const ceo = await loginAs('ceo@eayni.local');
    const r = await request(app())
      .post('/api/v1/sales/requests')
      .set(auth(t.reem))
      .send({ type: 'containerSale', customerId, details: { count: 1 } });
    const id = r.body._id as string;
    expect((await move(t.majed, id, 'start_quote')).status).toBe(404);
    expect((await move(ceo, id, 'start_quote')).status).toBe(403);
    expect((await request(app()).get(`/api/v1/sales/requests/${id}`).set(auth(ceo))).status).toBe(200);
    expect((await move(t.mgr, id, 'start_quote')).status).toBe(200);
    // Only the manager suspends or cancels a project [SAL §6.2].
    expect((await move(t.reem, id, 'suspend', { reason: 'x y' })).status).toBe(403);
    expect((await move(t.mgr, id, 'suspend', { reason: 'إيقاف مؤقت' })).body.stateAr).toBe(
      'تم إيقاف المشروع',
    );
    expect((await move(t.mgr, id, 'resume')).body.state).toBe('new');
  });
});
