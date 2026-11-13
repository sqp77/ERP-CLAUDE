import { randomUUID } from 'node:crypto';
import { Types, type FilterQuery, type HydratedDocument } from 'mongoose';
import {
  PRICE_UNIT_AR,
  QUOTE_STATE_AR,
  VAT_RATE_BP,
  type CreateQuoteInput,
  type QuoteApprovalLevel,
} from '@eayni/shared';
import { badRequest, conflict, forbidden, notFound } from '../../core/http/errors';
import { actorFrom, type AuthedRequest } from '../../core/http/context';
import { recordAudit } from '../../core/audit/service';
import { nextNumber } from '../../core/numbering/service';
import { notify } from '../../core/notifications/service';
import { publish } from '../../core/outbox/service';
import { getSetting } from '../../core/settings/service';
import { claimAttachments } from '../../core/files/service';
import { Attachment } from '../../core/files/model';
import { storage } from '../../core/files/storage';
import { escapeHtml, htmlDocument } from '../../core/templates/render';
import { composeAndSend } from '../../core/email/service';
import { User } from '../../core/auth/model';
import { withTransaction } from '../../db';
import { riyadhDayRange } from '../../core/dates/businessDays';
import {
  canAccessCustomer,
  customerLabels,
  permissionOn,
  salesDepartmentId,
  salesManagerUserIds,
  userNames,
} from '../crm/service';
import { Opportunity, OpportunityEvent } from './model';
import { effectivePrices } from './pricing.service';
import { Quote, QuoteEvent, SalesOrder, type QuoteDoc } from './quotes.model';
import { SalesRequest } from './requests.model';
import { transitionRequest } from './requests.service';

type QuoteHydrated = HydratedDocument<QuoteDoc>;
const isManagerScope = (s: string) => s === 'department' || s === 'all';
const roundHalfUp = (n: number) => Math.floor(n + 0.5);

// ------------------------------------------------------------------------------------------------
// Lines, totals and the discount matrix [SAL §7.1, §7.2]
// ------------------------------------------------------------------------------------------------
export interface ComputedLine {
  itemId: string;
  descriptionAr: string;
  unit: string;
  quantity: number;
  listPriceHalalas: number;
  marketPriceHalalas?: number;
  discountPercentBp: number;
  discountHalalas: number;
  netUnitPriceHalalas: number;
  lineTotalHalalas: number;
  vatRateBp: number;
  vatHalalas: number;
  taxCategory: string;
}
export async function computeLines(lines: CreateQuoteInput['lines']) {
  const prices = await effectivePrices(lines.map((l) => l.itemId));
  const out: ComputedLine[] = [];
  const issues: { path: string; message: string }[] = [];
  lines.forEach((l, i) => {
    const p = prices.get(l.itemId);
    if (!p) return issues.push({ path: `lines.${i}.itemId`, message: 'المادة غير موجودة في قائمة الأسعار' });
    if (p.priceHalalas === null)
      return issues.push({ path: `lines.${i}.itemId`, message: `لا يوجد سعر ساري لـ ${p.nameAr}` });
    if (l.discountPercentBp !== undefined && l.discountHalalas !== undefined)
      return issues.push({
        path: `lines.${i}.discountHalalas`,
        message: 'اختر خصمًا نسبيًا أو مبلغًا، لا كليهما',
      });
    const list = p.priceHalalas;
    let discountHalalas =
      l.discountHalalas ?? (l.discountPercentBp ? roundHalfUp((list * l.discountPercentBp) / 10_000) : 0);
    if (discountHalalas > list)
      return issues.push({ path: `lines.${i}.discountHalalas`, message: 'الخصم يتجاوز سعر القائمة' });
    discountHalalas = Math.max(0, discountHalalas);
    const discountPercentBp =
      l.discountPercentBp ?? (list ? roundHalfUp((discountHalalas * 10_000) / list) : 0);
    const net = list - discountHalalas;
    const lineTotal = net * l.quantity;
    const vat = roundHalfUp((lineTotal * VAT_RATE_BP) / 10_000);
    out.push({
      itemId: l.itemId,
      descriptionAr: l.descriptionAr ?? p.nameAr,
      unit: p.unit,
      quantity: l.quantity,
      listPriceHalalas: list,
      marketPriceHalalas: p.marketPriceHalalas ?? undefined,
      discountPercentBp,
      discountHalalas,
      netUnitPriceHalalas: net,
      lineTotalHalalas: lineTotal,
      vatRateBp: VAT_RATE_BP,
      vatHalalas: vat,
      taxCategory: 'S',
    });
  });
  if (issues.length) throw badRequest('بنود العرض غير صالحة', issues);
  const subtotal = out.reduce((s, l) => s + l.lineTotalHalalas, 0);
  const discountTotal = out.reduce((s, l) => s + l.discountHalalas * l.quantity, 0);
  const vatTotal = out.reduce((s, l) => s + l.vatHalalas, 0);
  return {
    lines: out,
    subtotalHalalas: subtotal,
    discountTotalHalalas: discountTotal,
    vatTotalHalalas: vatTotal,
    totalHalalas: subtotal + vatTotal,
    maxDiscountBp: Math.max(0, ...out.map((l) => l.discountPercentBp)),
  };
}

/**
 * مصفوفة صلاحيات الخصم والاعتماد [SAL §7.2; DECISIONS §20 Q1/Q2/change 7]: limits come from `sales.discountLimitBp`;
 * while either limit is unset every discount needs the executive and the quote carries «حدود الخصم غير محددة».
 */
