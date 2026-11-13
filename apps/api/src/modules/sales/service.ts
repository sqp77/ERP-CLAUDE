import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { randomUUID } from 'node:crypto';
import {
  OPEN_OPPORTUNITY_STAGES,
  arabicSearchRegex,
  type CreateOpportunityInput,
  type OpportunityStageInput,
} from '@eayni/shared';
import { badRequest, conflict, forbidden, notFound } from '../../core/http/errors';
import { actorFrom, type Actor, type Authz, type AuthedRequest } from '../../core/http/context';
import { recordAudit } from '../../core/audit/service';
import { nextNumber } from '../../core/numbering/service';
import { notify } from '../../core/notifications/service';
import { publish } from '../../core/outbox/service';
import { getSetting } from '../../core/settings/service';
import { claimAttachments } from '../../core/files/service';
import { canonicalTags } from '../../core/tags/service';
import type { UserDoc } from '../../core/auth/model';
import { withTransaction } from '../../db';
import { riyadhDayRange } from '../../core/dates/businessDays';
import {
  assertSalesTarget,
  canAccessCustomer,
  countCustomers,
  countLeads,
  customerLabels,
  permissionOn,
  salesDepartmentId,
  userNames,
  TAG_SCOPE,
} from '../crm/service';
import { Opportunity, OpportunityEvent, type OpportunityDoc } from './model';

const isManagerScope = (scope: string) => scope === 'department' || scope === 'all';

export function opportunityScopeFilter(user: UserDoc, authz: Authz): FilterQuery<unknown> {
  if (authz.scope === 'all') return {};
  if (authz.scope === 'department')
    return {
      $or: [
        { departmentId: { $in: authz.departmentIds.map((d) => new Types.ObjectId(d)) } },
        { ownerUserId: user._id },
      ],
    };
  return { ownerUserId: user._id };
}

export async function canAccessOpportunity(req: AuthedRequest, id: string): Promise<boolean> {
  const eff = await permissionOn(req, 'sales.opportunities', 'view');
  if (!eff) return false;
  const filter = opportunityScopeFilter(req.auth.user, {
    resource: 'sales.opportunities',
    action: 'view',
    ...eff,
  });
  return !!(await Opportunity.exists({ _id: id, deletedAt: null, ...filter }));
}

async function loadFor(req: AuthedRequest, id: string, action: 'view' | 'edit' = 'view') {
  const eff = await permissionOn(req, 'sales.opportunities', action);
  if (!eff) throw forbidden();
  const filter = opportunityScopeFilter(req.auth.user, { resource: 'sales.opportunities', action, ...eff });
  const o = await Opportunity.findOne({ _id: id, deletedAt: null, ...filter });
  if (!o) throw notFound();
  return { opportunity: o, eff };
}

/**
 * Create an opportunity inside a session (used by the customer-created hook and by POST /sales/opportunities).
 * The customer must be visible to the caller; a manager may name another owner [SAL §8.1].
 */
export async function createOpportunityIn(
  session: ClientSession | undefined,
  req: AuthedRequest,
  input: Omit<CreateOpportunityInput, 'attachmentIds' | 'tags'> & {
    attachmentIds?: string[];
    tags?: string[];
  },
  owner: { _id: unknown; departmentId?: unknown },
): Promise<OpportunityDoc & { _id: unknown }> {
  const actor = actorFrom(req);
  const departmentId = owner.departmentId ?? (await salesDepartmentId());
  const [doc] = await Opportunity.create(
    [
      {
        number: await nextNumber('opportunity', session),
        customerId: input.customerId,
        title: input.title,
        serviceType: input.serviceType,
        stage: 'new',
        expectedValueHalalas: input.expectedValueHalalas,
        ownerUserId: owner._id,
        departmentId,
        createdByUserId: req.auth.user._id,
        nextFollowUpAt: input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : undefined,
        attachmentIds: input.attachmentIds ?? [],
        tags: await canonicalTags(TAG_SCOPE, input.tags ?? []),
        leadId: input.leadId,
      },
    ],
    { session, ordered: true },
  );
  if (input.attachmentIds?.length)
    await claimAttachments(input.attachmentIds, 'opportunity', String(doc._id), req.auth.user._id, session);
  await OpportunityEvent.create(
    [
      {
        opportunityId: doc._id,
        type: 'created',
        to: 'new',
        toUserId: owner._id,
        byUserId: actor.userId,
        byEmail: actor.email,
      },
    ],
    { session, ordered: true },
  );
  await recordAudit(
    actor,
    {
      action: 'create',
      resource: 'sales.opportunities',
      resourceId: String(doc._id),
      after: { number: doc.number, title: doc.title, customerId: String(doc.customerId) },
    },
    session,
  );
  return doc;
}

