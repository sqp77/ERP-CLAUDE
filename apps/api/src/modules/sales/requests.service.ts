import { Types, type FilterQuery, type HydratedDocument } from 'mongoose';
import {
  CLOSING_TRANSITIONS,
  DETAILS_SCHEMAS,
  FINAL_STATES,
  REQUEST_HOLDER_AR,
  SALES_REQUEST_STATE_AR,
  SALES_SERVICE_TYPE_AR,
  STATE_HOLDER,
  arabicSearchRegex,
  assetReturnPayloadSchema,
  financePayloadSchema,
  operationsPayloadSchema,
  procurementPayloadSchema,
  scrapPayloadSchema,
  type CreateSalesRequestInput,
  type RequestHolder,
  type RentalInspectionInput,
  type SalesRequestTransitionInput,
  type SalesServiceType,
  type ScrapAssessmentInput,
  type ScrapTaskInput,
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
import { canonicalTags } from '../../core/tags/service';
import {
  applyTransition,
  availableTransitions,
  getWorkflow,
  initWorkflow,
  stageHistory,
} from '../../core/workflow/engine';
import { StageDelayReason, StageLog } from '../../core/workflow/model';
import { CalendarEvent } from '../../core/calendar/model';
import { createTask } from '../../core/tasks/service';
import { Task } from '../../core/tasks/model';
import { departmentManagerUserIds } from '../../core/tasks/jobs';
import { Department } from '../../core/org/model';
import { User, type UserDoc } from '../../core/auth/model';
import { withTransaction } from '../../db';
import {
  assertSalesTarget,
  canAccessCustomer,
  customerLabels,
  departmentIdByCode,
  permissionOn,
  salesDepartmentId,
  salesManagerUserIds,
  userNames,
  TAG_SCOPE,
} from '../crm/service';
import {
  RentalInspection,
  SalesRequest,
  SalesRequestAction,
  ScrapAssessment,
  ScrapTask,
  type SalesRequestDoc,
} from './requests.model';
import { workflowTypeFor } from './workflows';
import { Opportunity } from './model';
import { canAccessOpportunity } from './service';

const isManagerScope = (scope: string) => scope === 'department' || scope === 'all';
const HOLDER_CODE: Record<RequestHolder, string> = {
  sales: 'sales',
  procurement: 'procurement',
  finance: 'finance',
  ops: 'ops',
};

// ------------------------------------------------------------------------------------------------
// Who is who: relations for the engine, visibility for the queues
// ------------------------------------------------------------------------------------------------
async function departmentCodeOf(user: UserDoc): Promise<string | undefined> {
  if (!user.departmentId) return undefined;
  return (await Department.findById(user.departmentId).select('code').lean())?.code;
}
/** Department roles of a user: `<holder>_staff` / `<holder>_manager` for Procurement, Finance and Operations (Q12: both act). */
async function departmentRelations(req: AuthedRequest): Promise<string[]> {
  const rel: string[] = [];
  const code = await departmentCodeOf(req.auth.user);
  const codes = req.auth.roleCodes;
  const isDeptManager = codes.includes('department_manager');
  if (code === 'procurement')
    rel.push('procurement_staff', ...(isDeptManager ? ['procurement_manager'] : []));
  if (code === 'ops') rel.push('ops_staff', ...(isDeptManager ? ['ops_manager'] : []));
  if (code === 'finance' || codes.includes('finance_staff') || codes.includes('finance_manager'))
    rel.push('finance_staff');
  if (codes.includes('finance_manager')) rel.push('finance_manager');
  const transferRoles = await getSetting('sales.scrapTransferRoles');
  if (codes.some((c) => transferRoles.includes(c))) rel.push('scrap_transfer');
  return rel;
}
export async function relationsFor(req: AuthedRequest, r: SalesRequestDoc): Promise<string[]> {
  const rel = new Set<string>(await departmentRelations(req));
  if (String(r.ownerUserId) === String(req.auth.user._id)) rel.add('owner');
  const eff = await permissionOn(req, 'sales.requests', 'edit');
  if (
    eff &&
    isManagerScope(eff.scope) &&
    (eff.scope === 'all' || eff.departmentIds.includes(String(r.departmentId)))
  )
    rel.add('sales_manager');
  for (const c of req.auth.roleCodes) rel.add(c);
  return [...rel];
}

/** Departments whose queue «الطلبات الواردة من المبيعات» the caller may see (members of Procurement / Finance / Operations). */
export async function incomingHoldersFor(req: AuthedRequest): Promise<RequestHolder[]> {
  const rel = await departmentRelations(req);
  const out = new Set<RequestHolder>();
  if (rel.includes('procurement_staff')) out.add('procurement');
  if (rel.includes('finance_staff')) out.add('finance');
  if (rel.includes('ops_staff')) out.add('ops');
  return [...out];
}

/** Sales scope (own / department / all) OR a receiving department's queue (current or past holder). */
export async function visibilityFilter(req: AuthedRequest): Promise<FilterQuery<unknown> | null> {
  const or: Record<string, unknown>[] = [];
  const eff = await permissionOn(req, 'sales.requests', 'view');
  if (eff) {
    if (eff.scope === 'all') return {};
    if (eff.scope === 'department')
      or.push({ departmentId: { $in: eff.departmentIds.map((d) => new Types.ObjectId(d)) } });
    or.push({ ownerUserId: req.auth.user._id });
  }
  const holders = await incomingHoldersFor(req);
  if (holders.length) or.push({ holdersInvolved: { $in: holders } });
  // Scrap is visible to Sales and Operations at every state [SAL §5.6 «ظهور جميع طلبات السكراب لدى المبيعات والمشاريع»].
  if (holders.includes('ops')) or.push({ type: 'scrap' });
  return or.length ? { $or: or } : null;
}
export async function canAccessRequest(req: AuthedRequest, id: string): Promise<boolean> {
  const f = await visibilityFilter(req);
  return !!f && !!(await SalesRequest.exists({ _id: id, deletedAt: null, ...f }));
}
type RequestDoc = HydratedDocument<SalesRequestDoc>;
async function loadFor(req: AuthedRequest, id: string): Promise<RequestDoc> {
  const f = await visibilityFilter(req);
  if (!f) throw forbidden();
  const r = await SalesRequest.findOne({ _id: id, deletedAt: null, ...f });
  if (!r) throw notFound();
  return r;
}

// ------------------------------------------------------------------------------------------------
// Create / update (Sales)
// ------------------------------------------------------------------------------------------------
function parseDetails(type: SalesServiceType, details: unknown) {
  const parsed = DETAILS_SCHEMAS[type].safeParse(details ?? {});
  if (!parsed.success)
    throw badRequest(
      'بيانات الخدمة غير مكتملة',
      parsed.error.issues.map((i) => ({ path: `details.${i.path.join('.')}`, message: i.message })),
    );
  return parsed.data as Record<string, unknown>;
}
const defaultTitle = (type: SalesServiceType, customer: string) =>
  `${SALES_SERVICE_TYPE_AR[type]} — ${customer}`;

export async function createRequest(req: AuthedRequest, input: CreateSalesRequestInput) {
  if (!(await canAccessCustomer(req, input.customerId))) throw notFound('العميل غير موجود');
  const authz = req.authz!;
  let owner: UserDoc = req.auth.user;
  if (input.ownerUserId && input.ownerUserId !== String(req.auth.user._id)) {
    if (!isManagerScope(authz.scope)) throw forbidden('تعيين الموظف المسؤول من صلاحيات مدير القسم');
    owner = await assertSalesTarget(authz, input.ownerUserId);
  }
  const details = parseDetails(input.type, input.details);
  const tags = await canonicalTags(TAG_SCOPE, input.tags);
  const def = await getWorkflow(workflowTypeFor(input.type));
  const wf = await initWorkflow(def);
  const customer = (await customerLabels([input.customerId])).get(input.customerId);
  const actor = actorFrom(req);
  const doc = await withTransaction(async (session) => {
    const [r] = await SalesRequest.create(
      [
        {
          number: await nextNumber(input.type, session),
          type: input.type,
          workflowType: def.type,
          customerId: input.customerId,
          opportunityId: input.opportunityId,
          title: input.title ?? defaultTitle(input.type, customer?.nameAr ?? ''),
          details,
          ownerUserId: owner._id,
          departmentId: owner.departmentId ?? (await salesDepartmentId()),
          createdByUserId: req.auth.user._id,
          attachmentIds: input.attachmentIds,
          photoIds: input.photoIds,
          tags,
          ...wf,
          holder: STATE_HOLDER[wf.state] ?? 'sales',
          holdersInvolved: ['sales'],
          needsProcurement: input.needsProcurement ?? input.type === 'containerSale',
          needsFinanceApproval: input.needsFinanceApproval ?? false,
          needsOperations: input.needsOperations ?? input.type !== 'assetReturn',
          assetReturn:
            input.type === 'assetReturn' && details.nextConversationAt
              ? { nextConversationAt: new Date(details.nextConversationAt as string) }
              : undefined,
          lastActivityAt: new Date(),
        },
      ],
      { session, ordered: true },
    );
    const files = [...input.attachmentIds, ...input.photoIds];
    if (files.length)
      await claimAttachments(files, 'sales_request', String(r._id), req.auth.user._id, session);
    await SalesRequestAction.create(
      [
        {
          requestId: r._id,
          action: 'created',
          toState: r.state,
          holderTo: r.holder,
          actorUserId: actor.userId,
          actorEmail: actor.email,
          actorRelations: ['owner'],
        },
      ],
      { session, ordered: true },
    );
    await recordAudit(
      actor,
      {
        action: 'create',
        resource: 'sales.requests',
        resourceId: String(r._id),
        after: { number: r.number, type: r.type, customerId: input.customerId },
      },
      session,
    );
    await publish(
      {
        type: 'sales.request.created',
        aggregateType: 'sales_request',
        aggregateId: String(r._id),
        payload: { number: r.number, type: r.type },
        actorUserId: actor.userId,
      },
      session,
    );
    return r;
  });
  if (String(owner._id) !== String(req.auth.user._id))
    await notify({
      userIds: [String(owner._id)],
      type: 'crm.customer.assigned',
      bodyAr: `${doc.number} — ${doc.title}`,
      link: `/sales/requests/${doc._id}`,
      data: { requestId: String(doc._id) },
    });
  return doc;
}

export const EDIT_LOCKED =
  'لا يمكن تعديل الطلب إلا وهو لدى المبيعات وقبل اعتماده ماليًا — استخدم «إعادة إلى المبيعات للتعديل»';

/**
 * Edits to the service data and the route flags (S2 approval fix 1): only while Sales holds the record and before
 * Finance approved it; afterwards the owner fires «إعادة إلى المبيعات للتعديل», which clears the decision. The write is
 * conditional on the loaded state (409 on a race with a transition).
 */
export async function updateRequest(req: AuthedRequest, id: string, input: Record<string, unknown>) {
  const r = await loadFor(req, id);
  const rel = await relationsFor(req, r);
  if (!rel.includes('owner') && !rel.includes('sales_manager'))
    throw forbidden('تعديل بيانات الطلب من صلاحيات المبيعات');
  if ((FINAL_STATES as readonly string[]).includes(r.state)) throw conflict('الطلب مغلق');
  const structural = ['details', 'needsProcurement', 'needsFinanceApproval', 'needsOperations'].some(
    (k) => input[k] !== undefined,
  );
  if (structural && (r.holder !== 'sales' || r.finance?.decision === 'approved'))
    throw conflict(EDIT_LOCKED, { code: 'edit_locked' });
  const set: Record<string, unknown> = { lastActivityAt: new Date() };
  if (input.details !== undefined)
    set.details = parseDetails(r.type as SalesServiceType, {
      ...(r.details as Record<string, unknown>),
      ...(input.details as Record<string, unknown>),
    });
  if (input.title !== undefined) set.title = input.title;
  if (input.tags !== undefined) set.tags = await canonicalTags(TAG_SCOPE, input.tags as string[]);
  for (const k of [
    'needsProcurement',
    'needsFinanceApproval',
    'needsOperations',
    'attachmentIds',
    'photoIds',
  ])
    if (input[k] !== undefined) set[k] = input[k];
  if (input.opportunityId !== undefined) {
    // S2 approval fix 4: only an opportunity the caller may see, and of the same customer.
    if (input.opportunityId !== null) {
      const oid = String(input.opportunityId);
      if (!(await canAccessOpportunity(req, oid)))
        throw badRequest('الفرصة البيعية غير موجودة', [{ path: 'opportunityId', message: 'غير موجودة' }]);
      const opp = await Opportunity.findById(oid).select('customerId').lean();
      if (!opp || String(opp.customerId) !== String(r.customerId))
        throw badRequest('الفرصة البيعية لعميل آخر', [
          { path: 'opportunityId', message: 'يجب أن تكون للعميل نفسه' },
        ]);
    }
    set.opportunityId = input.opportunityId;
  }
  if (r.type === 'assetReturn' && (set.details as Record<string, unknown> | undefined)?.nextConversationAt)
    set['assetReturn.nextConversationAt'] = new Date(
      (set.details as Record<string, string>).nextConversationAt,
    );
  const actor = actorFrom(req);
  await withTransaction(async (session) => {
    const files = [...((input.attachmentIds as string[]) ?? []), ...((input.photoIds as string[]) ?? [])];
    if (files.length) await claimAttachments(files, 'sales_request', id, req.auth.user._id, session);
    const written = await SalesRequest.updateOne(
      { _id: id, state: r.state, deletedAt: null },
      { $set: set },
      { session },
    );
    if (!written.matchedCount) throw conflict('تغيّرت حالة الطلب أثناء التعديل، حدّث الصفحة وأعد المحاولة');
    await SalesRequestAction.create(
      [
        {
          requestId: r._id,
          action: 'updated',
          actorUserId: actor.userId,
          actorEmail: actor.email,
          actorRelations: rel,
          note: Object.keys(input).join(', '),
        },
      ],
      { session, ordered: true },
    );
    await recordAudit(
      actor,
      {
        action: 'update',
        resource: 'sales.requests',
        resourceId: id,
        before: { details: r.details, title: r.title },
        after: set,
      },
      session,
    );
  });
  return getRequest(req, id);
}

// ------------------------------------------------------------------------------------------------
// Read
// ------------------------------------------------------------------------------------------------
export interface ListQuery {
  page: number;
  limit: number;
  type?: string;
  state?: string;
  holder?: string;
  open?: boolean;
  overdue?: boolean;
  customerId?: string;
  ownerUserId?: string;
  tag?: string;
  q?: string;
  view?: 'mine' | 'department' | 'incoming';
  includeHistory?: boolean;
}
export async function listRequests(req: AuthedRequest, q: ListQuery) {
  const base = await visibilityFilter(req);
  if (!base) throw forbidden();
  const filter: FilterQuery<unknown> = { deletedAt: null, ...base };
  if (q.view === 'mine') filter.ownerUserId = req.auth.user._id;
  if (q.view === 'incoming') {
    const holders = await incomingHoldersFor(req);
    if (!holders.length) throw forbidden('لا تنتمي إلى قسم يستلم طلبات المبيعات');
    const mine = q.holder && holders.includes(q.holder as RequestHolder) ? [q.holder] : holders;
    Object.assign(filter, q.includeHistory ? { holdersInvolved: { $in: mine } } : { holder: { $in: mine } });
  } else if (q.holder) filter.holder = q.holder;
  if (q.type) filter.type = q.type;
  if (q.state) filter.state = q.state;
  if (q.open) filter.state = { $nin: [...FINAL_STATES] };
  if (q.overdue) {
    filter.dueAt = { $lt: new Date() };
    filter.state = { $nin: [...FINAL_STATES] };
  }
  if (q.customerId) filter.customerId = q.customerId;
  if (q.ownerUserId) filter.ownerUserId = q.ownerUserId;
  if (q.tag) filter.tags = q.tag;
  if (q.q) filter.$and = [{ $or: [{ title: arabicSearchRegex(q.q) }, { number: q.q.toUpperCase() }] }];
  const [rows, total] = await Promise.all([
    SalesRequest.find(filter)
      .sort({ lastActivityAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    SalesRequest.countDocuments(filter),
  ]);
  const [names, customers] = await Promise.all([
    userNames(rows.map((r) => r.ownerUserId)),
    customerLabels(rows.map((r) => r.customerId)),
  ]);
  return {
    items: rows.map((r) => ({
      ...r,
      stateAr: SALES_REQUEST_STATE_AR[r.state] ?? r.state,
      ownerName: names.get(String(r.ownerUserId)) ?? '',
      customerName: customers.get(String(r.customerId))?.nameAr ?? '',
      customerNumber: customers.get(String(r.customerId))?.number ?? '',
      overdue: !!r.dueAt && r.dueAt < new Date() && !(FINAL_STATES as readonly string[]).includes(r.state),
    })),
    total,
    page: q.page,
    limit: q.limit,
  };
}

export async function getRequest(req: AuthedRequest, id: string) {
  const r = await loadFor(req, id);
  const def = await getWorkflow(r.workflowType);
  const rel = await relationsFor(req, r);
  const [actions, stages, delayRows, inspections, assessments, scrapTasks, customer, names] =
    await Promise.all([
      SalesRequestAction.find({ requestId: r._id }).sort({ at: 1 }).lean(),
      stageHistory('sales_request', String(r._id)),
      StageDelayReason.find({ recordType: 'sales_request', recordId: String(r._id) })
        .sort({ at: 1 })
        .lean(),
      r.type === 'containerRental' ? RentalInspection.find({ requestId: r._id }).sort({ at: 1 }).lean() : [],
      r.type === 'scrap' ? ScrapAssessment.find({ requestId: r._id }).sort({ at: 1 }).lean() : [],
      r.type === 'scrap' ? ScrapTask.find({ requestId: r._id }).sort({ createdAt: 1 }).lean() : [],
      customerLabels([r.customerId]),
      userNames([r.ownerUserId, r.createdByUserId]),
    ]);
  const taskDocs = scrapTasks.length
    ? await Task.find({ _id: { $in: scrapTasks.map((t) => t.taskId) } })
        .select('number status title')
        .lean()
    : [];
  const taskById = new Map(taskDocs.map((t) => [String(t._id), t]));
  const fileIds = [
    ...r.attachmentIds,
    ...r.photoIds,
    ...(r.procurement?.supplierQuoteAttachmentIds ?? []),
    ...(r.finance?.purchaseDocumentAttachmentIds ?? []),
    ...(r.operations?.receiptReportAttachmentIds ?? []),
    ...(r.operations?.deliveryReportAttachmentIds ?? []),
    ...(r.scrap?.receiptReportAttachmentIds ?? []),
  ];
  const files = await Attachment.find({ _id: { $in: fileIds } })
    .select('originalName mimeType')
    .lean();
  const assigneeNames = await userNames([
    ...scrapTasks.map((t) => t.assigneeUserId),
    ...actions.map((a) => a.actorUserId),
  ]);
  const available = availableTransitions(def, r.state, rel).map((t) => ({
    code: t.code,
    labelAr: t.labelAr,
    to: t.to,
    requireReason: t.requireReason,
    requiredFields: t.requiredFields,
  }));
  return {
    ...r.toObject(),
    stateAr: SALES_REQUEST_STATE_AR[r.state] ?? r.state,
    typeAr: SALES_SERVICE_TYPE_AR[r.type as SalesServiceType],
    ownerName: names.get(String(r.ownerUserId)) ?? '',
    createdByName: r.createdByUserId ? names.get(String(r.createdByUserId)) : undefined,
    customerName: customer.get(String(r.customerId))?.nameAr,
    customerNumber: customer.get(String(r.customerId))?.number,
    relations: rel,
    actions: available,
    canEdit:
      (rel.includes('owner') || rel.includes('sales_manager')) &&
      !(FINAL_STATES as readonly string[]).includes(r.state),
    history: actions.map((a) => ({
      ...a,
      actorName: a.actorUserId ? assigneeNames.get(String(a.actorUserId)) : undefined,
    })),
    stageLog: stages.map((st) => {
      const mine = delayRows.filter((d) => String(d.stageLogId) === String(st._id));
      const latest = mine.at(-1);
      return {
        ...st,
        delayReason: latest?.reason,
        responsibleDepartment: latest?.responsibleCode,
        delayReasons: mine.map((d) => ({
          _id: d._id,
          reason: d.reason,
          responsibleDepartment: d.responsibleCode,
          byEmail: d.byEmail,
          at: d.at,
        })),
      };
    }),
    inspections,
    assessments,
    scrapTasks: scrapTasks.map((t) => ({
      ...t,
      assigneeName: assigneeNames.get(String(t.assigneeUserId)),
      task: taskById.get(String(t.taskId)) ?? null,
      taskStatus: taskById.get(String(t.taskId))?.status === 'done' ? 'done' : 'not_done',
    })),
    files,
    overdue: !!r.dueAt && r.dueAt < new Date() && !(FINAL_STATES as readonly string[]).includes(r.state),
    states: def.states,
  };
}

// ------------------------------------------------------------------------------------------------
// Transitions: one path for every department, same record and number [SAL §6.1, §19]
// ------------------------------------------------------------------------------------------------
async function departmentMemberIds(holder: RequestHolder): Promise<string[]> {
  const deptId = await departmentIdByCode(HOLDER_CODE[holder]);
  if (!deptId) return [];
  const members = await User.find({ departmentId: deptId, status: 'active', deletedAt: null })
    .select('_id')
    .lean();
  const extra =
    holder === 'finance'
      ? await User.find({
          status: 'active',
          deletedAt: null,
          'roles.role': { $in: ['finance_staff', 'finance_manager'] },
        })
          .select('_id')
          .lean()
      : [];
  return [
    ...new Set([
      ...(await departmentManagerUserIds(deptId)),
      ...members.map((u) => String(u._id)),
      ...extra.map((u) => String(u._id)),
    ]),
  ];
}
async function salesSide(r: SalesRequestDoc): Promise<string[]> {
  return [...new Set([String(r.ownerUserId), ...(await salesManagerUserIds(String(r.departmentId)))])];
}

function validatePayload(code: string, payload: Record<string, unknown>) {
  const pick = (schema: {
    safeParse: (v: unknown) => {
      success: boolean;
      data?: unknown;
      error?: { issues: { path: PropertyKey[]; message: string }[] };
    };
  }) => {
    const p = schema.safeParse(payload);
    if (!p.success)
      throw badRequest(
        'بيانات المرحلة غير صالحة',
        p.error!.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    return p.data as Record<string, unknown>;
  };
  if (code.startsWith('execution_') || code === 'procurement_to_finance')
    return pick(procurementPayloadSchema);
  if (code.startsWith('finance_')) return pick(financePayloadSchema);
  if (code.startsWith('ops_') || code === 'estimate_done') return pick(operationsPayloadSchema);
  if (
    ['record_assessment', 'agree_price', 'schedule_pickup', 'record_collection', 'record_transfer'].includes(
      code,
    )
  )
    return pick({
      safeParse: (v: unknown) => scrapPayloadSchema.merge(operationsPayloadSchema).safeParse(v),
    });
  if (['negotiate', 'back_to_study', 'cooperate', 'decline'].includes(code))
    return pick(assetReturnPayloadSchema);
  return payload;
}

export async function transitionRequest(req: AuthedRequest, id: string, input: SalesRequestTransitionInput) {
  const r = await loadFor(req, id);
  const def = await getWorkflow(r.workflowType);
  const rel = await relationsFor(req, r);
  const code = input.transition;
  const defs = def.transitions.filter((t) => t.code === code);
  if (!defs.length) throw badRequest('إجراء غير معروف');
  // Who before when (review E8).
  if (!defs.some((t) => t.allow.includes('*') || t.allow.some((a) => rel.includes(a))))
    throw forbidden(`ليست لديك صلاحية تنفيذ "${defs[0].labelAr}"`);
  // Segregation: the Finance decision is never taken by the request's owner or creator (FIN §12, DECISIONS §20 Q3).
  if (
    code.startsWith('finance_') &&
    code !== 'finance_resubmit' &&
    (rel.includes('owner') || String(r.createdByUserId ?? '') === String(req.auth.user._id))
  )
    throw forbidden('لا يجوز لمقدم الطلب اعتماده أو رفضه');
  const payload = validatePayload(code, input.payload);
  const now = new Date();
  const actor = actorFrom(req);
  const set: Record<string, unknown> = { lastActivityAt: now };
  const push: Record<string, unknown> = {};
  const fromState = r.state;
  // Stage data per department, kept on the same record.
  if (code === 'send_to_procurement' || code === 'resubmit_after_execution_reject')
    set.needsProcurement = true;
  if (code === 'procurement_to_finance' || code.startsWith('execution_')) {
    for (const k of ['supplierPartyId', 'supplierName', 'receiptFormAttachmentId', 'notes'] as const)
      if (payload[k] !== undefined) set[`procurement.${k}`] = payload[k];
    if (payload.deliveryDate) set['procurement.deliveryDate'] = new Date(payload.deliveryDate as string);
    if (Array.isArray(payload.supplierQuoteAttachmentIds) && payload.supplierQuoteAttachmentIds.length)
      push['procurement.supplierQuoteAttachmentIds'] = { $each: payload.supplierQuoteAttachmentIds };
  }
  if (code === 'finance_approve' || code === 'finance_reject' || code === 'finance_request_info') {
    set['finance.decision'] =
      code === 'finance_approve' ? 'approved' : code === 'finance_reject' ? 'rejected' : 'needs_info';
    set['finance.decidedByUserId'] = req.auth.user._id;
    set['finance.decidedAt'] = now;
    if (payload.notes) set['finance.notes'] = payload.notes;
    if (code === 'finance_reject') set['finance.rejectionReason'] = input.reason;
    if (code === 'finance_request_info') set['finance.infoRequest'] = input.reason;
    if (Array.isArray(payload.purchaseDocumentAttachmentIds) && payload.purchaseDocumentAttachmentIds.length)
      push['finance.purchaseDocumentAttachmentIds'] = { $each: payload.purchaseDocumentAttachmentIds };
  }
  let scheduledEvent: { startAt: Date; durationMin: number } | null = null;
  if (code === 'ops_schedule' || code === 'schedule_pickup') {
    if (!payload.scheduledVisitAt)
      throw badRequest('حدّد موعد الزيارة', [{ path: 'scheduledVisitAt', message: 'مطلوب' }]);
    set['operations.scheduledVisitAt'] = new Date(payload.scheduledVisitAt as string);
    scheduledEvent = {
      startAt: new Date(payload.scheduledVisitAt as string),
      durationMin: (payload.visitDurationMinutes as number) ?? 60,
    };
  }
  if (code.startsWith('ops_') || code === 'estimate_done' || code === 'record_collection') {
    for (const k of ['estimatedWeightKg', 'estimatedQuantity', 'quantitiesKg', 'weightsKg', 'notes'] as const)
      if (payload[k] !== undefined) set[`operations.${k}`] = payload[k];
    if (payload.postponedTo) set['operations.postponedTo'] = new Date(payload.postponedTo as string);
    for (const k of ['receiptReportAttachmentIds', 'deliveryReportAttachmentIds'] as const)
      if (Array.isArray(payload[k]) && (payload[k] as string[]).length)
        push[`operations.${k}`] = { $each: payload[k] };
    if (code === 'ops_complete') set['operations.completedAt'] = now;
  }
  if (
    code === 'record_assessment' ||
    code === 'agree_price' ||
    code === 'record_collection' ||
    code === 'record_transfer'
  ) {
    for (const k of ['proposedPriceHalalas', 'agreedPriceHalalas', 'actualWeightKg'] as const)
      if (payload[k] !== undefined) set[`scrap.${k}`] = payload[k];
    if (
      Array.isArray(payload.receiptReportAttachmentIds) &&
      (payload.receiptReportAttachmentIds as string[]).length
    )
      push['scrap.receiptReportAttachmentIds'] = { $each: payload.receiptReportAttachmentIds };
    if (code === 'agree_price') set['details.agreedPriceHalalas'] = payload.agreedPriceHalalas;
    if (code === 'record_transfer') {
      if (!payload.transferProofAttachmentId)
        throw badRequest('إثبات التحويل مطلوب', [{ path: 'transferProofAttachmentId', message: 'مطلوب' }]);
      Object.assign(set, {
        'scrap.transferStatus': 'transferred',
        'scrap.transferProofAttachmentId': payload.transferProofAttachmentId,
        'scrap.transferredHalalas': payload.transferredHalalas ?? r.scrap?.agreedPriceHalalas,
        'scrap.transferredAt': now,
        'scrap.transferredByUserId': req.auth.user._id,
      });
    }
  }
  if (r.type === 'assetReturn') {
    if (payload.nextConversationAt) {
      set['assetReturn.nextConversationAt'] = new Date(payload.nextConversationAt as string);
      set['details.nextConversationAt'] = payload.nextConversationAt;
      set['assetReturn.reminderSentFor'] = null;
    }
    set['details.lastContactAt'] = now.toISOString();
    if (code === 'decline') set['assetReturn.nonCooperationReason'] = input.reason;
  }
  const unsetFinance = code === 'return_to_sales';
  if (code in CLOSING_TRANSITIONS) {
    set.closingOutcome = CLOSING_TRANSITIONS[code];
    set.closingNote = input.reason ?? input.note;
  }
  // requiredFields are checked by the engine against record + payload; an empty attachment list counts as missing.
  const engineRecord = {
    ...(r.toObject() as Record<string, unknown>),
    ...payload,
    receiptReportAttachmentIds: (payload.receiptReportAttachmentIds as unknown[] | undefined)?.length
      ? payload.receiptReportAttachmentIds
      : undefined,
  } as never;
  const ATTACHMENT_LISTS = [
    'supplierQuoteAttachmentIds',
    'receiptReportAttachmentIds',
    'deliveryReportAttachmentIds',
    'purchaseDocumentAttachmentIds',
  ] as const;
  const files = [
    ...input.attachmentIds,
    ...ATTACHMENT_LISTS.flatMap((k) => (Array.isArray(payload[k]) ? (payload[k] as string[]) : [])),
  ];
  let toState = fromState;
  let holderTo: RequestHolder = r.holder as RequestHolder;
  const updated = await withTransaction(async (session) => {
    if (files.length) await claimAttachments(files, 'sales_request', id, req.auth.user._id, session);
    for (const k of ['transferProofAttachmentId', 'receiptFormAttachmentId'] as const)
      if (typeof payload[k] === 'string')
        await claimAttachments([payload[k] as string], 'sales_request', id, req.auth.user._id, session);
    if (input.attachmentIds.length) push.attachmentIds = { $each: input.attachmentIds };
    let doc: RequestDoc | null = null;
    const result = await applyTransition({
      def,
      record: engineRecord,
      recordType: 'sales_request',
      transition: code,
      actor,
      actorRelations: rel,
      payload,
      reason: input.reason,
      departmentId: await departmentIdByCode(HOLDER_CODE[r.holder as RequestHolder]).then(
        (d) => d ?? undefined,
      ),
      now,
      session,
      persist: async (fields) => {
        holderTo = STATE_HOLDER[fields.state] ?? 'sales';
        const $set = { ...fields, ...set, holder: holderTo, overdueNotifiedFor: null };
        const update: Record<string, unknown> = { $set, $addToSet: { holdersInvolved: holderTo } };
        if (Object.keys(push).length) update.$push = push;
        // Back to Sales for a change: the Finance decision no longer stands (S2 approval fix 1).
        if (unsetFinance)
          update.$unset = { 'finance.decision': 1, 'finance.decidedAt': 1, 'finance.decidedByUserId': 1 };
        doc = await SalesRequest.findOneAndUpdate({ _id: r._id, state: fromState, deletedAt: null }, update, {
          new: true,
          session,
        });
        return !!doc;
      },
    });
    toState = result.to;
    const d = doc!;
    if (scheduledEvent) {
      // Operations schedules the visit on the shared calendar [OPS §3, SAL §9]; the Sales owner is a participant.
      const [ev] = await CalendarEvent.create(
        [
          {
            number: await nextNumber('event', session),
            title: `${code === 'schedule_pickup' ? 'سحب سكراب' : 'زيارة'} — ${d.number}`,
            type: 'visit',
            startAt: scheduledEvent.startAt,
            endAt: new Date(scheduledEvent.startAt.getTime() + scheduledEvent.durationMin * 60_000),
            ownerId: req.auth.user._id,
            participantIds: [d.ownerUserId],
            departmentIds: [req.auth.user.departmentId, d.departmentId].filter(Boolean),
            link: { type: 'sales_request', id: String(d._id), label: d.number },
          },
        ],
        { session, ordered: true },
      );
      await SalesRequest.updateOne(
        { _id: d._id },
        { $push: { 'operations.scheduledVisitEventIds': ev._id } },
        { session },
      );
    }
    await SalesRequestAction.create(
      [
        {
          requestId: d._id,
          action: code,
          fromState,
          toState,
          holderFrom: r.holder,
          holderTo,
          actorUserId: actor.userId,
          actorEmail: actor.email,
          actorRelations: rel,
          note: input.reason ?? input.note,
          data: payload,
        },
      ],
      { session, ordered: true },
    );
    await recordAudit(
      actor,
      {
        action: 'transition',
        resource: 'sales.requests',
        resourceId: id,
        before: { state: fromState, holder: r.holder },
        after: { state: toState, holder: holderTo },
        meta: { transition: code },
      },
      session,
    );
    const events = handoffEvents(r.holder as RequestHolder, holderTo, code, toState);
    for (const type of events)
      await publish(
        {
          type,
          aggregateType: 'sales_request',
          aggregateId: id,
          payload: { number: d.number, type: d.type, from: fromState, to: toState, transition: code },
          actorUserId: actor.userId,
        },
        session,
      );
    return d;
  });
  await notifyAfterTransition(updated, r.holder as RequestHolder, holderTo, code, toState, input.reason, req);
  return getRequest(req, id);
}

/** Outbox events at every hand-off (plan §4), so PRC / FIN / OPS modules can subscribe later. */
function handoffEvents(from: RequestHolder, to: RequestHolder, code: string, toState: string): string[] {
  const out: string[] = [];
  if (to === 'procurement' && from !== 'procurement') out.push('sales.request.sent_to_procurement');
  if (to === 'finance' && from !== 'finance') out.push('sales.request.sent_to_finance');
  if (from === 'finance' && code.startsWith('finance_') && code !== 'finance_resubmit')
    out.push('sales.request.finance_decided');
  if (from === 'procurement' && code.startsWith('execution_')) out.push('sales.request.procurement_updated');
  if (to === 'ops' && from !== 'ops') out.push('sales.request.sent_to_operations');
  if (code === 'ops_complete' || code === 'estimate_done' || code === 'record_collection')
    out.push('sales.request.operations_completed');
  if (toState === 'closed_success') out.push('sales.request.closed_success');
  if (['closed_incomplete', 'suspended', 'cancelled'].includes(toState)) out.push('sales.request.closed');
  if (code === 'record_transfer') out.push('sales.scrap.transferred');
  return out;
}

/** Notifications 7–10 [SAL §14], hand-off visibility [SAL §3 ملاحظة, §19] and the OPS §2.2 Finance notice for scrap. */
async function notifyAfterTransition(
  r: SalesRequestDoc & { _id: unknown },
  from: RequestHolder,
  to: RequestHolder,
  code: string,
  toState: string,
  reason: string | undefined,
  req: AuthedRequest,
) {
  const link = `/sales/requests/${r._id}`;
  const label = `${r.number} — ${r.title}`;
  const sales = await salesSide(r);
  const me = String(req.auth.user._id);
  const notSelf = (ids: string[]) => ids.filter((u) => u !== me);
  if (to !== from) {
    if (to === 'procurement')
      await notify({
        userIds: notSelf(await departmentMemberIds('procurement')),
        type: 'sales.request.to_procurement',
        bodyAr: label,
        link,
        data: { requestId: String(r._id) },
      });
    if (to === 'finance')
      await notify({
        userIds: notSelf(await departmentMemberIds('finance')),
        type: 'sales.request.to_finance',
        bodyAr: label,
        link,
        data: { requestId: String(r._id) },
      });
    if (to === 'ops')
      await notify({
        userIds: notSelf(await departmentMemberIds('ops')),
        type: 'sales.request.to_operations',
        bodyAr: label,
        link,
        data: { requestId: String(r._id) },
      });
  }
  if (code.startsWith('finance_') && code !== 'finance_resubmit') {
    const recipients = [...sales, ...(r.needsProcurement ? await departmentMemberIds('procurement') : [])];
    await notify({
      userIds: notSelf([...new Set(recipients)]),
      type: 'sales.request.finance_decided',
      bodyAr: `${label}: ${SALES_REQUEST_STATE_AR[toState]}${reason ? ` — ${reason}` : ''}`,
      link,
      data: { requestId: String(r._id) },
    });
  } else if (from === 'procurement' && code.startsWith('execution_')) {
    await notify({
      userIds: notSelf(sales),
      type: 'sales.request.procurement_updated',
      bodyAr: `${label}: ${SALES_REQUEST_STATE_AR[toState]}`,
      link,
      data: { requestId: String(r._id) },
    });
  } else if (code === 'ops_complete' || code === 'estimate_done' || code === 'record_collection') {
    const extra = code === 'record_collection' ? await departmentMemberIds('finance') : [];
    await notify({
      userIds: notSelf([...new Set([...sales, ...extra])]),
      type: 'sales.request.operations_completed',
      bodyAr: label,
      link,
      data: { requestId: String(r._id) },
    });
  } else if (from === 'ops' && to === 'sales') {
    await notify({
      userIds: notSelf(sales),
      type: 'sales.request.updated',
      bodyAr: `${label}: ${SALES_REQUEST_STATE_AR[toState]}${reason ? ` — ${reason}` : ''}`,
      link,
      data: { requestId: String(r._id) },
    });
  } else if (from === 'ops' || (r.type === 'scrap' && to === 'ops')) {
    // Scrap: the other department is told on every status change [SAL §5.6].
    const other = from === 'ops' ? sales : await departmentMemberIds('ops');
    await notify({
      userIds: notSelf(other),
      type: 'sales.request.updated',
      bodyAr: `${label}: ${SALES_REQUEST_STATE_AR[toState]}`,
      link,
      data: { requestId: String(r._id) },
    });
  }
  if (code === 'record_transfer')
    await notify({
      userIds: notSelf([...new Set([...sales, ...(await departmentMemberIds('finance'))])]),
      type: 'sales.scrap.transfer',
      bodyAr: label,
      link,
      data: { requestId: String(r._id) },
    });
  if (toState === 'closed_success') {
    // «في حال الإغلاق بنجاح، يتم إرسال إشعار تلقائي إلى قسم التشغيل» [SAL §6.2]
    await notify({
      userIds: notSelf(await departmentMemberIds('ops')),
      type: 'sales.request.closed',
      bodyAr: `${label}: ${SALES_REQUEST_STATE_AR.closed_success}`,
      link,
      data: { requestId: String(r._id) },
    });
  }
}

/** Delay reason with the responsible department on an overdue stage-log row [SAL §19]. */
export async function setDelayReason(
  req: AuthedRequest,
  id: string,
  entryId: string,
  input: { delayReason: string; responsibleDepartment: RequestHolder },
) {
  const r = await loadFor(req, id);
  const rel = await relationsFor(req, r);
  if (!rel.includes('owner') && !rel.includes('sales_manager') && !rel.some((x) => x.endsWith('_manager')))
    throw forbidden();
  const row = await StageLog.findOne({
    _id: entryId,
    recordType: 'sales_request',
    recordId: String(r._id),
  }).lean();
  if (!row) throw notFound();
  if (!row.overdue) throw badRequest('هذه المرحلة لم تتجاوز مهلتها');
  // Append-only (S2 approval fix 2): a new row per reason; the stage-log entry is never rewritten.
  const deptId = await departmentIdByCode(HOLDER_CODE[input.responsibleDepartment]);
  const doc = await StageDelayReason.create({
    recordType: 'sales_request',
    recordId: String(r._id),
    stageLogId: row._id,
    reason: input.delayReason,
    responsibleDepartmentId: deptId ?? undefined,
    responsibleCode: input.responsibleDepartment,
    byUserId: String(req.auth.user._id),
    byEmail: req.auth.user.email,
  });
  await recordAudit(actorFrom(req), {
    action: 'create',
    resource: 'sales.requests.delay_reasons',
    resourceId: String(doc._id),
    after: {
      requestId: id,
      stageLogId: entryId,
      reason: input.delayReason,
      responsibleDepartment: input.responsibleDepartment,
    },
  });
  return getRequest(req, id);
}

// ------------------------------------------------------------------------------------------------
// Rental inspections, scrap assessments and tasks
// ------------------------------------------------------------------------------------------------
export async function addInspection(req: AuthedRequest, id: string, input: RentalInspectionInput) {
  const r = await loadFor(req, id);
  if (r.type !== 'containerRental') throw badRequest('النماذج خاصة بطلبات تأجير الحاويات');
  const rel = await relationsFor(req, r);
  if (!rel.some((x) => ['ops_staff', 'ops_manager', 'owner', 'sales_manager'].includes(x))) throw forbidden();
  const actor = actorFrom(req);
  return withTransaction(async (session) => {
    const files = [
      ...input.photoIds,
      ...(input.signatureAttachmentId ? [input.signatureAttachmentId] : []),
      ...(input.receiptProofAttachmentId ? [input.receiptProofAttachmentId] : []),
    ];
    await claimAttachments(files, 'sales_request', id, req.auth.user._id, session);
    const [doc] = await RentalInspection.create(
      [
        {
          ...input,
          requestId: r._id,
          byUserId: req.auth.user._id,
          byName: req.auth.user.displayNameAr,
          at: new Date(),
        },
      ],
      { session, ordered: true },
    );
    if (input.containerNumber)
      await SalesRequest.updateOne(
        { _id: r._id },
        {
          $addToSet: { 'details.containerNumbers': input.containerNumber },
          $set: { lastActivityAt: new Date() },
        },
        { session },
      );
    await SalesRequestAction.create(
      [
        {
          requestId: r._id,
          action: `inspection_${input.phase}`,
          actorUserId: actor.userId,
          actorEmail: actor.email,
          actorRelations: rel,
          note: input.containerCondition,
        },
      ],
      { session, ordered: true },
    );
    await recordAudit(
      actor,
      {
        action: 'create',
        resource: 'sales.requests.inspections',
        resourceId: String(doc._id),
        after: { requestId: id, phase: input.phase },
      },
      session,
    );
    return doc;
  });
}

export async function addAssessment(req: AuthedRequest, id: string, input: ScrapAssessmentInput) {
  const r = await loadFor(req, id);
  if (r.type !== 'scrap') throw badRequest('التقييم خاص بطلبات السكراب');
  const rel = await relationsFor(req, r);
  if (!rel.some((x) => ['ops_staff', 'ops_manager', 'owner', 'sales_manager'].includes(x))) throw forbidden();
  const actor = actorFrom(req);
  const doc = await withTransaction(async (session) => {
    const files = [
      ...input.photoIds,
      ...(input.inspectionReportAttachmentId ? [input.inspectionReportAttachmentId] : []),
    ];
    if (files.length) await claimAttachments(files, 'sales_request', id, req.auth.user._id, session);
    const [a] = await ScrapAssessment.create(
      [
        {
          ...input,
          visitAt: input.visitAt ? new Date(input.visitAt) : undefined,
          requestId: r._id,
          byUserId: req.auth.user._id,
          byName: req.auth.user.displayNameAr,
        },
      ],
      { session, ordered: true },
    );
    const set: Record<string, unknown> = { lastActivityAt: new Date() };
    if (input.proposedPriceHalalas !== undefined)
      set['scrap.proposedPriceHalalas'] = input.proposedPriceHalalas;
    if (input.agreedPriceHalalas !== undefined) set['scrap.agreedPriceHalalas'] = input.agreedPriceHalalas;
    if (input.estimatedWeightKg !== undefined) set['operations.estimatedWeightKg'] = input.estimatedWeightKg;
    await SalesRequest.updateOne({ _id: r._id }, { $set: set }, { session });
    await SalesRequestAction.create(
      [
        {
          requestId: r._id,
          action: 'assessment',
          actorUserId: actor.userId,
          actorEmail: actor.email,
          actorRelations: rel,
          note: input.result,
        },
      ],
      { session, ordered: true },
    );
    await recordAudit(
      actor,
      {
        action: 'create',
        resource: 'sales.requests.assessments',
        resourceId: String(a._id),
        after: { requestId: id },
      },
      session,
    );
    return a;
  });
  // The other department hears about it [SAL §5.6].
  const isOps = rel.includes('ops_staff');
  const recipients = isOps ? await salesSide(r) : await departmentMemberIds('ops');
  await notify({
    userIds: recipients.filter((u) => u !== String(req.auth.user._id)),
    type: 'sales.request.updated',
    bodyAr: `${r.number} — تقييم جديد`,
    link: `/sales/requests/${id}`,
    data: { requestId: id },
  });
  return doc;
}

/** «رفع مهمة» [SAL §5.6 ثانياً]: a core task (department queue rules apply) plus the scrap payload. */
export async function addScrapTask(req: AuthedRequest, id: string, input: ScrapTaskInput) {
  const r = await loadFor(req, id);
  if (r.type !== 'scrap') throw badRequest('المهام خاصة بطلبات السكراب');
  const rel = await relationsFor(req, r);
  if (!rel.some((x) => ['ops_staff', 'ops_manager', 'owner', 'sales_manager'].includes(x))) throw forbidden();
  // The core assignee rules (EP §16) need the actor's `tasks` scope; this route has no authorize() middleware.
  const taskEff = await permissionOn(req, 'tasks', 'create');
  const taskReq = {
    ...req,
    auth: req.auth,
    authz: taskEff ? { resource: 'tasks', action: 'create', ...taskEff } : undefined,
  } as AuthedRequest;
  const task = await createTask(taskReq, {
    title: `${input.taskType} — ${r.number}`,
    description: input.notes,
    assigneeId: input.assigneeUserId,
    priority: 'medium',
    startAt: input.assignedAt ? new Date(input.assignedAt) : undefined,
    dueAt: input.visitAt ? new Date(input.visitAt) : undefined,
    source: { type: 'sales_request', id: String(r._id) },
    attachmentIds: input.attachmentIds,
  });
  const doc = await ScrapTask.create({
    ...input,
    requestId: r._id,
    taskId: task._id,
    assignedAt: input.assignedAt ? new Date(input.assignedAt) : new Date(),
    visitAt: input.visitAt ? new Date(input.visitAt) : undefined,
    createdByUserId: req.auth.user._id,
  });
  await SalesRequestAction.create({
    requestId: r._id,
    action: 'task_created',
    actorUserId: String(req.auth.user._id),
    actorEmail: req.auth.user.email,
    actorRelations: rel,
    note: `${input.taskType} → ${task.number}`,
  });
  await recordAudit(actorFrom(req), {
    action: 'create',
    resource: 'sales.requests.tasks',
    resourceId: String(doc._id),
    after: { requestId: id, taskId: String(task._id) },
  });
  return { ...doc.toObject(), task: { number: task.number, status: task.status } };
}

export async function updateScrapTask(
  req: AuthedRequest,
  id: string,
  scrapTaskId: string,
  input: {
    transferStatus?: string;
    transferProofAttachmentId?: string;
    notes?: string;
    taskStatus?: 'done' | 'not_done';
  },
) {
  const r = await loadFor(req, id);
  const rel = await relationsFor(req, r);
  const st = await ScrapTask.findOne({ _id: scrapTaskId, requestId: r._id });
  if (!st) throw notFound();
  const isAssignee = String(st.assigneeUserId) === String(req.auth.user._id);
  if (!isAssignee && !rel.some((x) => ['ops_manager', 'sales_manager', 'owner'].includes(x)))
    throw forbidden();
  const set: Record<string, unknown> = {};
  if (input.transferStatus) {
    if (!rel.includes('scrap_transfer'))
      throw forbidden('تسجيل حالة تحويل المبلغ من صلاحيات الأدوار المخوّلة (إعداد sales.scrapTransferRoles)');
    if (
      input.transferStatus === 'transferred' &&
      !input.transferProofAttachmentId &&
      !st.transferProofAttachmentId
    )
      throw badRequest('إثبات التحويل مطلوب');
    set.transferStatus = input.transferStatus;
    if (input.transferProofAttachmentId) set.transferProofAttachmentId = input.transferProofAttachmentId;
  }
  if (input.notes !== undefined) set.notes = input.notes;
  if (input.transferProofAttachmentId)
    await claimAttachments([input.transferProofAttachmentId], 'sales_request', id, req.auth.user._id);
  if (Object.keys(set).length) await ScrapTask.updateOne({ _id: st._id }, { $set: set });
  if (input.taskStatus) {
    // «حالة المهمة (تمت / لم تتم)» maps onto the core task status; the assignee or a manager marks it.
    await Task.updateOne(
      { _id: st.taskId },
      {
        $set:
          input.taskStatus === 'done'
            ? { status: 'done', completedAt: new Date(), progressPercent: 100 }
            : { status: 'in_progress', completedAt: null },
      },
    );
  }
  await recordAudit(actorFrom(req), {
    action: 'update',
    resource: 'sales.requests.tasks',
    resourceId: scrapTaskId,
    after: { ...set, taskStatus: input.taskStatus },
  });
  if (input.transferStatus === 'transferred')
    await notify({
      userIds: [...new Set([...(await salesSide(r)), ...(await departmentMemberIds('finance'))])].filter(
        (u) => u !== String(req.auth.user._id),
      ),
      type: 'sales.scrap.transfer',
      bodyAr: `${r.number} — مهمة ${st.taskType}`,
      link: `/sales/requests/${id}`,
      data: { requestId: id },
    });
  return getRequest(req, id);
}

// ------------------------------------------------------------------------------------------------
// Jobs
// ------------------------------------------------------------------------------------------------
/** A stage past its SLA notifies the holding department's managers and the Sales side once per state entry [SAL §19]. */
export async function runRequestOverdueAlerts(now = new Date()): Promise<{ notified: number }> {
  const due = await SalesRequest.find({
    deletedAt: null,
    dueAt: { $lt: now },
    state: { $nin: [...FINAL_STATES] },
    $or: [{ overdueNotifiedFor: null }, { $expr: { $ne: ['$overdueNotifiedFor', '$stateEnteredAt'] } }],
  }).limit(200);
  let notified = 0;
  for (const r of due) {
    const claimed = await SalesRequest.updateOne(
      {
        _id: r._id,
        stateEnteredAt: r.stateEnteredAt,
        $or: [{ overdueNotifiedFor: null }, { overdueNotifiedFor: { $ne: r.stateEnteredAt } }],
      },
      { $set: { overdueNotifiedFor: r.stateEnteredAt } },
    );
    if (!claimed.modifiedCount) continue;
    const holder = r.holder as RequestHolder;
    const holderIds =
      holder === 'sales'
        ? []
        : await departmentManagerUserIds((await departmentIdByCode(HOLDER_CODE[holder])) ?? '');
    await notify({
      userIds: [...new Set([...(await salesSide(r)), ...holderIds])],
      type: 'sales.request.overdue',
      bodyAr: `${r.number} — ${r.title}: ${SALES_REQUEST_STATE_AR[r.state]} (${REQUEST_HOLDER_AR[holder]})`,
      link: `/sales/requests/${r._id}`,
      data: { requestId: String(r._id), state: r.state },
    });
    notified++;
  }
  return { notified };
}

/** Asset-return «موعد المحادثة أو المتابعة القادمة» reminder to the owner, once per date [SAL §5.7]. */
export async function runAssetReturnReminders(now = new Date()): Promise<{ notified: number }> {
  const hours = await getSetting('sales.followUpReminderHours');
  const until = new Date(now.getTime() + hours * 3_600_000);
  const due = await SalesRequest.find({
    deletedAt: null,
    type: 'assetReturn',
    state: { $nin: [...FINAL_STATES] },
    'assetReturn.nextConversationAt': { $ne: null, $lte: until },
    $or: [
      { 'assetReturn.reminderSentFor': null },
      { $expr: { $ne: ['$assetReturn.reminderSentFor', '$assetReturn.nextConversationAt'] } },
    ],
  }).limit(200);
  let notified = 0;
  for (const r of due) {
    const at = r.assetReturn!.nextConversationAt!;
    const claimed = await SalesRequest.updateOne(
      {
        _id: r._id,
        'assetReturn.nextConversationAt': at,
        $or: [{ 'assetReturn.reminderSentFor': null }, { 'assetReturn.reminderSentFor': { $ne: at } }],
      },
      { $set: { 'assetReturn.reminderSentFor': at } },
    );
    if (!claimed.modifiedCount) continue;
    await notify({
      userIds: [String(r.ownerUserId)],
      type: 'sales.assetreturn.reminder',
      bodyAr: `${r.number} — ${r.title}`,
      link: `/sales/requests/${r._id}`,
      data: { requestId: String(r._id) },
    });
    notified++;
  }
  return { notified };
}
