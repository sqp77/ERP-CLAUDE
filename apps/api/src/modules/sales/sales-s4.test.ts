import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { DEFAULT_SALES_TAGS } from '@eayni/shared';
import { auth, loginAs, makeDepartment, makeUser, testApp } from '../../test/helpers';
import { setSetting } from '../../core/settings/service';
import { SYSTEM_ACTOR } from '../../core/http/context';
import { ensureDefaultTags } from '../../core/tags/service';
import { Notification } from '../../core/notifications/model';
import { processOutbox } from '../../core/outbox/service';
import { AuditLog } from '../../core/audit/model';
import { riyadhPeriod } from '../../core/kpi/service';
import { CommunicationLog, Customer } from '../crm/model';
import { SalesTargetVersion } from './management.model';
import { DiscussionEntry } from '../../core/discussions/model';

const app = () => testApp();

async function setup() {
  await setSetting('auth.mfaRequiredRoles', [], SYSTEM_ACTOR);
  await ensureDefaultTags('sales', DEFAULT_SALES_TAGS);
  const sales = await makeDepartment('sales', 'المبيعات');
  const finance = await makeDepartment('finance', 'المالية');
  const marketing = await makeDepartment('marketing', 'التسويق');
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
    lama: await makeUser('lama@eayni.local', [{ role: 'employee' }], { departmentId: marketing._id }),
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
      opportunity: { title: 'توريد كرتون' },
    });
  expect(customer.status).toBe(201);
  const cardboard = await request(app())
    .post('/api/v1/sales/pricelist/items')
    .set(auth(t.mgr))
    .send({ kind: 'material', nameAr: 'كرتون', category: 'ورق', unit: 'ton', priceHalalas: 60_000_00 });
  expect(cardboard.status, JSON.stringify(cardboard.body)).toBe(201);
  return {
    u,
    t,
    depts: { sales: String(sales._id), finance: String(finance._id), marketing: String(marketing._id) },
    customerId: customer.body._id as string,
    cardboardId: cardboard.body._id as string,
  };
}

async function upload(token: string, name = 'doc.pdf', mimeType = 'application/pdf') {
  const pre = await request(app())
    .post('/api/v1/files/presign')
    .set(auth(token))
    .send({ fileName: name, mimeType, size: 11 });
  const u = new URL(pre.body.upload.url);
  await request(app())
    .put(u.pathname + u.search)
    .set('Content-Type', mimeType)
    .send(Buffer.from('%PDF-1.4 ok'));
  await request(app()).post(`/api/v1/files/${pre.body.attachmentId}/complete`).set(auth(token));
  return pre.body.attachmentId as string;
}

/** Quote → sent → accepted → order → Finance registers the invoice now → optional full payment. */
async function soldAndInvoiced(
  ctx: Awaited<ReturnType<typeof setup>>,
  opts: { tons: number; externalNumber: string; pay?: boolean },
) {
  const { t, customerId, cardboardId } = ctx;
  await setSetting('sales.discountLimitBp', { rep: 500, manager: 1500 }, SYSTEM_ACTOR);
  const q = (
    await request(app())
      .post('/api/v1/sales/quotes')
      .set(auth(t.reem))
      .send({ customerId, lines: [{ itemId: cardboardId, quantity: opts.tons }] })
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
  const issued = new Date(Date.now() - 60_000);
  const inv = await request(app())
    .post('/api/v1/finance/invoices')
    .set(auth(t.shahad))
    .send({
      salesOrderId: accepted.body.salesOrder._id,
      externalNumber: opts.externalNumber,
      issueDateTime: issued.toISOString(),
      dueDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
    });
  expect(inv.status, JSON.stringify(inv.body)).toBe(201);
  if (opts.pay) {
    const paid = await request(app())
      .post(`/api/v1/finance/invoices/${inv.body._id}/payments`)
      .set(auth(t.abdulaziz))
      .send({ amountHalalas: inv.body.totalHalalas });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body.collectionState).toBe('collected');
  }
  return { quote: q, invoice: inv.body, period: riyadhPeriod(issued) };
}