export async function createOpportunity(req: AuthedRequest, input: CreateOpportunityInput) {
  if (!(await canAccessCustomer(req, input.customerId))) throw notFound('العميل غير موجود');
  const authz = req.authz!;
  let owner: UserDoc = req.auth.user;
  if (input.ownerUserId && input.ownerUserId !== String(req.auth.user._id)) {
    if (!isManagerScope(authz.scope)) throw forbidden('تعيين الموظف المسؤول من صلاحيات مدير القسم');
    owner = await assertSalesTarget(authz, input.ownerUserId);
  }
  const doc = await withTransaction((session) => createOpportunityIn(session, req, input, owner));
  if (String(owner._id) !== String(req.auth.user._id))
    await notify({
      userIds: [String(owner._id)],
      type: 'sales.opportunity.assigned',
      bodyAr: `${doc.number} — ${doc.title}`,
      link: `/sales/pipeline?opportunity=${doc._id}`,
      data: { opportunityId: String(doc._id) },
    });
  return doc;
}

export interface ListOpportunitiesQuery {
  page: number;
  limit: number;
  stage?: string;
  open?: boolean;
  customerId?: string;
  ownerUserId?: string;
  serviceType?: string;
  tag?: string;
  followUpDue?: boolean;
  q?: string;
  createdFrom?: string;
  createdTo?: string;
  closedFrom?: string;
  closedTo?: string;
}
/** The opportunity list filter, shared by the list and the Sales dashboard (one number, one list — SAL §13). */
export function opportunityListFilter(
  user: UserDoc,
  authz: Authz,
  q: Partial<ListOpportunitiesQuery>,
  now = new Date(),
): FilterQuery<unknown> {
  const filter: FilterQuery<unknown> = {
    deletedAt: null,
    ...opportunityScopeFilter(user, authz),
  };
  if (q.stage) filter.stage = q.stage;
  if (q.open) filter.stage = { $in: OPEN_OPPORTUNITY_STAGES };
  if (q.customerId) filter.customerId = q.customerId;
  if (q.ownerUserId) filter.ownerUserId = q.ownerUserId;
  if (q.serviceType) filter.serviceType = q.serviceType;
  if (q.tag) filter.tags = q.tag;
  if (q.followUpDue) {
    filter.nextFollowUpAt = { $lt: now };
    filter.stage = { $in: OPEN_OPPORTUNITY_STAGES };
  }
  // $and, not $or: a manager's department scope is an $or and must survive the search.
  if (q.q) filter.$and = [{ $or: [{ title: arabicSearchRegex(q.q) }, { number: q.q.toUpperCase() }] }];
  const created = riyadhDayRange(q.createdFrom, q.createdTo);
  if (created) filter.createdAt = created;
  // Won / lost in a window: the date the deal closed (wonAt / lostAt), whatever the stage filter says.
  const closed = riyadhDayRange(q.closedFrom, q.closedTo);
  if (closed)
    filter.$and = [
      ...((filter.$and as FilterQuery<unknown>[] | undefined) ?? []),
      { $or: [{ wonAt: closed }, { lostAt: closed }] },
    ];
  return filter;
}