export async function approvalLevelFor(
  maxDiscountBp: number,
): Promise<{ level: QuoteApprovalLevel; limitsUnset: boolean }> {
  const [limits, mode] = await Promise.all([
    getSetting('sales.discountLimitBp'),
    getSetting('sales.quoteApprovalMode'),
  ]);
  const limitsUnset = limits.rep === null || limits.manager === null;
  if (maxDiscountBp === 0) return { level: mode === 'always' ? 'manager' : 'none', limitsUnset };
  if (limitsUnset) return { level: 'executive', limitsUnset: true };
  if (maxDiscountBp <= limits.rep!)
    return { level: mode === 'always' ? 'manager' : 'none', limitsUnset: false };
  if (maxDiscountBp <= limits.manager!) return { level: 'manager', limitsUnset: false };
  return { level: 'executive', limitsUnset: false };
}

// ------------------------------------------------------------------------------------------------
// Access
// ------------------------------------------------------------------------------------------------
function scopeFilter(
  req: AuthedRequest,
  eff: { scope: string; departmentIds: string[] },
): FilterQuery<unknown> {
  if (eff.scope === 'all') return {};
  if (eff.scope === 'department')
    return {
      $or: [
        { departmentId: { $in: eff.departmentIds.map((d) => new Types.ObjectId(d)) } },
        { ownerUserId: req.auth.user._id },
      ],
    };
  return { ownerUserId: req.auth.user._id };
}
async function loadFor(
  req: AuthedRequest,
  id: string,
  action: 'view' | 'edit' = 'view',
): Promise<{ q: QuoteHydrated; eff: { scope: string; departmentIds: string[] } }> {
  const eff = await permissionOn(req, 'sales.quotes', action);
  if (!eff) throw forbidden();
  const q = await Quote.findOne({ _id: id, deletedAt: null, ...scopeFilter(req, eff) });
  if (!q) throw notFound();
  return { q, eff };
}
export async function canAccessQuote(req: AuthedRequest, id: string): Promise<boolean> {
  const eff = await permissionOn(req, 'sales.quotes', 'view');
  return !!eff && !!(await Quote.exists({ _id: id, deletedAt: null, ...scopeFilter(req, eff) }));
}
/** Internal pricing fields are for the quote's owner, Sales management, Finance and the executive [SAL §16]. */
function seesInternal(req: AuthedRequest, q: QuoteDoc, eff: { scope: string }): boolean {
  const codes = req.auth.roleCodes;
  return (
    String(q.ownerUserId) === String(req.auth.user._id) ||
    isManagerScope(eff.scope) ||
    codes.includes('finance_staff') ||
    codes.includes('finance_manager') ||
    codes.includes('executive')
  );
}
const INTERNAL_KEYS = ['discountTotalHalalas', 'maxDiscountBp', 'approval', 'internalNotes'] as const;
function serialize(
  req: AuthedRequest,
  q: QuoteDoc & { _id: unknown },
  eff: { scope: string },
  extra: Record<string, unknown> = {},
) {
  const o: Record<string, unknown> = {
    ...(q as unknown as Record<string, unknown>),
    ...extra,
    stateAr: QUOTE_STATE_AR[q.state],
  };
  if (seesInternal(req, q, eff)) return o;
  for (const k of INTERNAL_KEYS) delete o[k];
  o.lines = q.lines.map((l) => ({
    descriptionAr: l.descriptionAr,
    unit: l.unit,
    quantity: l.quantity,
    netUnitPriceHalalas: l.netUnitPriceHalalas,
    lineTotalHalalas: l.lineTotalHalalas,
    vatHalalas: l.vatHalalas,
  }));
  delete o.events;
  return o;
}

// ------------------------------------------------------------------------------------------------
// Create / update / list / get
// ------------------------------------------------------------------------------------------------
async function validateLinks(
  req: AuthedRequest,
  customerId: string,
  opportunityId?: string,
  requestId?: string,
) {
  if (!(await canAccessCustomer(req, customerId))) throw notFound('العميل غير موجود');
  if (opportunityId) {
    const o = await Opportunity.findOne({ _id: opportunityId, deletedAt: null }).select('customerId').lean();
    if (!o || String(o.customerId) !== customerId)
      throw badRequest('الفرصة البيعية لعميل آخر', [
        { path: 'opportunityId', message: 'يجب أن تكون للعميل نفسه' },
      ]);
  }
  if (requestId) {
    const r = await SalesRequest.findOne({ _id: requestId, deletedAt: null }).select('customerId').lean();
    if (!r || String(r.customerId) !== customerId)
      throw badRequest('الطلب لعميل آخر', [{ path: 'requestId', message: 'يجب أن يكون للعميل نفسه' }]);
  }
}