/** A dashboard link (`/sales/customers?…`) opens the matching API list; its total must equal the card. */
function apiOf(link: string): string {
  const [path, query = ''] = link.split('?');
  const base: Record<string, string> = {
    '/sales/customers': '/api/v1/crm/customers',
    '/sales/pipeline': '/api/v1/sales/opportunities',
    '/sales/quotes': '/api/v1/sales/quotes',
    '/sales/invoices': '/api/v1/finance/invoices',
  };
  if (!base[path]) throw new Error(`no list for ${path}`);
  return `${base[path]}?${query}&limit=200`;
}

describe('Sales S4 — targets, KPIs, dashboard, library, discussions, calendar [SAL §8.2, §9, §10.3, §11, §13]', () => {
  it('targets: only the manager sets them; every change or withdrawal is a new version with reason and editor; the rep sees his own and is notified', async () => {
    const { u, t } = await setup();
    const period = riyadhPeriod();
    const base = { period, scope: 'user', userId: String(u.reem._id), value: 100_000_00 };
    expect(
      (await request(app()).post('/api/v1/sales/management/targets').set(auth(t.reem)).send(base)).status,
    ).toBe(403);
    expect(
      (await request(app()).post('/api/v1/sales/management/targets').set(auth(t.ceo)).send(base)).status,
    ).toBe(403);
    const v1 = await request(app()).post('/api/v1/sales/management/targets').set(auth(t.mgr)).send(base);
    expect(v1.status, JSON.stringify(v1.body)).toBe(201);
    expect(v1.body).toMatchObject({ version: 1, value: 100_000_00, previousValue: null });
    expect(await Notification.exists({ userId: u.reem._id, type: 'sales.target.changed' })).toBeTruthy();
    // A change needs a reason; the same value is refused; the old version stays.
    const noReason = await request(app())
      .post('/api/v1/sales/management/targets')
      .set(auth(t.mgr))
      .send({ ...base, value: 120_000_00 });
    expect(noReason.status).toBe(400);
    expect(
      (
        await request(app())
          .post('/api/v1/sales/management/targets')
          .set(auth(t.mgr))
          .send({ ...base, reason: 'لا تغيير' })
      ).status,
    ).toBe(400);
    const v2 = await request(app())
      .post('/api/v1/sales/management/targets')
      .set(auth(t.mgr))
      .send({ ...base, value: 120_000_00, reason: 'عميل جديد كبير' });
    expect(v2.status).toBe(201);
    expect(v2.body).toMatchObject({ version: 2, value: 120_000_00, previousValue: 100_000_00 });
    // A target for someone outside Sales is refused (assertSalesTarget).
    expect(
      (
        await request(app())
          .post('/api/v1/sales/management/targets')
          .set(auth(t.mgr))
          .send({ ...base, userId: String(u.shahad._id) })
      ).status,
    ).toBe(400);
    await request(app())
      .post('/api/v1/sales/management/targets')
      .set(auth(t.mgr))
      .send({ period, scope: 'user', userId: String(u.majed._id), value: 50_000_00 });
    await request(app())
      .post('/api/v1/sales/management/targets')
      .set(auth(t.mgr))
      .send({ period, scope: 'department', value: 300_000_00 });

    const mine = await request(app())
      .get(`/api/v1/sales/management/targets?period=${period}`)
      .set(auth(t.reem));
    expect(mine.status).toBe(200);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0]).toMatchObject({ value: 120_000_00, version: 2 });
    expect(mine.body.items[0].history).toHaveLength(2);
    expect(mine.body.items[0].history[0]).toMatchObject({ reason: 'عميل جديد كبير', byName: 'sultan' });
    const all = await request(app())
      .get(`/api/v1/sales/management/targets?period=${period}`)
      .set(auth(t.mgr));
    expect(all.body.items).toHaveLength(3);
    expect(
      (await request(app()).get(`/api/v1/sales/management/targets?period=${period}`).set(auth(t.ceo))).body
        .items,
    ).toHaveLength(3);

    // Withdrawal: a new version, reason required; the history keeps every value.
    expect(
      (
        await request(app())
          .post(`/api/v1/sales/management/targets/${v2.body._id}/withdraw`)
          .set(auth(t.mgr))
          .send({})
      ).status,
    ).toBe(400);
    const w = await request(app())
      .post(`/api/v1/sales/management/targets/${v2.body._id}/withdraw`)
      .set(auth(t.mgr))
      .send({ reason: 'انتقلت إلى مهمة أخرى' });
    expect(w.status).toBe(201);
    expect(w.body).toMatchObject({ version: 3, withdrawn: true });
    expect(await SalesTargetVersion.countDocuments({ userId: u.reem._id })).toBe(3);
    const after = await request(app())
      .get(`/api/v1/sales/management/targets?period=${period}`)
      .set(auth(t.mgr));
    expect(after.body.items).toHaveLength(2);
    expect(after.body.withdrawn).toHaveLength(1);
    expect(after.body.withdrawn[0]).toHaveLength(3);
    expect(await AuditLog.countDocuments({ resource: 'sales.targets' })).toBe(5);
  });

  it('KPIs come from Finance invoices only: no data before invoices; revenue before VAT, tons, conversion, price vs market, collection days; reps see their own', async () => {
    const ctx = await setup();
    const { t, cardboardId } = ctx;
    const empty = await request(app()).get('/api/v1/sales/management/kpi').set(auth(t.mgr));
    expect(empty.status).toBe(200);
    expect(empty.body.financeDataAvailable).toBe(false);
    expect(empty.body.kpis.find((k: { code: string }) => k.code === 'sales.revenue').status).toBe('no_data');

    await request(app())
      .post(`/api/v1/sales/pricelist/items/${cardboardId}/market`)
      .set(auth(t.mgr))
      .send({ priceHalalas: 58_000_00, source: 'سوق الدمام' });
    const { invoice, period } = await soldAndInvoiced(ctx, {
      tons: 2,
      externalNumber: 'INV-S4-1',
      pay: true,
    });
    await request(app())
      .post('/api/v1/sales/management/targets')
      .set(auth(t.mgr))
      .send({ period, scope: 'department', value: 200_000_00 });

    const kpi = await request(app()).get(`/api/v1/sales/management/kpi?period=${period}`).set(auth(t.mgr));
    expect(kpi.status, JSON.stringify(kpi.body)).toBe(200);
    const by = Object.fromEntries(kpi.body.kpis.map((k: { code: string }) => [k.code, k]));
    expect(by['sales.revenue']).toMatchObject({ actual: invoice.subtotalHalalas, target: 200_000_00 });
    expect(by['sales.revenue'].actual).toBe(120_000_00); // before VAT
    expect(by['sales.tons_sold'].actual).toBe(2000); // kilograms
    expect(by['sales.quote_conversion']).toMatchObject({ actual: 10_000, target: 4000, status: 'exceeded' });
    expect(by['sales.avg_price_per_ton']).toMatchObject({
      actual: 60_000_00,
      target: 58_000_00,
      status: 'exceeded',
    });
    expect(by['sales.avg_collection_days'].actual).toBeLessThanOrEqual(1);
    expect(by['sales.avg_collection_days'].status).toBe('exceeded');
    expect(kpi.body.materials[0]).toMatchObject({
      nameAr: 'كرتون',
      kg: 2000,
      marketPerTonHalalas: 58_000_00,
    });
    expect(kpi.body.board.quotesSent.value).toBe(1);
    expect(kpi.body.board.remaining.value).toBe(80_000_00);

    // The rep sees his own figures only; another rep sees none of reem's.
    const majed = await request(app())
      .get(`/api/v1/sales/management/kpi?period=${period}`)
      .set(auth(t.majed));
    expect(majed.body.kpis.find((k: { code: string }) => k.code === 'sales.revenue').actual).toBe(0);
    const reem = await request(app())
      .get(`/api/v1/sales/management/kpi?period=${period}&userId=${ctx.u.majed._id}`)
      .set(auth(t.reem));
    expect(reem.body.kpis.find((k: { code: string }) => k.code === 'sales.revenue').actual).toBe(120_000_00);
    // A service filter that matches nothing gives zero, not someone else's figure.
    const svc = await request(app())
      .get(`/api/v1/sales/management/kpi?period=${period}&serviceType=destruction`)
      .set(auth(t.mgr));
    expect(svc.body.kpis.find((k: { code: string }) => k.code === 'sales.revenue').actual).toBe(0);
  });

  it('dashboard: five groups, read-only budget, and every card equals the list it opens', async () => {
    const ctx = await setup();
    const { t } = ctx;
    const { period } = await soldAndInvoiced(ctx, { tons: 1, externalNumber: 'INV-S4-2' });
    expect((await request(app()).get('/api/v1/sales/management/dashboard').set(auth(t.shahad))).status).toBe(
      403,
    );
    for (const who of ['mgr', 'reem', 'ceo'] as const) {
      const d = await request(app())
        .get(`/api/v1/sales/management/dashboard?period=${period}`)
        .set(auth(t[who]));
      expect(d.status, JSON.stringify(d.body)).toBe(200);
      expect(d.body.budget).toMatchObject({ budgetsAvailable: false, spentHalalas: null });
      const cards: { value: number | null; link?: string }[] = [
        ...Object.values(d.body.customers as Record<string, { value: number; link: string }>),
        d.body.sales.won,
        d.body.sales.lost,
        d.body.opportunities.new,
        d.body.opportunities.quotesSent,
        d.body.opportunities.quotesAccepted,
        d.body.collection.invoices,
        d.body.collection.unpaid,
      ];
      for (const c of cards) {
        if (!c.link || c.value === null) continue;
        const list = await request(app()).get(apiOf(c.link)).set(auth(t[who]));
        expect(list.status, `${who} ${c.link}`).toBe(200);
        expect(list.body.total, `${who} ${c.link}`).toBe(c.value);
      }
      if (who === 'reem') expect(d.body.employees).toHaveLength(1);
      else expect(d.body.employees.length).toBeGreaterThanOrEqual(3);
    }
    const mgr = await request(app())
      .get(`/api/v1/sales/management/dashboard?period=${period}`)
      .set(auth(t.mgr));
    expect(mgr.body.collection.unpaid.value).toBe(1);
    expect(mgr.body.opportunities.quotesAccepted.value).toBe(1);
    // There is no write path for budget figures.
    expect(
      (await request(app()).post('/api/v1/sales/management/dashboard').set(auth(t.mgr)).send({})).status,
    ).toBe(404);
  });

  it('library: the manager uploads PDF procedures with versions; reps read; nobody else writes', async () => {
    const { t } = await setup();
    const pdf = await upload(t.mgr, 'procedure.pdf');
    const doc = { title: 'إجراء استقبال العملاء', category: 'procedure', attachmentId: pdf };
    const repFile = await upload(t.reem, 'x.pdf');
    expect(
      (
        await request(app())
          .post('/api/v1/sales/management/library')
          .set(auth(t.reem))
          .send({ ...doc, attachmentId: repFile })
      ).status,
    ).toBe(403);
    const png = await upload(t.mgr, 'photo.png', 'image/png');
    expect(
      (
        await request(app())
          .post('/api/v1/sales/management/library')
          .set(auth(t.mgr))
          .send({ ...doc, attachmentId: png })
      ).status,
    ).toBe(400);
    const v1 = await request(app()).post('/api/v1/sales/management/library').set(auth(t.mgr)).send(doc);
    expect(v1.status, JSON.stringify(v1.body)).toBe(201);
    const pdf2 = await upload(t.mgr, 'procedure-v2.pdf');
    const v2 = await request(app())
      .post('/api/v1/sales/management/library')
      .set(auth(t.mgr))
      .send({ ...doc, attachmentId: pdf2, replacesId: v1.body._id });
    expect(v2.status).toBe(201);
    expect(v2.body.version).toBe(2);
    // Replacing the old one again is refused: it already has a newer version.
    const pdf3 = await upload(t.mgr, 'procedure-v3.pdf');
    expect(
      (
        await request(app())
          .post('/api/v1/sales/management/library')
          .set(auth(t.mgr))
          .send({ ...doc, attachmentId: pdf3, replacesId: v1.body._id })
      ).status,
    ).toBe(409);
    const list = await request(app()).get('/api/v1/sales/management/library').set(auth(t.reem));
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ version: 2, versions: 2 });
    expect(list.body.canManage).toBe(false);
    const hist = await request(app())
      .get(`/api/v1/sales/management/library/${v2.body._id}/history`)
      .set(auth(t.reem));
    expect(hist.body.items).toHaveLength(2);
    // The file is readable through the library row (record access), also the old version's.
    expect((await request(app()).get(`/api/v1/files/${pdf}/url`).set(auth(t.reem))).status).toBe(200);
    expect((await request(app()).get(`/api/v1/files/${pdf2}/url`).set(auth(t.shahad))).status).toBe(403);
    expect(
      (await request(app()).delete(`/api/v1/sales/management/library/${v2.body._id}`).set(auth(t.reem)))
        .status,
    ).toBe(403);
    expect(
      (await request(app()).delete(`/api/v1/sales/management/library/${v2.body._id}`).set(auth(t.mgr)))
        .status,
    ).toBe(204);
    expect(
      (await request(app()).get('/api/v1/sales/management/library').set(auth(t.reem))).body.items,
    ).toHaveLength(0);
  });

  it('discussions: opened on a customer and routed to Finance; Finance is notified and answers; states follow SAL §10.3; outsiders get 404; closed is read-only', async () => {
    const { u, t, depts, customerId } = await setup();
    const file = await upload(t.reem, 'photo.pdf');
    const opened = await request(app())
      .post('/api/v1/discussions')
      .set(auth(t.reem))
      .send({
        recordType: 'customer',
        recordId: customerId,
        title: 'فاتورة لم تصل للعميل',
        details: 'العميل يطلب نسخة من فاتورة الشهر الماضي',
        targetDepartmentId: depts.finance,
        attachmentIds: [file],
      });
    expect(opened.status, JSON.stringify(opened.body)).toBe(201);
    expect(opened.body.number).toMatch(/^DSC-/);
    const id = opened.body._id as string;
    // Notification 15 of SAL §14 reaches the Finance department.
    for (const who of [u.abdulaziz, u.shahad])
      expect(await Notification.exists({ userId: who._id, type: 'discussion.opened' })).toBeTruthy();
    // Majed cannot open a thread on reem's customer, nor read hers.
    expect(
      (
        await request(app())
          .post('/api/v1/discussions')
          .set(auth(t.majed))
          .send({
            recordType: 'customer',
            recordId: customerId,
            title: 'محاولة',
            details: 'تفاصيل',
            targetDepartmentId: depts.finance,
          })
      ).status,
    ).toBe(400);
    expect((await request(app()).get(`/api/v1/discussions/${id}`).set(auth(t.majed))).status).toBe(404);
    expect((await request(app()).get(`/api/v1/files/${file}/url`).set(auth(t.majed))).status).toBe(403);
    // The manager sees it through the customer; Finance through its inbox.
    expect((await request(app()).get(`/api/v1/discussions/${id}`).set(auth(t.mgr))).status).toBe(200);
    const inbox = await request(app()).get('/api/v1/discussions?view=department').set(auth(t.shahad));
    expect(inbox.body.total).toBe(1);
    expect(inbox.body.items[0].recordLabel).toContain('شركة الخليج للتغليف');
    // The requester cannot mark it in progress; the handler's first reply does it automatically.
    expect(
      (
        await request(app())
          .post(`/api/v1/discussions/${id}/state`)
          .set(auth(t.reem))
          .send({ state: 'in_progress' })
      ).status,
    ).toBe(400);
    const reply = await request(app())
      .post(`/api/v1/discussions/${id}/messages`)
      .set(auth(t.shahad))
      .send({ body: 'جاري إصدار نسخة' });
    expect(reply.status).toBe(201);
    expect((await request(app()).get(`/api/v1/discussions/${id}`).set(auth(t.reem))).body.state).toBe(
      'in_progress',
    );
    expect(await Notification.exists({ userId: u.reem._id, type: 'discussion.replied' })).toBeTruthy();
    // Resolving records the action taken.
    expect(
      (
        await request(app())
          .post(`/api/v1/discussions/${id}/state`)
          .set(auth(t.shahad))
          .send({ state: 'resolved' })
      ).status,
    ).toBe(400);
    const resolved = await request(app())
      .post(`/api/v1/discussions/${id}/state`)
      .set(auth(t.shahad))
      .send({ state: 'resolved', note: 'أُرسلت النسخة بالبريد' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.state).toBe('resolved');
    // Finance cannot close it; the requester confirms.
    expect(
      (
        await request(app())
          .post(`/api/v1/discussions/${id}/state`)
          .set(auth(t.shahad))
          .send({ state: 'closed' })
      ).status,
    ).toBe(400);
    const closed = await request(app())
      .post(`/api/v1/discussions/${id}/state`)
      .set(auth(t.reem))
      .send({ state: 'closed' });
    expect(closed.status).toBe(200);
    expect(closed.body.canReply).toBe(false);
    expect(
      (
        await request(app())
          .post(`/api/v1/discussions/${id}/messages`)
          .set(auth(t.reem))
          .send({ body: 'شكرا' })
      ).status,
    ).toBe(409);
    // The whole conversation is kept: opened, message, auto state, resolved, closed.
    expect(await DiscussionEntry.countDocuments({ discussionId: id })).toBe(5);
    // The executive reads, never writes.
    expect((await request(app()).get(`/api/v1/discussions/${id}`).set(auth(t.ceo))).status).toBe(200);
  });

  it('calendar: meeting type and Marketing notice (once, with name, date, place, organizer); an outcome on a customer meeting lands in the communication log', async () => {
    const { u, t, customerId } = await setup();
    const start = new Date(Date.now() + 3 * 86_400_000);
    const ev = {
      title: 'معرض البيئة',
      type: 'event',
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 3_600_000).toISOString(),
      meetingType: 'حضوري',
      needsMarketing: true,
      link: { type: 'customer', id: customerId },
    };
    expect((await request(app()).post('/api/v1/calendar/events').set(auth(t.reem)).send(ev)).status).toBe(
      400,
    );
    const created = await request(app())
      .post('/api/v1/calendar/events')
      .set(auth(t.reem))
      .send({ ...ev, location: 'مركز الرياض الدولي', organizer: 'وزارة البيئة' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ meetingType: 'حضوري', marketingNotice: 'sent' });
    const notice = await Notification.findOne({ userId: u.lama._id, type: 'sales.marketing_notice' }).lean();
    expect(notice?.bodyAr).toContain('وزارة البيئة');
    expect(notice?.bodyAr).toContain('مركز الرياض الدولي');
    // A later edit never sends it again, and it cannot be withdrawn.
    await request(app())
      .patch(`/api/v1/calendar/events/${created.body._id}`)
      .set(auth(t.reem))
      .send({ title: 'معرض البيئة 2026' });
    expect(await Notification.countDocuments({ userId: u.lama._id, type: 'sales.marketing_notice' })).toBe(1);
    expect(
      (
        await request(app())
          .patch(`/api/v1/calendar/events/${created.body._id}`)
          .set(auth(t.reem))
          .send({ needsMarketing: false })
      ).status,
    ).toBe(400);

    // The outcome of a customer meeting becomes a log entry (once), and the next follow-up moves to the customer.
    const next = new Date(Date.now() + 7 * 86_400_000);
    const done = await request(app())
      .patch(`/api/v1/calendar/events/${created.body._id}`)
      .set(auth(t.reem))
      .send({ status: 'done', outcome: 'اتفقنا على عرض سعر للكرتون', nextFollowUpAt: next.toISOString() });
    expect(done.status).toBe(200);
    await processOutbox();
    await processOutbox();
    const logs = await CommunicationLog.find({ customerId, 'source.type': 'calendar_event' }).lean();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ method: 'meeting', outcome: 'اتفقنا على عرض سعر للكرتون' });
    const c = await Customer.findById(customerId).lean();
    expect(c?.nextFollowUpAt?.getTime()).toBe(next.getTime());
    // The same outcome saved again adds nothing.
    await request(app())
      .patch(`/api/v1/calendar/events/${created.body._id}`)
      .set(auth(t.reem))
      .send({ outcome: 'اتفقنا على عرض سعر للكرتون' });
    await processOutbox();
    expect(await CommunicationLog.countDocuments({ customerId, 'source.type': 'calendar_event' })).toBe(1);
  });
});
