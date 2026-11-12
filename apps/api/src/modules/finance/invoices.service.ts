import { randomUUID } from 'node:crypto';
import { Types, type FilterQuery } from 'mongoose';
import { COLLECTION_STATE_AR, PAYMENT_METHOD_AR, VAT_RATE_BP, ZATCA_STATE_AR } from '@eayni/shared';
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
import { orderForInvoicing, attachInvoiceToOrder, markOrderClosed } from '../sales/orders.service';
import { contractForInvoicing, claimScheduleEntries } from '../sales/contracts.service';
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

type InvoiceSource = {
  salesOrderId?: string;
  contractId?: string;
  periodFrom?: string;
  periodTo?: string;
  scheduleEntryIds?: string[];
};
interface InvoiceLine {
  itemId?: Types.ObjectId | string;
  descriptionAr: string;
  unit?: string;
  quantity: number;
  unitPriceHalalas: number;
  lineTotalHalalas: number;
  vatRateBp: number;
  vatHalalas: number;
  taxCategory: string;
}
interface Totals {
  subtotalHalalas: number;
  vatTotalHalalas: number;
  totalHalalas: number;
}
const halfUp = (n: number) => Math.floor(n + 0.5);
function lineFrom(l: {
  itemId?: string | Types.ObjectId;
  descriptionAr: string;
  unit?: string;
  quantity: number;
  unitPriceHalalas: number;
  vatRateBp?: number;
}): InvoiceLine {
  const lineTotal = l.quantity * l.unitPriceHalalas;
  const vatRateBp = l.vatRateBp ?? VAT_RATE_BP;
  return {
    itemId: l.itemId,
    descriptionAr: l.descriptionAr,
    unit: l.unit,
    quantity: l.quantity,
    unitPriceHalalas: l.unitPriceHalalas,
    lineTotalHalalas: lineTotal,
    vatRateBp,
    vatHalalas: halfUp((lineTotal * vatRateBp) / 10_000),
    taxCategory: 'S',
  };
}
const totalsOf = (lines: InvoiceLine[]): Totals => {
  const subtotalHalalas = lines.reduce((a, l) => a + l.lineTotalHalalas, 0);
  const vatTotalHalalas = lines.reduce((a, l) => a + l.vatHalalas, 0);
  return { subtotalHalalas, vatTotalHalalas, totalHalalas: subtotalHalalas + vatTotalHalalas };
};
const riyadhDayStart = (d: string) => new Date(`${d}T00:00:00+03:00`);
const riyadhDayEnd = (d: string) => new Date(`${d}T23:59:59.999+03:00`);

export interface InvoicePrefill {
  source: 'order' | 'contract';
  sourceNumber: string;
  salesOrderId?: string;
  contractId?: string;
  customerId: Types.ObjectId;
  ownerUserId: Types.ObjectId;
  departmentId: Types.ObjectId;
  lines: InvoiceLine[];
  totals: Totals;
  /** Order only: what may still be invoiced on it. */
  remainingHalalas: number | null;
  periodFrom?: Date;
  periodTo?: Date;
  scheduleEntryIds: string[];
  scheduleEntries: {
    _id: string;
    plannedAt: Date;
    kind: string;
    doneAt?: Date | null;
    quantities?: unknown;
  }[];
  previousInvoices: { _id: Types.ObjectId; number: string; externalNumber: string; totalHalalas: number }[];
}

/**
 * Prefill from the source [SAL §7.3 «بناءً على أمر البيع أو العقد المعتمد», FIN §7 no re-entry]:
 * - order → its lines; totals = what is still un-invoiced (several invoices per order, sum ≤ order total);
 * - contract → the schedule entries done in the period (or the given ones) that no invoice covers yet; lines = contract
 *   items × the quantities recorded on those entries (an entry without recorded quantities counts one unit of each
 *   «زيارة» item). An entry is never invoiced twice.
 */