export async function createQuote(
  req: AuthedRequest,
  input: CreateQuoteInput,
  opts: { previousQuoteId?: string; version?: number } = {},
) {
  await validateLinks(req, input.customerId, input.opportunityId, input.requestId);
  const computed = await computeLines(input.lines);
  const { level, limitsUnset } = await approvalLevelFor(computed.maxDiscountBp);
  const validityDays = input.validityDays ?? (await getSetting('sales.quoteValidityDays'));
  const actor = actorFrom(req);
  const departmentId = req.auth.user.departmentId ?? (await salesDepartmentId());
  const q = await withTransaction(async (session) => {
    const [doc] = await Quote.create(
      [
        {
          number: await nextNumber('quote', session),
          version: opts.version ?? 1,
          previousQuoteId: opts.previousQuoteId,
          customerId: input.customerId,
          contactId: input.contactId,
          opportunityId: input.opportunityId,
          requestId: input.requestId,
          ownerUserId: req.auth.user._id,
          departmentId,
          createdByUserId: req.auth.user._id,
          ...computed,
          approval: { requiredLevel: level, limitsUnset },
          validityDays,
          notesForCustomer: input.notesForCustomer,
          internalNotes: input.internalNotes,
          attachmentIds: input.attachmentIds,
        },
      ],
      { session, ordered: true },
    );
    if (input.attachmentIds.length)
      await claimAttachments(input.attachmentIds, 'quote', String(doc._id), req.auth.user._id, session);
    await QuoteEvent.create(
      [
        {
          quoteId: doc._id,
          type: 'created',
          toState: 'draft',
          byUserId: actor.userId,
          byEmail: actor.email,
          data: { maxDiscountBp: computed.maxDiscountBp, level },
        },
      ],
      { session, ordered: true },
    );
    await recordAudit(
      actor,
      {
        action: 'create',
        resource: 'sales.quotes',
        resourceId: String(doc._id),
        after: { number: doc.number, total: doc.totalHalalas, maxDiscountBp: computed.maxDiscountBp },
      },
      session,
    );
    return doc;
  });
  return getQuote(req, String(q._id));
}

export async function updateQuote(req: AuthedRequest, id: string, input: Partial<CreateQuoteInput>) {
  const { q } = await loadFor(req, id, 'edit');
  if (q.state !== 'draft') throw conflict('يُعدَّل العرض وهو مسودة فقط؛ أنشئ نسخة جديدة بعد الإرسال');
  const set: Record<string, unknown> = {};
  if (input.lines) {
    const computed = await computeLines(input.lines);
    const { level, limitsUnset } = await approvalLevelFor(computed.maxDiscountBp);
    Object.assign(set, computed, { 'approval.requiredLevel': level, 'approval.limitsUnset': limitsUnset });
    delete set.lines;
    set.lines = computed.lines;
  }
  for (const k of [
    'validityDays',
    'notesForCustomer',
    'internalNotes',
    'contactId',
    'attachmentIds',
  ] as const)
    if (input[k] !== undefined) set[k] = input[k];
  if (input.opportunityId !== undefined || input.requestId !== undefined) {
    await validateLinks(
      req,
      String(q.customerId),
      input.opportunityId ?? undefined,
      input.requestId ?? undefined,
    );
    if (input.opportunityId !== undefined) set.opportunityId = input.opportunityId;
    if (input.requestId !== undefined) set.requestId = input.requestId;
  }
  const actor = actorFrom(req);
  await withTransaction(async (session) => {
    if (input.attachmentIds?.length)
      await claimAttachments(input.attachmentIds, 'quote', id, req.auth.user._id, session);
    const r = await Quote.updateOne({ _id: id, state: 'draft' }, { $set: set }, { session });
    if (!r.matchedCount) throw conflict('تغيّرت حالة العرض، حدّث الصفحة');
    await QuoteEvent.create(
      [
        {
          quoteId: q._id,
          type: 'edited',
          byUserId: actor.userId,
          byEmail: actor.email,
          data: { maxDiscountBp: set.maxDiscountBp },
        },
      ],
      { session, ordered: true },
    );
    await recordAudit(
      actor,
      {
        action: 'update',
        resource: 'sales.quotes',
        resourceId: id,
        before: { total: q.totalHalalas, maxDiscountBp: q.maxDiscountBp },
        after: { total: set.totalHalalas, maxDiscountBp: set.maxDiscountBp },
      },
      session,
    );
  });
  return getQuote(req, id);
}

export interface ListQuotesQuery {
  page: number;
  limit: number;
  state?: string;
  customerId?: string;
  opportunityId?: string;
  requestId?: string;
  ownerUserId?: string;
  awaitingMyApproval?: boolean;
  q?: string;
  sentFrom?: string;
  sentTo?: string;
  /** Only the newest version of each offer (no later revision). */
  latest?: boolean;
}
/** The quote list filter, shared by the list and the KPI board / dashboard (SAL §11.2, §13). */
export function quoteListFilter(
  req: AuthedRequest,
  eff: { scope: string; departmentIds: string[] },
  query: Partial<ListQuotesQuery>,
): FilterQuery<unknown> {
  const filter: FilterQuery<unknown> = { deletedAt: null, ...scopeFilter(req, eff) };
  for (const k of ['state', 'customerId', 'opportunityId', 'requestId', 'ownerUserId'] as const)
    if (query[k]) filter[k] = query[k];
  const sent = riyadhDayRange(query.sentFrom, query.sentTo);
  if (sent) filter.sentAt = sent;
  if (query.latest) filter.supersededById = null;
  return filter;
}

