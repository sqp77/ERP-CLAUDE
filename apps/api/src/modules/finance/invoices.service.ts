import { randomUUID } from 'node:crypto';
import { Types, type FilterQuery } from 'mongoose';
import { COLLECTION_STATE_AR, PAYMENT_METHOD_AR, ZATCA_STATE_AR } from '@eayni/shared';
import { badRequest, conflict, forbidden, notFound } from '../../core/http/errors';
import { actorFrom, type AuthedRequest } from '../../core/http/context';
import { recordAudit } from '../../core/audit/service';
import { nextNumber } from '../../core/numbering/service';
import { notify } from '../../core/notifications/service';
import { publish } from '../../core/outbox/service';
import { getSetting } from '../../core/settings/service';
import { claimAttachments } from '../../core/files/service';
import { escapeHtml, htmlDocument } from '../../core/templates/render';
import { Party } from '../../core/parties/model';
import { withTransaction } from '../../db';
import { customerLabels, permissionOn, salesManagerUserIds, userNames } from '../crm/service';
import { customerPartyId } from '../crm/service';
import { orderForInvoicing, markOrderInvoiced, markOrderClosed } from '../sales/orders.service';
import { Invoice, type InvoiceDoc } from './invoices.model';

/**
 * Invoice register (Finance phase 0, DECISIONS §20 Q14) [SAL §7.3, FIN §7, §10]. Option A (Q4): Finance records the
 * invoice issued in the current accounting system against an open sales order; lines and customer come from the order
 * (no re-entry). Sales reads invoice and collection status. Payments are append-only and the collection state derives
 * from them; nothing is paid twice because every payment hangs on its invoice.
 */
const isFinance = (req: AuthedRequest) =>
  req.auth.roleCodes.includes('finance_staff') || req.auth.roleCodes.includes('finance_manager');

function scopeFilter(
  req: AuthedRequest,
  eff: { scope: string; departmentIds: string[] },
): FilterQuery<unknown> {
  if (eff.scope === 'all') return {};
  if (eff.scope === 'department')
    return {
      $or: [
        { salesDepartmentId: { $in: eff.departmentIds.map((d) => new Types.ObjectId(d)) } },
        { salesOwnerUserId: req.auth.user._id },
      ],
    };
  return { salesOwnerUserId: req.auth.user._id };
}
export async function canAccessInvoice(req: AuthedRequest, id: string): Promise<boolean> {
  const eff = await permissionOn(req, 'finance.invoices', 'view');
  return !!eff && !!(await Invoice.exists({ _id: id, deletedAt: null, ...scopeFilter(req, eff) }));
}

function collectionState(
  inv: { totalHalalas: number; collectedHalalas: number; dueDate: Date },
  now = new Date(),
) {
  if (inv.collectedHalalas >= inv.totalHalalas) return 'collected';
  if (inv.collectedHalalas > 0) return 'partially_collected';
  return inv.dueDate < now ? 'overdue' : 'due';
}

