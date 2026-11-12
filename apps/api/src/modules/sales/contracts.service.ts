import { randomUUID } from 'node:crypto';
import { Types, type FilterQuery, type HydratedDocument } from 'mongoose';
import { SALES_CONTRACT_STATE_AR, SCHEDULE_KIND_AR } from '@eayni/shared';
import { badRequest, conflict, forbidden, notFound } from '../../core/http/errors';
import { actorFrom, type AuthedRequest } from '../../core/http/context';
import { recordAudit } from '../../core/audit/service';
import { nextNumber } from '../../core/numbering/service';
import { notify } from '../../core/notifications/service';
import { getSetting } from '../../core/settings/service';
import { claimAttachments } from '../../core/files/service';
import { Attachment } from '../../core/files/model';
import { storage } from '../../core/files/storage';
import { escapeHtml, htmlDocument } from '../../core/templates/render';
import { composeAndSend } from '../../core/email/service';
import { riyadhDate } from '../../core/dates/businessDays';
import { withTransaction } from '../../db';
import {
  canAccessCustomer,
  customerLabels,
  permissionOn,
  salesDepartmentId,
  salesManagerUserIds,
  userNames,
} from '../crm/service';
import {
  ContractEvent,
  CooperationCertificate,
  SalesContract,
  type SalesContractDoc,
} from './contracts.model';

const DAY = 86_400_000;
const isManagerScope = (s: string) => s === 'department' || s === 'all';
type ContractHydrated = HydratedDocument<SalesContractDoc>;

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
): Promise<{ c: ContractHydrated; eff: { scope: string; departmentIds: string[] } }> {
  const eff = await permissionOn(req, 'sales.contracts', action);
  if (!eff) throw forbidden();
  const c = await SalesContract.findOne({ _id: id, deletedAt: null, ...scopeFilter(req, eff) });
  if (!c) throw notFound();
  return { c, eff };
}
export async function canAccessContract(req: AuthedRequest, id: string): Promise<boolean> {
  const eff = await permissionOn(req, 'sales.contracts', 'view');
  return !!eff && !!(await SalesContract.exists({ _id: id, deletedAt: null, ...scopeFilter(req, eff) }));
}
const monthsBetween = (a: Date, b: Date) =>
  Math.max(
    0,
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
      (b.getUTCMonth() - a.getUTCMonth()) +
      (b.getUTCDate() >= a.getUTCDate() ? 0 : -1),
  );
/** «عقد مدته سنة أو أكثر» [SAL §6.3]: at least 364 days — a calendar year written as 1 Jan → 31 Dec counts. */
const isYearOrMore = (c: { startDate: Date; endDate: Date }) =>
  c.endDate.getTime() - c.startDate.getTime() >= 364 * DAY;

export interface ContractInput {
  customerId?: string;
  contractType?: string;
  requestId?: string;
  salesOrderId?: string;
  quoteId?: string;
  startDate?: string;
  endDate?: string;
  items?: {
    itemId?: string;
    descriptionAr: string;
    quantity?: number;
    unit?: string;
    agreedPriceHalalas?: number;
  }[];
  schedule?: { plannedAt: string; kind: string; note?: string }[];
  signedFileAttachmentId?: string;
  notes?: string;
  renewalOf?: string;
}
export async function createContract(
  req: AuthedRequest,
  input: ContractInput & { customerId: string; startDate: string; endDate: string },
  state: 'draft' | 'active' = 'active',
) {
  if (!(await canAccessCustomer(req, input.customerId))) throw notFound('العميل غير موجود');
  const start = new Date(`${input.startDate}T00:00:00+03:00`);
  const end = new Date(`${input.endDate}T23:59:59+03:00`);
  if (end <= start)
    throw badRequest('تاريخ النهاية قبل البداية', [{ path: 'endDate', message: 'بعد تاريخ البداية' }]);
  const actor = actorFrom(req);
  const c = await withTransaction(async (session) => {
    const [doc] = await SalesContract.create(
      [
        {
          number: await nextNumber('contract', session),
          customerId: input.customerId,
          contractType: input.contractType,
          requestId: input.requestId,
          salesOrderId: input.salesOrderId,
          quoteId: input.quoteId,
          ownerUserId: req.auth.user._id,
          departmentId: req.auth.user.departmentId ?? (await salesDepartmentId()),
          startDate: start,
          endDate: end,
          durationMonths: monthsBetween(start, end),
          items: input.items ?? [],
          schedule: (input.schedule ?? []).map((s) => ({
            plannedAt: new Date(s.plannedAt),
            kind: s.kind,
            note: s.note,
            status: 'planned',
          })),
          signedFileAttachmentId: input.signedFileAttachmentId,
          notes: input.notes,
          renewalOf: input.renewalOf,
          state: input.signedFileAttachmentId ? state : state === 'active' ? 'active' : 'draft',
          createdByUserId: req.auth.user._id,
        },
      ],
      { session, ordered: true },
    );
    if (input.signedFileAttachmentId)
      await claimAttachments(
        [input.signedFileAttachmentId],
        'sales_contract',
        String(doc._id),
        req.auth.user._id,
        session,
      );
    if (input.renewalOf) {
      await SalesContract.updateOne(
        { _id: input.renewalOf },
        { $set: { state: 'renewed', renewedById: doc._id } },
        { session },
      );
      await ContractEvent.create(
        [
          {
            contractId: new Types.ObjectId(input.renewalOf),
            type: 'renewed',
            note: doc.number,
            byUserId: actor.userId,
            byEmail: actor.email,
          },
        ],
        { session, ordered: true },
      );
    }
    await ContractEvent.create(
      [
        {
          contractId: doc._id,
          type: 'created',
          byUserId: actor.userId,
          byEmail: actor.email,
          data: { startDate: input.startDate, endDate: input.endDate },
        },
      ],
      { session, ordered: true },
    );
    await recordAudit(
      actor,
      {
        action: 'create',
        resource: 'sales.contracts',
        resourceId: String(doc._id),
        after: {
          number: doc.number,
          customerId: input.customerId,
          startDate: input.startDate,
          endDate: input.endDate,
        },
      },
      session,
    );
    return doc;
  });
  return getContract(req, String(c._id));
}