export async function listQuotes(req: AuthedRequest, query: ListQuotesQuery) {
  const eff = await permissionOn(req, 'sales.quotes', 'view');
  if (!eff) throw forbidden();
  const filter = quoteListFilter(req, eff, query);
  if (query.awaitingMyApproval) {
    filter.state = 'pending_approval';
    const levels: string[] = [];
    if (req.auth.roleCodes.includes('sales_manager')) levels.push('manager');
    if (req.auth.roleCodes.includes('executive')) levels.push('executive');
    filter['approval.requiredLevel'] = { $in: levels.length ? levels : ['__none__'] };
  }
  if (query.q) filter.number = query.q.toUpperCase();
  const [rows, total] = await Promise.all([
    Quote.find(filter)
      .sort({ updatedAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Quote.countDocuments(filter),
  ]);
  const [names, customers] = await Promise.all([
    userNames(rows.map((r) => r.ownerUserId)),
    customerLabels(rows.map((r) => r.customerId)),
  ]);
  return {
    items: rows.map((r) =>
      serialize(req, r as never, eff, {
        ownerName: names.get(String(r.ownerUserId)) ?? '',
        customerName: customers.get(String(r.customerId))?.nameAr ?? '',
        customerNumber: customers.get(String(r.customerId))?.number,
      }),
    ),
    total,
    page: query.page,
    limit: query.limit,
  };
}

export async function getQuote(req: AuthedRequest, id: string) {
  const { q, eff } = await loadFor(req, id);
  const [events, names, customer, order, files] = await Promise.all([
    QuoteEvent.find({ quoteId: q._id }).sort({ at: 1 }).lean(),
    userNames([q.ownerUserId, q.approval?.approvedByUserId]),
    customerLabels([q.customerId]),
    q.salesOrderId ? SalesOrder.findById(q.salesOrderId).lean() : null,
    Attachment.find({
      _id: { $in: [...q.attachmentIds, ...(q.documentAttachmentId ? [q.documentAttachmentId] : [])] },
    })
      .select('originalName mimeType')
      .lean(),
  ]);
  const eventNames = await userNames(events.map((e) => e.byUserId));
  const codes = req.auth.roleCodes;
  const myLevels = [
    ...(codes.includes('sales_manager') ? ['manager'] : []),
    ...(codes.includes('executive') ? ['executive'] : []),
  ];
  const canApprove =
    q.state === 'pending_approval' &&
    (myLevels.includes(q.approval?.requiredLevel ?? 'none') || codes.includes('executive')) &&
    String(q.ownerUserId) !== String(req.auth.user._id) &&
    String(q.createdByUserId ?? '') !== String(req.auth.user._id);
  const isOwner = String(q.ownerUserId) === String(req.auth.user._id) || isManagerScope(eff.scope);
  const rejectionReasons = await getSetting('sales.quoteRejectionReasons');
  return serialize(req, q.toObject() as never, eff, {
    ownerName: names.get(String(q.ownerUserId)) ?? '',
    customerName: customer.get(String(q.customerId))?.nameAr,
    customerNumber: customer.get(String(q.customerId))?.number,
    events: events.map((e) => ({
      ...e,
      byName: e.byUserId ? eventNames.get(String(e.byUserId)) : undefined,
    })),
    salesOrder: order
      ? { _id: order._id, number: order.number, state: order.state, invoiceIds: order.invoiceIds }
      : null,
    files,
    canEdit: isOwner && q.state === 'draft',
    canSubmit: isOwner && q.state === 'draft',
    canApprove,
    canSend: isOwner && q.state === 'approved',
    canRespond: isOwner && (q.state === 'sent' || q.state === 'negotiating'),
    canRevise: isOwner && ['sent', 'negotiating', 'rejected'].includes(q.state),
    rejectionReasons,
  });
}

// ------------------------------------------------------------------------------------------------
// Approval [SAL §3 م2, §7.2]
// ------------------------------------------------------------------------------------------------
async function logAndAudit(
  q: QuoteHydrated,
  type: string,
  from: string,
  to: string,
  req: AuthedRequest,
  note?: string,
  data?: Record<string, unknown>,
) {
  const actor = actorFrom(req);
  await QuoteEvent.create({
    quoteId: q._id,
    type,
    fromState: from,
    toState: to,
    byUserId: actor.userId,
    byEmail: actor.email,
    note,
    data,
  });
  await recordAudit(actor, {
    action: 'transition',
    resource: 'sales.quotes',
    resourceId: String(q._id),
    before: { state: from },
    after: { state: to },
    meta: { type, ...(data ?? {}) },
  });
}
async function moveState(
  q: QuoteHydrated,
  from: string,
  to: string,
  set: Record<string, unknown> = {},
  unset: string[] = [],
) {
  const r = await Quote.updateOne(
    { _id: q._id, state: from },
    {
      $set: { state: to, ...set },
      ...(unset.length ? { $unset: Object.fromEntries(unset.map((k) => [k, 1])) } : {}),
    },
  );
  if (!r.matchedCount) throw conflict('تغيّرت حالة العرض من مستخدم آخر، حدّث الصفحة');
}
async function approversFor(level: QuoteApprovalLevel, q: QuoteDoc): Promise<string[]> {
  if (level === 'manager') return salesManagerUserIds(String(q.departmentId));
  if (level === 'executive')
    return (
      await User.find({ status: 'active', deletedAt: null, 'roles.role': 'executive' }).select('_id').lean()
    ).map((u) => String(u._id));
  return [];
}

export async function submitQuote(req: AuthedRequest, id: string) {
  const { q } = await loadFor(req, id, 'edit');
  if (q.state !== 'draft') throw conflict('العرض ليس مسودة');
  const matrix = await approvalLevelFor(q.maxDiscountBp ?? 0);
  const { limitsUnset } = matrix;
  let level = matrix.level;
  const escalationUnset = ['approval.escalatedFrom', 'approval.escalationReason', 'approval.approvedLevel'];
  if (level === 'none') {
    await moveState(
      q,
      'draft',
      'approved',
      {
        'approval.requiredLevel': 'none',
        'approval.limitsUnset': limitsUnset,
        'approval.approvedAt': new Date(),
      },
      escalationUnset,
    );
    await logAndAudit(q, 'auto_approved', 'draft', 'approved', req, undefined, { level });
    return getQuote(req, id);
  }
  // S3 fix 3: when the only holder of the required level is the quote's author (e.g. the Sales manager's own quote),
  // nobody could approve it — escalate to the executive at submit time and record why.
  const excluded = new Set([
    String(q.ownerUserId),
    String(q.createdByUserId ?? ''),
    String(req.auth.user._id),
  ]);
  let escalatedFrom: QuoteApprovalLevel | undefined;
  if (level === 'manager' && !(await approversFor('manager', q)).some((u) => !excluded.has(u))) {
    escalatedFrom = 'manager';
    level = 'executive';
  }
  await moveState(
    q,
    'draft',
    'pending_approval',
    {
      'approval.requiredLevel': level,
      'approval.limitsUnset': limitsUnset,
      'approval.requestedAt': new Date(),
      ...(escalatedFrom
        ? { 'approval.escalatedFrom': escalatedFrom, 'approval.escalationReason': 'author_is_only_approver' }
        : {}),
    },
    escalatedFrom ? ['approval.approvedLevel'] : escalationUnset,
  );
  await logAndAudit(q, 'approval_requested', 'draft', 'pending_approval', req, undefined, {
    level,
    limitsUnset,
    maxDiscountBp: q.maxDiscountBp,
    ...(escalatedFrom ? { escalatedFrom, escalationReason: 'author_is_only_approver' } : {}),
  });
  const approvers = (await approversFor(level, q)).filter((u) => !excluded.has(u));
  await notify({
    userIds: approvers,
    type: 'sales.quote.approval_requested',
    bodyAr: `${q.number} — خصم ${((q.maxDiscountBp ?? 0) / 100).toFixed(1)}%${limitsUnset ? ' (حدود الخصم غير محددة)' : ''}${escalatedFrom ? ' — مُصعَّد إليك لأن مُعِدّ العرض هو المعتمد الوحيد في مستواه' : ''}`,
    link: `/sales/quotes/${q._id}`,
    data: { quoteId: id },
  });
  return getQuote(req, id);
}

/**
 * Approve or refuse: the level's holder (the executive, as the higher authority, may decide any level), never the
 * quote's author or creator; the approver's name and the level they acted at are kept [SAL §7.2; S3 fix 3].
 */
export async function decideQuote(
  req: AuthedRequest,
  id: string,
  decision: 'approve' | 'reject',
  note?: string,
) {
  const eff = await permissionOn(req, 'sales.quotes', 'approve');
  if (!eff) throw forbidden();
  const q = await Quote.findOne({ _id: id, deletedAt: null });
  if (!q) throw notFound();
  if (q.state !== 'pending_approval') throw conflict('العرض ليس بانتظار الاعتماد');
  const level = q.approval?.requiredLevel ?? 'none';
  const codes = req.auth.roleCodes;
  const asManager =
    level === 'manager' &&
    codes.includes('sales_manager') &&
    (eff.scope === 'all' || eff.departmentIds.includes(String(q.departmentId)));
  const asExecutive = codes.includes('executive');
  if (!asManager && !asExecutive) throw forbidden('اعتماد هذا الخصم ليس من صلاحياتك');
  const approvedLevel: QuoteApprovalLevel = asManager ? 'manager' : 'executive';
  if (
    String(q.ownerUserId) === String(req.auth.user._id) ||
    String(q.createdByUserId ?? '') === String(req.auth.user._id)
  )
    throw forbidden('لا يجوز لمن أعدّ العرض اعتماده');
  if (decision === 'reject' && !note?.trim()) throw badRequest('سبب الرفض مطلوب');
  const to = decision === 'approve' ? 'approved' : 'draft';
  await moveState(
    q,
    'pending_approval',
    to,
    decision === 'approve'
      ? {
          'approval.approvedByUserId': req.auth.user._id,
          'approval.approvedByName': req.auth.user.displayNameAr,
          'approval.approvedAt': new Date(),
          'approval.approvedLevel': approvedLevel,
          'approval.note': note,
        }
      : { 'approval.note': note },
  );
  await logAndAudit(
    q,
    decision === 'approve' ? 'approved' : 'approval_rejected',
    'pending_approval',
    to,
    req,
    note,
    { level, approvedLevel },
  );
  await notify({
    userIds: [String(q.ownerUserId)].filter((u) => u !== String(req.auth.user._id)),
    type: 'sales.quote.decided',
    bodyAr: `${q.number}: ${decision === 'approve' ? 'تم اعتماد العرض' : 'رُفض اعتماد العرض'}${note ? ` — ${note}` : ''}`,
    link: `/sales/quotes/${q._id}`,
    data: { quoteId: id },
  });
  return getQuote(req, id);
}

// ------------------------------------------------------------------------------------------------
// Customer-facing document [SAL §7.3 «متطلب مهم»]: net prices only
// ------------------------------------------------------------------------------------------------
export interface CustomerQuoteDto {
  number: string;
  version: number;
  issuedAt: string;
  validUntil?: string;
  customer: { nameAr: string; number?: string };
  lines: {
    descriptionAr: string;
    unit: string;
    quantity: number;
    unitPriceHalalas: number;
    lineTotalHalalas: number;
    vatHalalas: number;
  }[];
  subtotalHalalas: number;
  vatTotalHalalas: number;
  totalHalalas: number;
  notes?: string;
}
export function toCustomerQuoteDto(
  q: QuoteDoc,
  customer: { nameAr: string; number?: string },
  issuedAt = new Date(),
): CustomerQuoteDto {
  const validUntil = q.validUntil ?? new Date(issuedAt.getTime() + q.validityDays * 86_400_000);
  return {
    number: q.number,
    version: q.version,
    issuedAt: issuedAt.toISOString(),
    validUntil: validUntil.toISOString(),
    customer,
    lines: q.lines.map((l) => ({
      descriptionAr: l.descriptionAr,
      unit: PRICE_UNIT_AR[l.unit as keyof typeof PRICE_UNIT_AR] ?? l.unit,
      quantity: l.quantity,
      unitPriceHalalas: l.netUnitPriceHalalas,
      lineTotalHalalas: l.lineTotalHalalas,
      vatHalalas: l.vatHalalas,
    })),
    subtotalHalalas: q.subtotalHalalas,
    vatTotalHalalas: q.vatTotalHalalas,
    totalHalalas: q.totalHalalas,
    notes: q.notesForCustomer ?? undefined,
  };
}
const sar = (h: number) => `${(h / 100).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2 })} ر.س`;
const fmtDate = (d: string) =>
  new Intl.DateTimeFormat('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', dateStyle: 'medium' }).format(
    new Date(d),
  );
/** Renders ONLY the DTO: there is no list price, discount or previous price to leak. */
export function renderCustomerQuoteHtml(dto: CustomerQuoteDto, orgName: string): string {
  const rows = dto.lines
    .map(
      (l) =>
        `<tr><td>${escapeHtml(l.descriptionAr)}</td><td>${escapeHtml(l.unit)}</td><td>${l.quantity}</td><td>${sar(l.unitPriceHalalas)}</td><td>${sar(l.lineTotalHalalas)}</td><td>${sar(l.vatHalalas)}</td></tr>`,
    )
    .join('');
  const body = `<div style="text-align:center"><h2>${escapeHtml(orgName)}</h2><h3>عرض سعر</h3><p>رقم: ${escapeHtml(dto.number)} · النسخة ${dto.version} · التاريخ: ${fmtDate(dto.issuedAt)}${dto.validUntil ? ` · ساري حتى ${fmtDate(dto.validUntil)}` : ''}</p></div>
<p>السادة / ${escapeHtml(dto.customer.nameAr)} المحترمين،</p>
<table><thead><tr><th>البند</th><th>الوحدة</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th><th>الضريبة (15%)</th></tr></thead><tbody>${rows}</tbody></table>
<p>الإجمالي قبل الضريبة: <strong>${sar(dto.subtotalHalalas)}</strong> · ضريبة القيمة المضافة: <strong>${sar(dto.vatTotalHalalas)}</strong> · الإجمالي: <strong>${sar(dto.totalHalalas)}</strong></p>
${dto.notes ? `<p>${escapeHtml(dto.notes)}</p>` : ''}<p style="margin-top:48px">قسم المبيعات</p>`;
  return htmlDocument(body, dto.number);
}

/** Send to the customer: the document is generated and stored, the message goes through the mailbox adapter [SAL §3 م3, §7.3, §10.1]. */
export async function sendQuote(
  req: AuthedRequest,
  id: string,
  input: { to: string[]; cc: string[]; subject?: string; body?: string; attachmentIds: string[] },
) {
  const { q } = await loadFor(req, id, 'edit');
  if (q.state !== 'approved') throw conflict('يُرسل العرض بعد اعتماده');
  const customer = (await customerLabels([q.customerId])).get(String(q.customerId)) ?? {
    nameAr: '',
    number: '',
  };
  const orgName = await getSetting('general.organizationNameAr');
  const now = new Date();
  const dto = toCustomerQuoteDto(q, customer, now);
  const html = renderCustomerQuoteHtml(dto, orgName);
  const key = `quotes/${now.getUTCFullYear()}/${q.number}-v${q.version}-${randomUUID().slice(0, 8)}.html`;
  await storage().putObject(key, Buffer.from(html, 'utf8'), 'text/html; charset=utf-8');
  const [att] = await Attachment.create([
    {
      key,
      originalName: `${q.number}.html`,
      mimeType: 'text/html',
      size: Buffer.byteLength(html),
      status: 'uploaded',
      uploadedAt: now,
      uploadedBy: req.auth.user._id,
      ownerType: 'quote',
      ownerId: String(q._id),
      sensitive: false,
    },
  ]);
  const subject = input.subject ?? `عرض سعر ${q.number} — ${orgName}`;
  const bodyText =
    input.body ??
    `السادة ${customer.nameAr}،\nنرفق لكم عرض السعر رقم ${q.number} بقيمة إجمالية ${sar(q.totalHalalas)} شاملة الضريبة، ساري حتى ${fmtDate(dto.validUntil!)}.\nمع التحية،\n${req.auth.user.displayNameAr}`;
  const msg = await composeAndSend(
    { recordType: 'quote', recordId: String(q._id), customerId: q.customerId },
    {
      from: {
        userId: String(req.auth.user._id),
        email: req.auth.user.email,
        name: req.auth.user.displayNameAr,
        mailbox: 'user',
      },
      to: input.to,
      cc: input.cc,
      subject,
      bodyText,
      attachmentIds: [String(att._id), ...input.attachmentIds],
    },
  );
  await moveState(q, 'approved', 'sent', {
    sentAt: now,
    sentVia: msg.state === 'sent' ? 'system' : 'external',
    validUntil: new Date(dto.validUntil!),
    documentAttachmentId: att._id,
    emailMessageId: msg._id,
  });
  await logAndAudit(q, 'sent', 'approved', 'sent', req, undefined, { to: input.to, via: msg.state });
  // The opportunity moves to «عرض سعر مرسل» [SAL §3, §4.1]; the linked request too when it is at the quoting stage.
  if (q.opportunityId) {
    const o = await Opportunity.findOneAndUpdate(
      {
        _id: q.opportunityId,
        stage: { $in: ['new', 'in_progress', 'contacted', 'meeting_scheduled', 'negotiating'] },
      },
      { $set: { stage: 'quote_sent', lastContactAt: now } },
      { new: false },
    );
    if (o)
      await OpportunityEvent.create({
        opportunityId: o._id,
        type: 'stage_changed',
        from: o.stage,
        to: 'quote_sent',
        byUserId: String(req.auth.user._id),
        byEmail: req.auth.user.email,
        note: q.number,
      });
  }
  if (q.requestId) {
    const r = await SalesRequest.findById(q.requestId).select('state').lean();
    if (r && ['new', 'quoting', 'negotiating'].includes(r.state)) {
      try {
        if (r.state === 'new')
          await transitionRequest(req, String(q.requestId), {
            transition: 'start_quote',
            payload: {},
            attachmentIds: [],
          });
        await transitionRequest(req, String(q.requestId), {
          transition: 'send_quote',
          payload: {},
          attachmentIds: [],
          note: q.number,
        });
      } catch {
        /* the request's workflow may not allow it from here; the quote is sent regardless */
      }
    }
  }
  await notify({
    userIds: (await salesManagerUserIds(String(q.departmentId))).filter(
      (u) => u !== String(req.auth.user._id),
    ),
    type: 'sales.quote.status',
    bodyAr: `${q.number}: ${QUOTE_STATE_AR.sent}`,
    link: `/sales/quotes/${q._id}`,
    data: { quoteId: id },
  });
  await publish({
    type: 'sales.quote.sent',
    aggregateType: 'quote',
    aggregateId: id,
    payload: { number: q.number, customerId: String(q.customerId) },
    actorUserId: String(req.auth.user._id),
  });
  return { ...(await getQuote(req, id)), mailto: msg.mailto, emailState: msg.state };
}

/** The customer's reply [SAL §3 م3]: accepted → sales order (and contract draft when asked); rejected needs a reason; negotiating. */
export async function respondQuote(
  req: AuthedRequest,
  id: string,
  input: {
    response: 'accepted' | 'rejected' | 'negotiating';
    reason?: string;
    note?: string;
    signedFileAttachmentId?: string;
    createContract?: boolean;
  },
) {
  const { q } = await loadFor(req, id, 'edit');
  if (!['sent', 'negotiating'].includes(q.state)) throw conflict('لا يمكن تسجيل رد العميل في هذه الحالة');
  const now = new Date();
  if (input.response === 'rejected') {
    const reasons = await getSetting('sales.quoteRejectionReasons');
    if (!reasons.includes(input.reason!))
      throw badRequest('سبب الرفض غير معرّف في القائمة', [
        { path: 'reason', message: 'اختر سببًا من القائمة' },
      ]);
    if (input.reason!.startsWith('أخرى') && !input.note)
      throw badRequest('وضّح السبب', [{ path: 'note', message: 'التوضيح مطلوب مع «أخرى»' }]);
  }
  const response = {
    state: input.response,
    reason: input.reason,
    note: input.note,
    at: now,
    byUserId: req.auth.user._id,
  };
  let orderId: unknown;
  if (input.response === 'accepted') {
    const customer = (await customerLabels([q.customerId])).get(String(q.customerId));
    await withTransaction(async (session) => {
      if (input.signedFileAttachmentId)
        await claimAttachments([input.signedFileAttachmentId], 'quote', id, req.auth.user._id, session);
      const [order] = await SalesOrder.create(
        [
          {
            number: await nextNumber('salesOrder', session),
            quoteId: q._id,
            customerId: q.customerId,
            requestId: q.requestId,
            opportunityId: q.opportunityId,
            ownerUserId: q.ownerUserId,
            departmentId: q.departmentId,
            lines: q.lines.map((l) => ({
              itemId: l.itemId,
              descriptionAr: l.descriptionAr,
              unit: l.unit,
              quantity: l.quantity,
              unitPriceHalalas: l.netUnitPriceHalalas,
              lineTotalHalalas: l.lineTotalHalalas,
              vatRateBp: l.vatRateBp,
              vatHalalas: l.vatHalalas,
              taxCategory: l.taxCategory,
            })),
            subtotalHalalas: q.subtotalHalalas,
            vatTotalHalalas: q.vatTotalHalalas,
            totalHalalas: q.totalHalalas,
            signedFileAttachmentId: input.signedFileAttachmentId,
            createdByUserId: req.auth.user._id,
          },
        ],
        { session, ordered: true },
      );
      orderId = order._id;
      const r = await Quote.updateOne(
        { _id: q._id, state: q.state },
        { $set: { state: 'accepted', customerResponse: response, salesOrderId: order._id } },
        { session },
      );
      if (!r.matchedCount) throw conflict('تغيّرت حالة العرض، حدّث الصفحة');
      if (q.requestId)
        await SalesRequest.updateOne(
          { _id: q.requestId },
          { $set: { quoteId: q._id, salesOrderId: order._id, lastActivityAt: now } },
          { session },
        );
      await recordAudit(
        actorFrom(req),
        {
          action: 'create',
          resource: 'sales.orders',
          resourceId: String(order._id),
          after: {
            number: order.number,
            quote: q.number,
            total: order.totalHalalas,
            customer: customer?.number,
          },
        },
        session,
      );
      await publish(
        {
          type: 'sales.order.created',
          aggregateType: 'sales_order',
          aggregateId: String(order._id),
          payload: {
            number: order.number,
            quoteId: id,
            customerId: String(q.customerId),
            totalHalalas: order.totalHalalas,
          },
          actorUserId: String(req.auth.user._id),
        },
        session,
      );
    });
    await logAndAudit(q, 'accepted', q.state, 'accepted', req, input.note, { salesOrderId: String(orderId) });
    if (q.requestId) {
      try {
        await transitionRequest(req, String(q.requestId), {
          transition: 'customer_approve',
          payload: {},
          attachmentIds: input.signedFileAttachmentId ? [input.signedFileAttachmentId] : [],
          note: q.number,
        });
      } catch {
        /* not every route has this step from the current state */
      }
    }
  } else {
    await moveState(q, q.state, input.response, { customerResponse: response });
    await logAndAudit(q, input.response, q.state, input.response, req, input.reason ?? input.note, {
      reason: input.reason,
    });
    if (input.response === 'negotiating' && q.opportunityId) {
      const o = await Opportunity.findOneAndUpdate(
        { _id: q.opportunityId, stage: { $nin: ['won', 'lost'] } },
        { $set: { stage: 'negotiating', lastContactAt: now } },
        { new: false },
      );
      if (o && o.stage !== 'negotiating')
        await OpportunityEvent.create({
          opportunityId: o._id,
          type: 'stage_changed',
          from: o.stage,
          to: 'negotiating',
          byUserId: String(req.auth.user._id),
          byEmail: req.auth.user.email,
          note: q.number,
        });
    }
  }
  await notify({
    userIds: (await salesManagerUserIds(String(q.departmentId))).filter(
      (u) => u !== String(req.auth.user._id),
    ),
    type: 'sales.quote.status',
    bodyAr: `${q.number}: ${QUOTE_STATE_AR[input.response]}${input.reason ? ` — ${input.reason}` : ''}`,
    link: `/sales/quotes/${q._id}`,
    data: { quoteId: id },
  });
  return getQuote(req, id);
}

/** A new version after negotiation or rejection: same customer and links, lines copied as a draft [SAL §3 م3]. */
export async function reviseQuote(req: AuthedRequest, id: string) {
  const { q } = await loadFor(req, id, 'edit');
  if (!['sent', 'negotiating', 'rejected'].includes(q.state))
    throw conflict('تُنشأ نسخة جديدة بعد الإرسال أو التفاوض أو الرفض');
  if (q.supersededById) throw conflict('لهذا العرض نسخة أحدث');
  const created = await createQuote(
    req,
    {
      customerId: String(q.customerId),
      opportunityId: q.opportunityId ? String(q.opportunityId) : undefined,
      requestId: q.requestId ? String(q.requestId) : undefined,
      contactId: q.contactId ? String(q.contactId) : undefined,
      validityDays: q.validityDays,
      notesForCustomer: q.notesForCustomer ?? undefined,
      internalNotes: q.internalNotes ?? undefined,
      attachmentIds: [],
      lines: q.lines.map((l) => ({
        itemId: String(l.itemId),
        descriptionAr: l.descriptionAr,
        quantity: l.quantity,
        discountPercentBp: l.discountPercentBp || undefined,
      })),
    },
    { previousQuoteId: String(q._id), version: (q.version ?? 1) + 1 },
  );
  // One offer per chain for «نسبة تحويل العروض» [SAL §11]: the previous version is marked superseded (set once).
  await Quote.updateOne(
    { _id: q._id, supersededById: null },
    { $set: { supersededById: (created as { _id: unknown })._id } },
  );
  return created;
}

export async function cancelQuote(req: AuthedRequest, id: string, reason: string) {
  const { q } = await loadFor(req, id, 'edit');
  if (['accepted', 'cancelled'].includes(q.state)) throw conflict('لا يمكن إلغاء هذا العرض');
  await moveState(q, q.state, 'cancelled');
  await logAndAudit(q, 'cancelled', q.state, 'cancelled', req, reason);
  return getQuote(req, id);
}

/** Customer-facing HTML of a quote (owner / Sales / Finance), generated on demand before sending. */
export async function customerDocument(req: AuthedRequest, id: string): Promise<string> {
  const { q } = await loadFor(req, id);
  const customer = (await customerLabels([q.customerId])).get(String(q.customerId)) ?? {
    nameAr: '',
    number: '',
  };
  await recordAudit(actorFrom(req), {
    action: 'view',
    resource: 'sales.quotes',
    resourceId: id,
    meta: { customerDocument: true },
  });
  return renderCustomerQuoteHtml(
    toCustomerQuoteDto(q, customer, q.sentAt ?? new Date()),
    await getSetting('general.organizationNameAr'),
  );
}

export async function getSalesOrder(req: AuthedRequest, id: string) {
  const o = await SalesOrder.findOne({ _id: id, deletedAt: null }).lean();
  if (!o) throw notFound();
  if (!(await canAccessQuote(req, String(o.quoteId)))) {
    const codes = req.auth.roleCodes;
    if (!codes.includes('finance_staff') && !codes.includes('finance_manager')) throw notFound();
  }
  const customer = (await customerLabels([o.customerId])).get(String(o.customerId));
  return { ...o, customerName: customer?.nameAr, customerNumber: customer?.number };
}