export async function registerInvoice(
  req: AuthedRequest,
  input: {
    salesOrderId: string;
    kind: 'tax' | 'simplified';
    externalNumber: string;
    issueDateTime: string;
    dueDate: string;
    pdfAttachmentId?: string;
    notes?: string;
  },
) {
  if (!isFinance(req)) throw forbidden('تسجيل الفواتير من صلاحيات القسم المالي');
  const order = await orderForInvoicing(input.salesOrderId);
  if (!order) throw notFound('أمر البيع غير موجود');
  if (order.state !== 'open') throw conflict('أمر البيع مفوتر أو مغلق');
  if (await Invoice.exists({ externalNumber: input.externalNumber }))
    throw conflict('رقم الفاتورة مسجَّل مسبقًا', { code: 'duplicate_invoice' });
  const [customer, partyId] = await Promise.all([
    customerLabels([order.customerId]),
    customerPartyId(String(order.customerId)),
  ]);
  const party = partyId ? await Party.findById(partyId).lean() : null;
  const cust = customer.get(String(order.customerId));
  const actor = actorFrom(req);
  const issueDateTime = new Date(input.issueDateTime);
  const dueDate = new Date(`${input.dueDate}T23:59:59+03:00`);
  const inv = await withTransaction(async (session) => {
    const number = await nextNumber('invoice', session);
    const sequence = Number(number.split('-').pop());
    const [doc] = await Invoice.create(
      [
        {
          number,
          kind: input.kind,
          externalNumber: input.externalNumber,
          salesOrderId: order._id,
          customerId: order.customerId,
          partyId: party?._id,
          salesOwnerUserId: order.ownerUserId,
          salesDepartmentId: order.departmentId,
          issueDateTime,
          dueDate,
          customer: {
            nameAr: cust?.nameAr,
            legalNameAr: party?.legalNameAr,
            vatNumber: party?.vatNumber,
            crNumber: party?.crNumber,
            nationalAddress: party?.nationalAddress,
          },
          lines: order.lines,
          subtotalHalalas: order.subtotalHalalas,
          vatTotalHalalas: order.vatTotalHalalas,
          totalHalalas: order.totalHalalas,
          collectedHalalas: 0,
          remainingHalalas: order.totalHalalas,
          collectionState: collectionState({
            totalHalalas: order.totalHalalas,
            collectedHalalas: 0,
            dueDate,
          }),
          zatca: { uuid: randomUUID(), sequence, state: 'pending' },
          pdfAttachmentId: input.pdfAttachmentId,
          notes: input.notes,
          issuedByUserId: req.auth.user._id,
        },
      ],
      { session, ordered: true },
    );
    if (input.pdfAttachmentId)
      await claimAttachments([input.pdfAttachmentId], 'invoice', String(doc._id), req.auth.user._id, session);
    await markOrderInvoiced(String(order._id), String(doc._id), session);
    await recordAudit(
      actor,
      {
        action: 'create',
        resource: 'finance.invoices',
        resourceId: String(doc._id),
        after: {
          number,
          externalNumber: input.externalNumber,
          total: doc.totalHalalas,
          salesOrder: order.number,
        },
      },
      session,
    );
    await publish(
      {
        type: 'finance.invoice.issued',
        aggregateType: 'invoice',
        aggregateId: String(doc._id),
        payload: {
          number,
          salesOrderId: String(order._id),
          customerId: String(order.customerId),
          totalHalalas: doc.totalHalalas,
        },
        actorUserId: actor.userId,
      },
      session,
    );
    return doc;
  });
  // Notification 11 [SAL §14]: the Sales owner and managers.
  await notify({
    userIds: [
      ...new Set([String(order.ownerUserId), ...(await salesManagerUserIds(String(order.departmentId)))]),
    ].filter((u) => u !== String(req.auth.user._id)),
    type: 'finance.invoice.issued',
    bodyAr: `${inv.number} (${input.externalNumber}) — ${cust?.nameAr ?? ''}: ${(inv.totalHalalas / 100).toLocaleString('ar-SA-u-nu-latn')} ر.س`,
    link: `/sales/invoices/${inv._id}`,
    data: { invoiceId: String(inv._id) },
  });
  return getInvoice(req, String(inv._id));
}

export async function recordPayment(
  req: AuthedRequest,
  id: string,
  input: {
    amountHalalas: number;
    paidAt?: string;
    method: string;
    reference?: string;
    proofAttachmentId?: string;
  },
) {
  if (!isFinance(req)) throw forbidden('تسجيل السداد من صلاحيات القسم المالي');
  const inv = await Invoice.findOne({ _id: id, deletedAt: null });
  if (!inv) throw notFound();
  if (inv.collectedHalalas + input.amountHalalas > inv.totalHalalas)
    throw badRequest('المبلغ يتجاوز المتبقي على الفاتورة', [
      { path: 'amountHalalas', message: `المتبقي ${inv.remainingHalalas}` },
    ]);
  const collected = inv.collectedHalalas + input.amountHalalas;
  const state = collectionState({
    totalHalalas: inv.totalHalalas,
    collectedHalalas: collected,
    dueDate: inv.dueDate,
  });
  const actor = actorFrom(req);
  await withTransaction(async (session) => {
    if (input.proofAttachmentId)
      await claimAttachments([input.proofAttachmentId], 'invoice', id, req.auth.user._id, session);
    const r = await Invoice.updateOne(
      { _id: id, collectedHalalas: inv.collectedHalalas },
      {
        $set: {
          collectedHalalas: collected,
          remainingHalalas: inv.totalHalalas - collected,
          collectionState: state,
        },
        $push: {
          payments: {
            amountHalalas: input.amountHalalas,
            paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
            method: input.method,
            reference: input.reference,
            proofAttachmentId: input.proofAttachmentId,
            byUserId: req.auth.user._id,
          },
        },
      },
      { session },
    );
    if (!r.matchedCount) throw conflict('سُجِّل سداد آخر على الفاتورة في الوقت نفسه، حدّث الصفحة');
    if (state === 'collected') await markOrderClosed(String(inv.salesOrderId), session);
    await recordAudit(
      actor,
      {
        action: 'update',
        resource: 'finance.invoices',
        resourceId: id,
        before: { collected: inv.collectedHalalas },
        after: { collected, state },
        meta: { payment: input },
      },
      session,
    );
    await publish(
      {
        type: 'finance.invoice.payment',
        aggregateType: 'invoice',
        aggregateId: id,
        payload: { amountHalalas: input.amountHalalas, collectedHalalas: collected, state },
        actorUserId: actor.userId,
      },
      session,
    );
  });
  return getInvoice(req, id);
}