export async function updateContract(req: AuthedRequest, id: string, input: ContractInput) {
  const { c } = await loadFor(req, id, 'edit');
  if (['expired', 'renewed', 'terminated'].includes(c.state))
    throw conflict('العقد منتهٍ ولا يُعدَّل؛ أنشئ تجديدًا');
  const set: Record<string, unknown> = {};
  if (input.startDate) set.startDate = new Date(`${input.startDate}T00:00:00+03:00`);
  if (input.endDate) set.endDate = new Date(`${input.endDate}T23:59:59+03:00`);
  const start = (set.startDate as Date) ?? c.startDate;
  const end = (set.endDate as Date) ?? c.endDate;
  if (end <= start) throw badRequest('تاريخ النهاية قبل البداية');
  set.durationMonths = monthsBetween(start, end);
  for (const k of ['contractType', 'items', 'notes', 'requestId', 'salesOrderId', 'quoteId'] as const)
    if (input[k] !== undefined) set[k] = input[k];
  if (input.schedule)
    set.schedule = input.schedule.map((s) => ({
      plannedAt: new Date(s.plannedAt),
      kind: s.kind,
      note: s.note,
      status: 'planned',
    }));
  if (input.signedFileAttachmentId) {
    set.signedFileAttachmentId = input.signedFileAttachmentId;
    if (c.state === 'draft') set.state = 'active';
  }
  const actor = actorFrom(req);
  await withTransaction(async (session) => {
    if (input.signedFileAttachmentId)
      await claimAttachments(
        [input.signedFileAttachmentId],
        'sales_contract',
        id,
        req.auth.user._id,
        session,
      );
    await SalesContract.updateOne({ _id: id }, { $set: set }, { session });
    await ContractEvent.create(
      [
        {
          contractId: c._id,
          type: 'updated',
          note: Object.keys(input).join(', '),
          byUserId: actor.userId,
          byEmail: actor.email,
        },
      ],
      { session, ordered: true },
    );
    await recordAudit(
      actor,
      {
        action: 'update',
        resource: 'sales.contracts',
        resourceId: id,
        before: { startDate: c.startDate, endDate: c.endDate, items: c.items },
        after: set,
      },
      session,
    );
  });
  return getContract(req, id);
}

