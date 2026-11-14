import request from 'supertest';
import { expect } from 'vitest';
import { DEFAULT_SALES_TAGS } from '@eayni/shared';
import { auth, loginAs, makeDepartment, makeUser, testApp } from './helpers';
import { setSetting } from '../core/settings/service';
import { SYSTEM_ACTOR } from '../core/http/context';
import { ensureDefaultTags } from '../core/tags/service';
import { riyadhPeriod } from '../core/kpi/service';

/**
 * Sales S4/S5 test fixtures: the Sales, Finance and Marketing departments with a manager, two reps, the executive,
 * the Finance manager and staff and a Marketing member; a customer with an opportunity; a cardboard price item; a
 * PDF upload helper; and a full sale (quote → sent → accepted → order → invoice registered by Finance → payment).
 */
const app = () => testApp();

export async function setup() {
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

export async function upload(token: string, name = 'doc.pdf', mimeType = 'application/pdf') {
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
export async function soldAndInvoiced(
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
export function apiOf(link: string): string {
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