export async function prefillInvoice(src: InvoiceSource): Promise<InvoicePrefill> {
  if (src.salesOrderId) {
    const order = await orderForInvoicing(src.salesOrderId);
    if (!order) throw notFound('أمر البيع غير موجود');
    if (!['open', 'partially_invoiced'].includes(order.state))
      throw conflict('أمر البيع مفوتر بالكامل أو مغلق', { code: 'order_not_invoiceable' });
    const previous = await Invoice.find({ salesOrderId: order._id, deletedAt: null })
      .select('number externalNumber totalHalalas subtotalHalalas vatTotalHalalas')
      .lean();
    const invoiced = order.invoicedHalalas ?? 0;
    const totals: Totals = previous.length
      ? {
          subtotalHalalas: Math.max(
            0,
            order.subtotalHalalas - previous.reduce((a, p) => a + p.subtotalHalalas, 0),
          ),
          vatTotalHalalas: Math.max(
            0,
            order.vatTotalHalalas - previous.reduce((a, p) => a + p.vatTotalHalalas, 0),
          ),
          totalHalalas: Math.max(0, order.totalHalalas - invoiced),
        }
      : {
          subtotalHalalas: order.subtotalHalalas,
          vatTotalHalalas: order.vatTotalHalalas,
          totalHalalas: order.totalHalalas,
        };
    return {
      source: 'order',
      sourceNumber: order.number,
      salesOrderId: String(order._id),
      customerId: order.customerId,
      ownerUserId: order.ownerUserId,
      departmentId: order.departmentId,
      lines: order.lines.map((l) => ({
        itemId: l.itemId ?? undefined,
        descriptionAr: l.descriptionAr ?? '',
        unit: l.unit ?? undefined,
        quantity: l.quantity ?? 0,
        unitPriceHalalas: l.unitPriceHalalas ?? 0,
        lineTotalHalalas: l.lineTotalHalalas ?? 0,
        vatRateBp: l.vatRateBp ?? VAT_RATE_BP,
        vatHalalas: l.vatHalalas ?? 0,
        taxCategory: l.taxCategory ?? 'S',
      })),
      totals,
      remainingHalalas: Math.max(0, order.totalHalalas - invoiced),
      scheduleEntryIds: [],
      scheduleEntries: [],
      previousInvoices: previous.map((p) => ({
        _id: p._id,
        number: p.number,
        externalNumber: p.externalNumber,
        totalHalalas: p.totalHalalas,
      })),
    };
  }
  const contract = await contractForInvoicing(src.contractId!);
  if (!contract) throw notFound('العقد غير موجود');
  if (contract.state === 'draft') throw conflict('العقد ما زال مسودة', { code: 'contract_not_invoiceable' });
  const wanted = src.scheduleEntryIds?.length ? new Set(src.scheduleEntryIds) : null;
  const from = src.periodFrom ? riyadhDayStart(src.periodFrom) : null;
  const to = src.periodTo ? riyadhDayEnd(src.periodTo) : null;
  const entries = contract.schedule.filter((e) => {
    if (wanted) return wanted.has(String(e._id));
    const at = e.doneAt ?? e.plannedAt;
    return e.status === 'done' && !e.invoiceId && (!from || at >= from) && (!to || at <= to);
  });
  if (wanted) {
    const missing = [...wanted].filter((id) => !entries.some((e) => String(e._id) === id));
    if (missing.length) throw badRequest('بعض المواعيد غير موجودة على هذا العقد');
    const notDone = entries.filter((e) => e.status !== 'done');
    if (notDone.length) throw badRequest('لا تُفوتر إلا المواعيد المنفَّذة («تم»)');
    const already = entries.filter((e) => e.invoiceId);
    if (already.length)
      throw conflict('بعض هذه المواعيد مفوترة مسبقًا', {
        code: 'schedule_entry_invoiced',
        entryIds: already.map((e) => String(e._id)),
      });
  }
  if (!entries.length) throw badRequest('لا توجد مواعيد منفَّذة غير مفوترة في هذه الفترة');
  const lines: InvoiceLine[] = [];
  for (const item of contract.items) {
    let qty = 0;
    for (const e of entries) {
      if (e.quantities) {
        const match = e.quantities.find(
          (q) =>
            (item.itemId && q.itemId && String(q.itemId) === String(item.itemId)) ||
            (!!q.descriptionAr && q.descriptionAr === item.descriptionAr),
        );
        qty += match?.quantity ?? 0;
      } else if (item.unit === 'visit') qty += 1;
    }
    if (qty > 0)
      lines.push(
        lineFrom({
          itemId: item.itemId ?? undefined,
          descriptionAr: item.descriptionAr ?? '',
          unit: item.unit ?? undefined,
          quantity: qty,
          unitPriceHalalas: item.agreedPriceHalalas ?? 0,
        }),
      );
  }
  if (!lines.length) throw badRequest('لا كميات مسجَّلة على المواعيد المنفَّذة في هذه الفترة');
  const dates = entries.map((e) => (e.doneAt ?? e.plannedAt).getTime());
  const previous = await Invoice.find({ contractId: contract._id, deletedAt: null })
    .select('number externalNumber totalHalalas')
    .lean();
  return {
    source: 'contract',
    sourceNumber: contract.number,
    contractId: String(contract._id),
    customerId: contract.customerId,
    ownerUserId: contract.ownerUserId,
    departmentId: contract.departmentId,
    lines,
    totals: totalsOf(lines),
    remainingHalalas: null,
    periodFrom: from ?? new Date(Math.min(...dates)),
    periodTo: to ?? new Date(Math.max(...dates)),
    scheduleEntryIds: entries.map((e) => String(e._id)),
    scheduleEntries: entries.map((e) => ({
      _id: String(e._id),
      plannedAt: e.plannedAt,
      kind: e.kind,
      doneAt: e.doneAt,
      quantities: e.quantities,
    })),
    previousInvoices: previous.map((p) => ({
      _id: p._id,
      number: p.number,
      externalNumber: p.externalNumber,
      totalHalalas: p.totalHalalas,
    })),
  };
}
export async function prefillForFinance(req: AuthedRequest, src: InvoiceSource) {
  if (!isFinance(req)) throw forbidden('تسجيل الفواتير من صلاحيات القسم المالي');
  return prefillInvoice(src);
}