export interface ListContractsQuery {
  page: number;
  limit: number;
  state?: string;
  customerId?: string;
  expiringWithinDays?: number;
  q?: string;
}
export async function listContracts(req: AuthedRequest, query: ListContractsQuery) {
  const eff = await permissionOn(req, 'sales.contracts', 'view');
  if (!eff) throw forbidden();
  const filter: FilterQuery<unknown> = { deletedAt: null, ...scopeFilter(req, eff) };
  if (query.state) filter.state = query.state;
  if (query.customerId) filter.customerId = query.customerId;
  if (query.expiringWithinDays)
    Object.assign(filter, {
      state: { $in: ['active', 'expiring'] },
      endDate: { $lte: new Date(Date.now() + query.expiringWithinDays * DAY) },
    });
  if (query.q) filter.number = query.q.toUpperCase();
  const [rows, total] = await Promise.all([
    SalesContract.find(filter)
      .sort({ endDate: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    SalesContract.countDocuments(filter),
  ]);
  const [names, customers] = await Promise.all([
    userNames(rows.map((r) => r.ownerUserId)),
    customerLabels(rows.map((r) => r.customerId)),
  ]);
  return {
    items: rows.map((r) => ({
      ...r,
      stateAr: SALES_CONTRACT_STATE_AR[r.state as keyof typeof SALES_CONTRACT_STATE_AR],
      ownerName: names.get(String(r.ownerUserId)) ?? '',
      customerName: customers.get(String(r.customerId))?.nameAr ?? '',
      daysLeft: Math.ceil((r.endDate.getTime() - Date.now()) / DAY),
      yearOrMore: isYearOrMore(r),
    })),
    total,
    page: query.page,
    limit: query.limit,
  };
}

export async function getContract(req: AuthedRequest, id: string) {
  const { c, eff } = await loadFor(req, id);
  const [events, certs, customer, names] = await Promise.all([
    ContractEvent.find({ contractId: c._id }).sort({ at: 1 }).lean(),
    CooperationCertificate.find({ contractId: c._id }).sort({ issuedAt: 1 }).lean(),
    customerLabels([c.customerId]),
    userNames([c.ownerUserId]),
  ]);
  const alertDays = await getSetting('sales.contractAlertDaysBefore');
  const eventNames = await userNames(events.map((e) => e.byUserId));
  const certificateWindowFrom = new Date(c.endDate.getTime() - alertDays * DAY);
  const canCertify =
    isYearOrMore(c) &&
    Date.now() >= certificateWindowFrom.getTime() &&
    ['active', 'expiring'].includes(c.state);
  const files = await Attachment.find({
    _id: { $in: [c.signedFileAttachmentId, ...certs.map((x) => x.attachmentId)].filter(Boolean) },
  })
    .select('originalName mimeType')
    .lean();
  return {
    ...c.toObject(),
    stateAr: SALES_CONTRACT_STATE_AR[c.state as keyof typeof SALES_CONTRACT_STATE_AR],
    ownerName: names.get(String(c.ownerUserId)) ?? '',
    customerName: customer.get(String(c.customerId))?.nameAr,
    customerNumber: customer.get(String(c.customerId))?.number,
    daysLeft: Math.ceil((c.endDate.getTime() - Date.now()) / DAY),
    yearOrMore: isYearOrMore(c),
    certificateWindowFrom,
    canCertify,
    canEdit:
      (String(c.ownerUserId) === String(req.auth.user._id) || isManagerScope(eff.scope)) &&
      !['expired', 'renewed', 'terminated'].includes(c.state),
    events: events.map((e) => ({
      ...e,
      byName: e.byUserId ? eventNames.get(String(e.byUserId)) : undefined,
    })),
    certificates: certs,
    files,
  };
}

/** Each delivery / pickup date is tracked [SAL §7.4 «متابعة تنفيذ كل موعد تسليم»]. */
export async function addScheduleEntry(
  req: AuthedRequest,
  id: string,
  input: { plannedAt: string; kind: string; note?: string },
) {
  const { c } = await loadFor(req, id, 'edit');
  await SalesContract.updateOne(
    { _id: c._id },
    {
      $push: {
        schedule: {
          plannedAt: new Date(input.plannedAt),
          kind: input.kind,
          note: input.note,
          status: 'planned',
        },
      },
    },
  );
  await ContractEvent.create({
    contractId: c._id,
    type: 'schedule_added',
    note: `${SCHEDULE_KIND_AR[input.kind as keyof typeof SCHEDULE_KIND_AR] ?? input.kind} ${input.plannedAt}`,
    byUserId: String(req.auth.user._id),
    byEmail: req.auth.user.email,
  });
  await recordAudit(actorFrom(req), {
    action: 'update',
    resource: 'sales.contracts',
    resourceId: id,
    meta: { scheduleAdded: input },
  });
  return getContract(req, id);
}
export async function setScheduleStatus(
  req: AuthedRequest,
  id: string,
  entryId: string,
  input: { status: string; note?: string; doneAt?: string },
) {
  const { c } = await loadFor(req, id, 'edit');
  const entry = (c.schedule as unknown as { _id: Types.ObjectId; status: string }[]).find(
    (s) => String(s._id) === entryId,
  );
  if (!entry) throw notFound();
  await SalesContract.updateOne(
    { _id: c._id, 'schedule._id': entryId },
    {
      $set: {
        'schedule.$.status': input.status,
        'schedule.$.note': input.note,
        'schedule.$.doneAt':
          input.status === 'done' ? (input.doneAt ? new Date(input.doneAt) : new Date()) : undefined,
        'schedule.$.byUserId': req.auth.user._id,
      },
    },
  );
  await ContractEvent.create({
    contractId: c._id,
    type: 'schedule_status',
    note: `${entry.status} → ${input.status}${input.note ? ` — ${input.note}` : ''}`,
    data: { entryId, status: input.status },
    byUserId: String(req.auth.user._id),
    byEmail: req.auth.user.email,
  });
  await recordAudit(actorFrom(req), {
    action: 'update',
    resource: 'sales.contracts',
    resourceId: id,
    meta: { scheduleEntry: entryId, status: input.status },
  });
  return getContract(req, id);
}

export async function terminateContract(req: AuthedRequest, id: string, reason: string) {
  const { c } = await loadFor(req, id, 'edit');
  if (!['active', 'expiring', 'draft'].includes(c.state)) throw conflict('العقد ليس ساريًا');
  await SalesContract.updateOne({ _id: c._id, state: c.state }, { $set: { state: 'terminated' } });
  await ContractEvent.create({
    contractId: c._id,
    type: 'terminated',
    note: reason,
    byUserId: String(req.auth.user._id),
    byEmail: req.auth.user.email,
  });
  await recordAudit(actorFrom(req), {
    action: 'update',
    resource: 'sales.contracts',
    resourceId: id,
    before: { state: c.state },
    after: { state: 'terminated' },
    meta: { reason },
  });
  return getContract(req, id);
}

/** شهادة تعاون [SAL §6.3]: for contracts of a year or more, from three months before the end; numbered, stored, logged. */
export async function issueCertificate(req: AuthedRequest, id: string) {
  const { c } = await loadFor(req, id, 'edit');
  const alertDays = await getSetting('sales.contractAlertDaysBefore');
  if (!isYearOrMore(c)) throw badRequest('شهادة التعاون للعقود التي مدتها سنة أو أكثر');
  if (Date.now() < c.endDate.getTime() - alertDays * DAY)
    throw badRequest(`تُتاح الشهادة قبل انتهاء العقد بـ ${alertDays} يومًا`);
  const [orgName, customer] = await Promise.all([
    getSetting('general.organizationNameAr'),
    customerLabels([c.customerId]),
  ]);
  const cust = customer.get(String(c.customerId));
  const now = new Date();
  const number = await nextNumber('certificate');
  const body = `<div style="text-align:center"><h2>${escapeHtml(orgName)}</h2><h3>شهادة تعاون</h3><p>رقم: ${escapeHtml(number)} · التاريخ: ${escapeHtml(riyadhDate(now))}</p></div>
<p>تشهد ${escapeHtml(orgName)} بأن السادة / <strong>${escapeHtml(cust?.nameAr ?? '')}</strong> تعاونوا معنا بموجب العقد رقم ${escapeHtml(c.number)} خلال الفترة من ${escapeHtml(riyadhDate(c.startDate))} إلى ${escapeHtml(riyadhDate(c.endDate))}${c.contractType ? ` (${escapeHtml(c.contractType)})` : ''}، وكان التعاون مثمرًا في مجال إعادة التدوير والاستدامة.</p>
<p>وقد أُعطيت لهم هذه الشهادة تقديرًا لتعاونهم، دون أدنى مسؤولية على الجمعية تجاه الغير.</p><p style="margin-top:48px">قسم المبيعات</p>`;
  const html = htmlDocument(body, number);
  const key = `certificates/${now.getUTCFullYear()}/${number}-${randomUUID().slice(0, 8)}.html`;
  await storage().putObject(key, Buffer.from(html, 'utf8'), 'text/html; charset=utf-8');
  const [att] = await Attachment.create([
    {
      key,
      originalName: `${number}.html`,
      mimeType: 'text/html',
      size: Buffer.byteLength(html),
      status: 'uploaded',
      uploadedAt: now,
      uploadedBy: req.auth.user._id,
      ownerType: 'sales_contract',
      ownerId: String(c._id),
      sensitive: false,
    },
  ]);
  const cert = await CooperationCertificate.create({
    number,
    contractId: c._id,
    customerId: c.customerId,
    issuedAt: now,
    issuedByUserId: req.auth.user._id,
    attachmentId: att._id,
  });
  await ContractEvent.create({
    contractId: c._id,
    type: 'certificate_issued',
    note: number,
    byUserId: String(req.auth.user._id),
    byEmail: req.auth.user.email,
  });
  await recordAudit(actorFrom(req), {
    action: 'create',
    resource: 'sales.certificates',
    resourceId: String(cert._id),
    after: { number, contractId: id },
  });
  return getContract(req, id);
}
export async function sendCertificate(
  req: AuthedRequest,
  id: string,
  certId: string,
  input: { to: string[]; note?: string },
) {
  const { c } = await loadFor(req, id, 'edit');
  const cert = await CooperationCertificate.findOne({ _id: certId, contractId: c._id });
  if (!cert) throw notFound();
  const customer = (await customerLabels([c.customerId])).get(String(c.customerId));
  const orgName = await getSetting('general.organizationNameAr');
  const msg = await composeAndSend(
    { recordType: 'sales_contract', recordId: id, customerId: c.customerId },
    {
      from: {
        userId: String(req.auth.user._id),
        email: req.auth.user.email,
        name: req.auth.user.displayNameAr,
        mailbox: 'user',
      },
      to: input.to,
      cc: [],
      subject: `شهادة تعاون ${cert.number} — ${orgName}`,
      bodyText: `السادة ${customer?.nameAr ?? ''}،\nنرفق لكم شهادة التعاون رقم ${cert.number}.${input.note ? `\n${input.note}` : ''}\nمع التحية،\n${req.auth.user.displayNameAr}`,
      attachmentIds: [String(cert.attachmentId)],
    },
  );
  await CooperationCertificate.updateOne(
    { _id: cert._id },
    {
      $push: {
        sendLog: {
          at: new Date(),
          to: input.to,
          byUserId: req.auth.user._id,
          emailMessageId: msg._id,
          note: input.note,
        },
      },
    },
  );
  await recordAudit(actorFrom(req), {
    action: 'send',
    resource: 'sales.certificates',
    resourceId: certId,
    meta: { to: input.to, via: msg.state },
  });
  return { ...(await getContract(req, id)), mailto: msg.mailto, emailState: msg.state };
}

/**
 * Daily job [SAL §6.3, §7.4]: contracts of a year or more → «اقتراب انتهاء عقد» to the Sales side and
 * «اقتراب موعد تجديد التعاون» to the owner once, `alertDays` before the end; any contract past its end → منتهي.
 */
export async function runContractAlerts(now = new Date()): Promise<{ expiring: number; expired: number }> {
  const alertDays = await getSetting('sales.contractAlertDaysBefore');
  let expiring = 0;
  const due = await SalesContract.find({
    deletedAt: null,
    state: 'active',
    endDate: { $lte: new Date(now.getTime() + alertDays * DAY), $gt: now },
    'alerts.expiringSentAt': null,
  });
  for (const c of due) {
    if (!isYearOrMore(c)) continue;
    const claimed = await SalesContract.updateOne(
      { _id: c._id, 'alerts.expiringSentAt': null },
      { $set: { state: 'expiring', 'alerts.expiringSentAt': now, 'alerts.renewalReminderSentAt': now } },
    );
    if (!claimed.modifiedCount) continue;
    const customer = (await customerLabels([c.customerId])).get(String(c.customerId));
    const daysLeft = Math.ceil((c.endDate.getTime() - now.getTime()) / DAY);
    await notify({
      userIds: [...new Set([String(c.ownerUserId), ...(await salesManagerUserIds(String(c.departmentId)))])],
      type: 'sales.contract.expiring',
      bodyAr: `${c.number} — ${customer?.nameAr ?? ''}: ينتهي خلال ${daysLeft} يومًا`,
      link: `/sales/contracts/${c._id}`,
      data: { contractId: String(c._id) },
    });
    await notify({
      userIds: [String(c.ownerUserId)],
      type: 'sales.contract.renewal_due',
      bodyAr: `${c.number} — ${customer?.nameAr ?? ''}: تابع التجديد وأصدر شهادة التعاون`,
      link: `/sales/contracts/${c._id}`,
      data: { contractId: String(c._id) },
    });
    await ContractEvent.create({ contractId: c._id, type: 'expiring_alert', note: `${daysLeft}d` });
    expiring++;
  }
  const ended = await SalesContract.updateMany(
    { deletedAt: null, state: { $in: ['active', 'expiring'] }, endDate: { $lt: now } },
    { $set: { state: 'expired' } },
  );
  return { expiring, expired: ended.modifiedCount };
}