export async function listOpportunities(req: AuthedRequest, q: ListOpportunitiesQuery) {
  const filter = opportunityListFilter(req.auth.user, req.authz!, q);
  const [rows, total] = await Promise.all([
    Opportunity.find(filter)
      .sort({ updatedAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Opportunity.countDocuments(filter),
  ]);
  const names = await userNames(rows.map((r) => r.ownerUserId));
  const byId = await customerLabels(rows.map((r) => r.customerId));
  return {
    items: rows.map((r) => ({
      ...r,
      ownerName: names.get(String(r.ownerUserId)) ?? '',
      customerName: byId.get(String(r.customerId))?.nameAr ?? '',
      customerNumber: byId.get(String(r.customerId))?.number ?? '',
    })),
    total,
    page: q.page,
    limit: q.limit,
  };
}

export async function getOpportunity(req: AuthedRequest, id: string) {
  const { opportunity, eff } = await loadFor(req, id);
  const [events, names] = await Promise.all([
    OpportunityEvent.find({ opportunityId: opportunity._id }).sort({ at: 1 }).lean(),
    userNames([opportunity.ownerUserId]),
  ]);
  const eventNames = await userNames(events.flatMap((e) => [e.byUserId, e.fromUserId, e.toUserId]));
  const customer = (await customerLabels([opportunity.customerId])).get(String(opportunity.customerId));
  return {
    ...opportunity.toObject(),
    ownerName: names.get(String(opportunity.ownerUserId)) ?? '',
    customerName: customer?.nameAr,
    customerNumber: customer?.number,
    events: events.map((e) => ({
      ...e,
      byUserName: e.byUserId ? eventNames.get(String(e.byUserId)) : undefined,
      fromUserName: e.fromUserId ? eventNames.get(String(e.fromUserId)) : undefined,
      toUserName: e.toUserId ? eventNames.get(String(e.toUserId)) : undefined,
    })),
    canManage: isManagerScope(eff.scope),
  };
}

export async function updateOpportunity(req: AuthedRequest, id: string, input: Record<string, unknown>) {
  const { opportunity } = await loadFor(req, id, 'edit');
  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    if (v === null) unset[k] = 1;
    else if (k === 'tags') set.tags = await canonicalTags(TAG_SCOPE, v as string[]);
    else if (k === 'nextFollowUpAt') set.nextFollowUpAt = new Date(v as string);
    else set[k] = v;
  }
  const actor = actorFrom(req);
  await withTransaction(async (session) => {
    if ((set.attachmentIds as string[] | undefined)?.length)
      await claimAttachments(set.attachmentIds as string[], 'opportunity', id, req.auth.user._id, session);
    await Opportunity.updateOne(
      { _id: id },
      {
        ...(Object.keys(set).length ? { $set: set } : {}),
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
      },
      { session },
    );
    await OpportunityEvent.create(
      [
        {
          opportunityId: opportunity._id,
          type: 'updated',
          byUserId: actor.userId,
          byEmail: actor.email,
          note: Object.keys(input).join(', '),
        },
      ],
      { session, ordered: true },
    );
    await recordAudit(
      actor,
      {
        action: 'update',
        resource: 'sales.opportunities',
        resourceId: id,
        before: opportunity.toObject(),
        after: set,
      },
      session,
    );
  });
  return getOpportunity(req, id);
}

/** Stage move [SAL §4.1]: خاسرة needs a reason from the configurable list; won/lost stamp their dates. */
export async function changeStage(req: AuthedRequest, id: string, input: OpportunityStageInput) {
  const { opportunity } = await loadFor(req, id, 'edit');
  if (opportunity.stage === input.stage) throw conflict('الفرصة في هذه المرحلة بالفعل');
  if (input.stage === 'lost') {
    const reasons = await getSetting('sales.lossReasons');
    if (!reasons.includes(input.lostReason!))
      throw badRequest('سبب الخسارة غير معرّف في القائمة', [
        { path: 'lostReason', message: 'اختر سببًا من القائمة' },
      ]);
    if (input.lostReason!.startsWith('أخرى') && !input.lostNote)
      throw badRequest('وضّح السبب', [{ path: 'lostNote', message: 'التوضيح مطلوب مع «أخرى»' }]);
  }
  const actor = actorFrom(req);
  const now = new Date();
  await withTransaction(async (session) => {
    const set: Record<string, unknown> = { stage: input.stage, lastContactAt: now };
    if (input.stage === 'lost')
      Object.assign(set, { lostReason: input.lostReason, lostNote: input.lostNote, lostAt: now });
    if (input.stage === 'won') set.wonAt = now;
    // Conditional on the current stage: the loser of a race gets 409 (review B9).
    const r = await Opportunity.updateOne({ _id: id, stage: opportunity.stage }, { $set: set }, { session });
    if (!r.modifiedCount) throw conflict('تغيّرت مرحلة الفرصة من مستخدم آخر، أعد التحميل');
    await OpportunityEvent.create(
      [
        {
          opportunityId: opportunity._id,
          type: 'stage_changed',
          from: opportunity.stage,
          to: input.stage,
          byUserId: actor.userId,
          byEmail: actor.email,
          note:
            input.note ??
            (input.stage === 'lost'
              ? `${input.lostReason}${input.lostNote ? ` — ${input.lostNote}` : ''}`
              : undefined),
        },
      ],
      { session, ordered: true },
    );
    await recordAudit(
      actor,
      {
        action: 'transition',
        resource: 'sales.opportunities',
        resourceId: id,
        before: { stage: opportunity.stage },
        after: { stage: input.stage, lostReason: input.lostReason },
      },
      session,
    );
    await publish(
      {
        type: 'sales.opportunity.stage_changed',
        aggregateType: 'opportunity',
        aggregateId: id,
        payload: { from: opportunity.stage, to: input.stage },
        actorUserId: actor.userId,
      },
      session,
    );
  });
  return getOpportunity(req, id);
}

/** «إعادة توزيع العملاء والفرص البيعية» [SAL §8.1]: manager only; both reps are told. */
export async function reassignOpportunities(
  req: AuthedRequest,
  input: { opportunityIds: string[]; toUserId: string; reason: string },
) {
  if (!isManagerScope(req.authz!.scope)) throw forbidden('إعادة توزيع الفرص من صلاحيات مدير القسم');
  const to = await assertSalesTarget(req.authz!, input.toUserId);
  const rows = await Opportunity.find({
    _id: { $in: input.opportunityIds },
    deletedAt: null,
    ...opportunityScopeFilter(req.auth.user, req.authz!),
  })
    .select('_id number title ownerUserId')
    .lean();
  if (rows.length !== input.opportunityIds.length)
    throw notFound('بعض الفرص غير موجودة أو خارج نطاق صلاحيتك');
  const moved = rows.filter((r) => String(r.ownerUserId) !== String(to._id));
  const batchId = randomUUID();
  if (!moved.length) return { moved: 0, batchId };
  const actor = actorFrom(req);
  await withTransaction((session) =>
    moveOpportunities(session, moved, String(to._id), actor, input.reason, batchId),
  );
  const summary = moved.length === 1 ? `${moved[0].number} — ${moved[0].title}` : `${moved.length} فرص`;
  await notify({
    userIds: [String(to._id)],
    type: 'sales.opportunity.assigned',
    bodyAr: `${summary} (${input.reason})`,
    link: '/sales/pipeline',
    data: { batchId },
  });
  await notify({
    userIds: [...new Set(moved.map((r) => String(r.ownerUserId)))].filter((u) => u !== String(to._id)),
    type: 'crm.owner_changed',
    bodyAr: `${summary} → ${to.displayNameAr} (${input.reason})`,
    link: '/sales/pipeline',
    data: { batchId },
  });
  return { moved: moved.length, batchId };
}

async function moveOpportunities(
  session: ClientSession | undefined,
  rows: { _id: unknown; ownerUserId: unknown }[],
  toUserId: string,
  actor: Actor,
  reason: string,
  batchId: string,
) {
  await Opportunity.updateMany(
    { _id: { $in: rows.map((r) => r._id) } },
    { $set: { ownerUserId: toUserId } },
    { session },
  );
  await OpportunityEvent.create(
    rows.map((r) => ({
      opportunityId: r._id,
      type: 'reassigned',
      fromUserId: r.ownerUserId,
      toUserId,
      byUserId: actor.userId,
      byEmail: actor.email,
      note: reason,
      batchId,
    })),
    { session, ordered: true },
  );
  await recordAudit(
    actor,
    {
      action: 'update',
      resource: 'sales.opportunities',
      resourceId: batchId,
      meta: { reassign: true, count: rows.length, toUserId, reason },
    },
    session,
  );
}

/** Customer transfer hook (CRM): open opportunities of the moved customers follow the new owner. */
export async function followCustomerTransfer(args: {
  customerIds: string[];
  toUserId: string;
  actor: Actor;
  reason: string;
  batchId: string;
  session: ClientSession | undefined;
}) {
  const rows = await Opportunity.find({
    customerId: { $in: args.customerIds },
    deletedAt: null,
    stage: { $in: OPEN_OPPORTUNITY_STAGES },
    ownerUserId: { $ne: args.toUserId },
  })
    .select('_id ownerUserId')
    .session(args.session ?? null)
    .lean();
  if (rows.length)
    await moveOpportunities(args.session, rows, args.toUserId, args.actor, args.reason, args.batchId);
}

/** Pipeline columns [SAL §4.2]: counts and expected value per stage, within the caller's scope. */
export async function pipelineSummary(req: AuthedRequest, ownerUserId?: string) {
  const filter: FilterQuery<unknown> = {
    deletedAt: null,
    ...opportunityScopeFilter(req.auth.user, req.authz!),
  };
  if (ownerUserId) filter.ownerUserId = ownerUserId;
  const rows = await Opportunity.aggregate<{ _id: string; count: number; value: number; overdue: number }>([
    { $match: filter },
    {
      $group: {
        _id: '$stage',
        count: { $sum: 1 },
        value: { $sum: { $ifNull: ['$expectedValueHalalas', 0] } },
        overdue: { $sum: { $cond: [{ $lt: ['$nextFollowUpAt', new Date()] }, 1, 0] } },
      },
    },
  ]);
  return Object.fromEntries(
    rows.map((r) => [r._id, { count: r.count, valueHalalas: r.value, overdue: r.overdue }]),
  );
}

/** Follow-up reminders for opportunities (notification 3), same rule as customers. */
export async function runOpportunityFollowUps(now = new Date()): Promise<{ notified: number }> {
  const hours = await getSetting('sales.followUpReminderHours');
  const until = new Date(now.getTime() + hours * 3_600_000);
  const due = await Opportunity.find({
    deletedAt: null,
    stage: { $in: OPEN_OPPORTUNITY_STAGES },
    nextFollowUpAt: { $ne: null, $lte: until },
    $or: [{ followUpNotifiedFor: null }, { $expr: { $ne: ['$followUpNotifiedFor', '$nextFollowUpAt'] } }],
  })
    .select('_id number title ownerUserId nextFollowUpAt')
    .limit(500)
    .lean();
  let notified = 0;
  for (const o of due) {
    const claimed = await Opportunity.updateOne(
      {
        _id: o._id,
        nextFollowUpAt: o.nextFollowUpAt,
        $or: [{ followUpNotifiedFor: null }, { followUpNotifiedFor: { $ne: o.nextFollowUpAt } }],
      },
      { $set: { followUpNotifiedFor: o.nextFollowUpAt } },
    );
    if (!claimed.modifiedCount) continue;
    await notify({
      userIds: [String(o.ownerUserId)],
      type: 'crm.followup.due',
      bodyAr: `${o.number} — ${o.title}`,
      link: `/sales/pipeline?opportunity=${o._id}`,
      data: { opportunityId: String(o._id) },
    });
    notified++;
  }
  return { notified };
}

/** The Sales landing page [SAL §18 «الواجهة الرئيسية»]: my follow-ups, my open opportunities, my customers. */
export async function salesHome(req: AuthedRequest) {
  const me = req.auth.user._id;
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setUTCHours(23, 59, 59, 999);
  const custScope = opportunityScopeFilter(req.auth.user, req.authz!);
  const [myCustomers, followUpsDue, openOpportunities, overdueOpportunities, leadsForMe, deptCustomers] =
    await Promise.all([
      countCustomers({ ownerUserId: me }),
      countCustomers({ ownerUserId: me, nextFollowUpAt: { $lte: endOfToday } }),
      Opportunity.countDocuments({
        deletedAt: null,
        ownerUserId: me,
        stage: { $in: OPEN_OPPORTUNITY_STAGES },
      }),
      Opportunity.countDocuments({
        deletedAt: null,
        ownerUserId: me,
        stage: { $in: OPEN_OPPORTUNITY_STAGES },
        nextFollowUpAt: { $lt: now },
      }),
      countLeads({
        assigneeUserId: me,
        state: { $in: ['new', 'referred', 'contacted', 'following_up', 'opportunity'] },
      }),
      isManagerScope(req.authz!.scope) ? countCustomers(custScope) : Promise.resolve(null),
    ]);
  const unassignedLeads = isManagerScope(req.authz!.scope)
    ? await countLeads({
        targetDepartment: 'sales',
        assigneeUserId: null,
        state: { $in: ['new', 'referred'] },
      })
    : null;
  return {
    myCustomers,
    followUpsDue,
    openOpportunities,
    overdueOpportunities,
    leadsForMe,
    deptCustomers,
    unassignedLeads,
    isManager: isManagerScope(req.authz!.scope),
  };
}