export async function registerInvoice(
  req: AuthedRequest,
  input: InvoiceSource & {
    kind: 'tax' | 'simplified';
    externalNumber: string;
    issueDateTime: string;
    dueDate: string;
    lines?: {
      itemId?: string;
      descriptionAr: string;
      unit?: string;
      quantity: number;
      unitPriceHalalas: number;
      vatRateBp?: number;
    }[];
    totals?: Totals;
    differenceReason?: string;
    pdfAttachmentId?: string;
    notes?: string;
  },
) {
  if (!isFinance(req)) throw forbidden('تسجيل الفواتير من صلاحيات القسم المالي');
  const pre = await prefillInvoice(input);
  if (await Invoice.exists({ externalNumber: input.externalNumber }))
    throw conflict('رقم الفاتورة مسجَّل مسبقًا', { code: 'duplicate_invoice' });
  // Option A: Finance records the issued invoice's actual figures; a difference from the prefilled ones needs a reason.
  const lines = input.lines ? input.lines.map(lineFrom) : pre.lines;
  const totals = input.totals ?? (input.lines ? totalsOf(lines) : pre.totals);
  const differs =
    totals.totalHalalas !== pre.totals.totalHalalas ||
    totals.subtotalHalalas !== pre.totals.subtotalHalalas ||
    totals.vatTotalHalalas !== pre.totals.vatTotalHalalas;
  if (differs && !input.differenceReason?.trim())
    throw badRequest('تختلف مبالغ الفاتورة عن المبالغ المعبَّأة من المصدر؛ اذكر سبب الفرق', [
      { path: 'differenceReason', message: 'سبب الفرق مطلوب' },
    ]);
  if (pre.remainingHalalas !== null && totals.totalHalalas > pre.remainingHalalas)
    throw badRequest('إجمالي الفاتورة يتجاوز المتبقي غير المفوتر من أمر البيع', [
      { path: 'totals', message: `المتبقي ${pre.remainingHalalas}` },
    ]);
  const [customer, partyId] = await Promise.all([
    customerLabels([pre.customerId]),
    customerPartyId(String(pre.customerId)),
  ]);
  const party = partyId ? await Party.findById(partyId).lean() : null;
  const cust = customer.get(String(pre.customerId));
  const actor = actorFrom(req);
  const issueDateTime = new Date(input.issueDateTime);
  const dueDate = riyadhDayEnd(input.dueDate);
  const difference = differs
    ? {
        halalas: totals.totalHalalas - pre.totals.totalHalalas,
        reason: input.differenceReason!.trim(),
        byUserId: req.auth.user._id,
      }
    : undefined;
  const inv = await withTransaction(async (session) => {
    const number = await nextNumber('invoice', session);
    const sequence = Number(number.split('-').pop());
    const [doc] = await Invoice.create(
      [
        {
          number,
          kind: input.kind,
          externalNumber: input.externalNumber,
          source: pre.source,
          sourceNumber: pre.sourceNumber,
          salesOrderId: pre.salesOrderId,
          contractId: pre.contractId,
          periodFrom: pre.periodFrom,
          periodTo: pre.periodTo,
          scheduleEntryIds: pre.scheduleEntryIds,
          customerId: pre.customerId,
          partyId: party?._id,
          salesOwnerUserId: pre.ownerUserId,
          salesDepartmentId: pre.departmentId,
          issueDateTime,
          dueDate,
          customer: {
            nameAr: cust?.nameAr,
            legalNameAr: party?.legalNameAr,
            vatNumber: party?.vatNumber,
            crNumber: party?.crNumber,
            nationalAddress: party?.nationalAddress,
          },
          lines,
          subtotalHalalas: totals.subtotalHalalas,
          vatTotalHalalas: totals.vatTotalHalalas,
          totalHalalas: totals.totalHalalas,
          prefilled: pre.totals,
          difference,
          collectedHalalas: 0,
          remainingHalalas: totals.totalHalalas,
          collectionState: collectionState({
            totalHalalas: totals.totalHalalas,
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
    // Conditional writes on the source (S3 fix 2): a concurrent registration cannot exceed the order or re-invoice an entry.
    if (pre.source === 'order') {
      const ok = await attachInvoiceToOrder(pre.salesOrderId!, String(doc._id), totals.totalHalalas, session);
      if (!ok)
        throw conflict(
          'سُجِّلت فاتورة أخرى على أمر البيع في الوقت نفسه أو تجاوز المجموع إجماليه، حدّث الصفحة',
          {
            code: 'order_invoicing_conflict',
          },
        );
    } else {
      const ok = await claimScheduleEntries(pre.contractId!, pre.scheduleEntryIds, String(doc._id), session);
      if (!ok)
        throw conflict('فُوتر بعض هذه المواعيد في الوقت نفسه، حدّث الصفحة', {
          code: 'schedule_entry_invoiced',
        });
    }
    await recordAudit(
      actor,
      {
        action: 'create',
        resource: 'finance.invoices',
        resourceId: String(doc._id),
        after: {
          number,
          externalNumber: input.externalNumber,
          source: pre.source,
          sourceNumber: pre.sourceNumber,
          total: doc.totalHalalas,
          prefilledTotal: pre.totals.totalHalalas,
          difference,
          scheduleEntryIds: pre.scheduleEntryIds,
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
          source: pre.source,
          salesOrderId: pre.salesOrderId,
          contractId: pre.contractId,
          customerId: String(pre.customerId),
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
      ...new Set([String(pre.ownerUserId), ...(await salesManagerUserIds(String(pre.departmentId)))]),
    ].filter((u) => u !== String(req.auth.user._id)),
    type: 'finance.invoice.issued',
    bodyAr: `${inv.number} (${input.externalNumber}) — ${cust?.nameAr ?? ''} — ${pre.sourceNumber}: ${(inv.totalHalalas / 100).toLocaleString('ar-SA-u-nu-latn')} ر.س${difference ? ` (فرق عن المصدر: ${difference.reason})` : ''}`,
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
    if (state === 'collected' && inv.salesOrderId) {
      const outstanding = await Invoice.countDocuments(
        {
          salesOrderId: inv.salesOrderId,
          deletedAt: null,
          _id: { $ne: inv._id },
          remainingHalalas: { $gt: 0 },
        },
        { session },
      );
      // The order closes once fully invoiced (state «مفوتر») and every invoice on it is collected (S3 fix 1).
      if (!outstanding) await markOrderClosed(String(inv.salesOrderId), session);
    }
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
  contractId?: string;
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
  if (query.contractId) filter.contractId = query.contractId;
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
<p>${inv.source === 'contract' && inv.periodFrom && inv.periodTo ? `الفترة: ${d(inv.periodFrom)} – ${d(inv.periodTo)} · ` : ''}العميل: <strong>${escapeHtml(inv.customer?.legalNameAr ?? inv.customer?.nameAr ?? '')}</strong>${inv.customer?.vatNumber ? ` · الرقم الضريبي ${escapeHtml(inv.customer.vatNumber)}` : ''}${inv.customer?.nationalAddress ? ` · ${escapeHtml(inv.customer.nationalAddress)}` : ''}</p>
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