export interface ListInvoicesQuery {
  page: number;
  limit: number;
  customerId?: string;
  salesOrderId?: string;
  collectionState?: string;
  overdue?: boolean;
  q?: string;
}
export async function listInvoices(req: AuthedRequest, query: ListInvoicesQuery) {
  const eff = await permissionOn(req, 'finance.invoices', 'view');
  if (!eff) throw forbidden();
  const filter: FilterQuery<unknown> = { deletedAt: null, ...scopeFilter(req, eff) };
  if (query.customerId) filter.customerId = query.customerId;
  if (query.salesOrderId) filter.salesOrderId = query.salesOrderId;
  if (query.collectionState) filter.collectionState = query.collectionState;
  if (query.overdue) Object.assign(filter, { remainingHalalas: { $gt: 0 }, dueDate: { $lt: new Date() } });
  if (query.q) filter.$or = [{ number: query.q.toUpperCase() }, { externalNumber: query.q }];
  const [rows, total] = await Promise.all([
    Invoice.find(filter)
      .sort({ issueDateTime: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Invoice.countDocuments(filter),
  ]);
  const names = await userNames(rows.map((r) => r.salesOwnerUserId));
  return {
    items: rows.map((r) => ({
      ...r,
      collectionStateAr: COLLECTION_STATE_AR[r.collectionState as keyof typeof COLLECTION_STATE_AR],
      zatcaStateAr: ZATCA_STATE_AR[r.zatca?.state as keyof typeof ZATCA_STATE_AR],
      ownerName: names.get(String(r.salesOwnerUserId)) ?? '',
      daysToCollect:
        r.collectionState === 'collected'
          ? Math.ceil(((r.payments.at(-1)?.paidAt?.getTime() ?? 0) - r.issueDateTime.getTime()) / 86_400_000)
          : null,
    })),
    total,
    page: query.page,
    limit: query.limit,
  };
}

export async function getInvoice(req: AuthedRequest, id: string) {
  const eff = await permissionOn(req, 'finance.invoices', 'view');
  if (!eff) throw forbidden();
  const inv = await Invoice.findOne({ _id: id, deletedAt: null, ...scopeFilter(req, eff) }).lean();
  if (!inv) throw notFound();
  await recordAudit(actorFrom(req), {
    action: 'view',
    resource: 'finance.invoices',
    resourceId: id,
    sensitive: true,
  });
  return {
    ...inv,
    collectionStateAr: COLLECTION_STATE_AR[inv.collectionState as keyof typeof COLLECTION_STATE_AR],
    zatcaStateAr: ZATCA_STATE_AR[inv.zatca?.state as keyof typeof ZATCA_STATE_AR],
    payments: inv.payments.map((p) => ({
      ...p,
      methodAr: PAYMENT_METHOD_AR[p.method as keyof typeof PAYMENT_METHOD_AR],
    })),
    canRecordPayment: isFinance(req) && inv.remainingHalalas > 0,
  };
}

/** Customer-facing copy (FIN §7 content, net prices only — the order already carries net prices). */
export async function invoiceDocument(req: AuthedRequest, id: string): Promise<string> {
  const inv = await getInvoice(req, id);
  const orgName = await getSetting('general.organizationNameAr');
  const sar = (h: number) =>
    `${(h / 100).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2 })} ر.س`;
  const d = (x: Date) =>
    new Intl.DateTimeFormat('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', dateStyle: 'medium' }).format(x);
  const rows = inv.lines
    .map(
      (l) =>
        `<tr><td>${escapeHtml(l.descriptionAr)}</td><td>${l.quantity}</td><td>${sar(l.unitPriceHalalas ?? 0)}</td><td>${sar(l.lineTotalHalalas ?? 0)}</td><td>${sar(l.vatHalalas ?? 0)}</td></tr>`,
    )
    .join('');
  const body = `<div style="text-align:center"><h2>${escapeHtml(orgName)}</h2><h3>${inv.kind === 'simplified' ? 'فاتورة ضريبية مبسطة' : 'فاتورة ضريبية'}</h3><p>رقم: ${escapeHtml(inv.externalNumber)} (${escapeHtml(inv.number)}) · تاريخ الإصدار: ${d(inv.issueDateTime)} · تاريخ الاستحقاق: ${d(inv.dueDate)}</p></div>
<p>العميل: <strong>${escapeHtml(inv.customer?.legalNameAr ?? inv.customer?.nameAr ?? '')}</strong>${inv.customer?.vatNumber ? ` · الرقم الضريبي ${escapeHtml(inv.customer.vatNumber)}` : ''}${inv.customer?.nationalAddress ? ` · ${escapeHtml(inv.customer.nationalAddress)}` : ''}</p>
<table><thead><tr><th>البند</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th><th>الضريبة (15%)</th></tr></thead><tbody>${rows}</tbody></table>
<p>الإجمالي قبل الضريبة: <strong>${sar(inv.subtotalHalalas)}</strong> · ضريبة القيمة المضافة: <strong>${sar(inv.vatTotalHalalas)}</strong> · الإجمالي: <strong>${sar(inv.totalHalalas)}</strong> · المحصَّل: ${sar(inv.collectedHalalas)} · المتبقي: ${sar(inv.remainingHalalas)}</p>
<p style="font-size:12px;color:#555">UUID: ${escapeHtml(inv.zatca?.uuid ?? '')} · التسلسل ${inv.zatca?.sequence ?? ''} · حالة الفوترة الإلكترونية: ${escapeHtml(inv.zatcaStateAr ?? '')}</p>`;
  return htmlDocument(body, inv.number);
}

/** Notification 12 [SAL §14, FIN §13]: once per invoice when the due date passes with a remaining balance. */
export async function runInvoiceOverdueAlerts(now = new Date()): Promise<{ notified: number }> {
  const due = await Invoice.find({
    deletedAt: null,
    remainingHalalas: { $gt: 0 },
    dueDate: { $lt: now },
    overdueNotifiedAt: null,
  }).limit(200);
  let notified = 0;
  for (const inv of due) {
    const claimed = await Invoice.updateOne(
      { _id: inv._id, overdueNotifiedAt: null },
      {
        $set: {
          overdueNotifiedAt: now,
          collectionState: inv.collectedHalalas > 0 ? 'partially_collected' : 'overdue',
        },
      },
    );
    if (!claimed.modifiedCount) continue;
    const finance = (await import('../../core/auth/model')).User;
    const financeIds = (
      await finance
        .find({
          status: 'active',
          deletedAt: null,
          'roles.role': { $in: ['finance_staff', 'finance_manager'] },
        })
        .select('_id')
        .lean()
    ).map((u) => String(u._id));
    await notify({
      userIds: [
        ...new Set([
          ...(inv.salesOwnerUserId ? [String(inv.salesOwnerUserId)] : []),
          ...(inv.salesDepartmentId ? await salesManagerUserIds(String(inv.salesDepartmentId)) : []),
          ...financeIds,
        ]),
      ],
      type: 'finance.invoice.overdue',
      bodyAr: `${inv.number} (${inv.externalNumber}) — المتبقي ${(inv.remainingHalalas / 100).toLocaleString('ar-SA-u-nu-latn')} ر.س`,
      link: `/sales/invoices/${inv._id}`,
      data: { invoiceId: String(inv._id) },
    });
    notified++;
  }
  return { notified };
}

export type { InvoiceDoc };
