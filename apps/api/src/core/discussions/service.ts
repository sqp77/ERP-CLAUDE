import { Types, type FilterQuery } from 'mongoose';
import {
  DISCUSSION_STATE_AR,
  type CreateDiscussionInput,
  type DiscussionState,
  type RoleAssignment,
} from '@eayni/shared';
import { badRequest, conflict, forbidden, notFound } from '../http/errors';
import { actorFrom, type AuthedRequest } from '../http/context';
import { effectivePermission, type Effective } from '../rbac/service';
import { recordAudit } from '../audit/service';
import { notify } from '../notifications/service';
import { nextNumber } from '../numbering/service';
import { claimAttachments } from '../files/service';
import { canAccessRecord } from '../access/registry';
import { resolveRecord } from '../records/resolvers';
import { departmentManagerUserIds } from '../tasks/jobs';
import { User } from '../auth/model';
import { Department } from '../org/model';
import { withTransaction } from '../../db';
import { Discussion, DiscussionEntry, type DiscussionDoc } from './model';

/**
 * Department discussions [SAL §10.3]. Who takes part:
 * - the requester side: the person who opened it and the managers of his department;
 * - the handling side: the target department's members and managers, and the people added to the thread;
 * - anyone who may open the linked record sees its discussions (a rep sees the threads on his customer) and, when in
 *   the requester's department, takes part on that side;
 * - `discussions:view` with scope all (executive) reads everything, writes nothing.
 * Every message, state change and added participant is an append-only entry; a closed discussion is read-only.
 */

const OPEN_STATES: DiscussionState[] = ['new', 'in_progress', 'awaiting_reply'];
type Lean = DiscussionDoc & { _id: Types.ObjectId };

async function perm(req: AuthedRequest, action: 'view' | 'create'): Promise<Effective | null> {
  return effectivePermission(
    req.auth.user.roles as RoleAssignment[],
    req.auth.user.departmentId ? String(req.auth.user.departmentId) : undefined,
    'discussions',
    action,
    String(req.auth.user._id),
  );
}

const myDept = (req: AuthedRequest) =>
  req.auth.user.departmentId ? String(req.auth.user.departmentId) : undefined;
const managedDepts = (eff: Effective | null) => (eff && eff.scope === 'department' ? eff.departmentIds : []);

interface Sides {
  requester: boolean;
  handler: boolean;
  view: boolean;
}

async function sidesOf(req: AuthedRequest, d: Lean): Promise<Sides> {
  const me = String(req.auth.user._id);
  const eff = await perm(req, 'view');
  const managed = managedDepts(eff);
  const dept = myDept(req);
  const target = String(d.targetDepartmentId);
  const origin = d.openedByDepartmentId ? String(d.openedByDepartmentId) : undefined;
  const handler =
    dept === target || managed.includes(target) || d.participantUserIds.some((p) => String(p) === me);
  let requester = String(d.openedByUserId) === me || (!!origin && managed.includes(origin));
  let viaRecord = false;
  if (!requester && !handler) viaRecord = await canAccessRecord(req, d.recordType, d.recordId);
  if (viaRecord && origin && dept === origin) requester = true;
  const view = requester || handler || viaRecord || eff?.scope === 'all';
  return { requester, handler, view };
}

export async function canAccessDiscussion(req: AuthedRequest, id: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(id)) return false;
  const d = (await Discussion.findById(id).lean()) as Lean | null;
  if (!d) return false;
  return (await sidesOf(req, d)).view;
}

async function load(req: AuthedRequest, id: string): Promise<{ d: Lean; sides: Sides }> {
  if (!Types.ObjectId.isValid(id)) throw notFound();
  const d = (await Discussion.findById(id).lean()) as Lean | null;
  if (!d) throw notFound();
  const sides = await sidesOf(req, d);
  // Outside the circle a discussion answers 404, like a missing one (go-live review E5).
  if (!sides.view) throw notFound();
  return { d, sides };
}

async function departmentPeople(departmentId: string): Promise<{ managers: string[]; members: string[] }> {
  const [roleManagers, dept, members] = await Promise.all([
    departmentManagerUserIds(departmentId),
    Department.findById(departmentId).select('managerUserId').lean(),
    User.find({ departmentId, status: 'active', deletedAt: null }).select('_id').lean(),
  ]);
  const managers = [...roleManagers, ...(dept?.managerUserId ? [String(dept.managerUserId)] : [])];
  return { managers: [...new Set(managers)], members: members.map((m) => String(m._id)) };
}

async function assertActiveUsers(ids: string[]) {
  if (!ids.length) return;
  const n = await User.countDocuments({ _id: { $in: ids }, status: 'active', deletedAt: null });
  if (n !== new Set(ids).size) throw badRequest('أحد الموظفين المضافين غير موجود أو غير نشط');
}

// ------------------------------------------------------------------------------------------------
// Open
// ------------------------------------------------------------------------------------------------
export async function openDiscussion(req: AuthedRequest, input: CreateDiscussionInput) {
  if (!(await perm(req, 'create'))) throw forbidden();
  // The caller must be able to open the record the discussion is about [SAL §10.3 «مرتبطة بالعميل أو الطلب»].
  const record = await resolveRecord(input.recordType, input.recordId, req);
  if (!record)
    throw badRequest('السجل المرتبط غير موجود أو لا تملك صلاحية عليه', [
      { path: 'recordId', message: 'غير موجود' },
    ]);
  const target = await Department.findOne({
    _id: input.targetDepartmentId,
    deletedAt: null,
    active: { $ne: false },
  })
    .select('nameAr')
    .lean();
  if (!target)
    throw badRequest('القسم المعني غير موجود', [{ path: 'targetDepartmentId', message: 'غير موجود' }]);
  const me = String(req.auth.user._id);
  const participants = [...new Set(input.participantUserIds.filter((p) => p !== me))];
  await assertActiveUsers(participants);
  const actor = actorFrom(req);
  const now = new Date();
  const doc = await withTransaction(async (session) => {
    const number = await nextNumber('discussion', session);
    const [d] = await Discussion.create(
      [
        {
          number,
          recordType: input.recordType,
          recordId: record.id,
          recordLabel: record.label,
          title: input.title,
          details: input.details,
          openedByUserId: req.auth.user._id,
          openedByName: req.auth.user.displayNameAr,
          openedByDepartmentId: req.auth.user.departmentId,
          targetDepartmentId: input.targetDepartmentId,
          participantUserIds: participants,
          attachmentIds: input.attachmentIds,
          state: 'new',
          lastActivityAt: now,
          lastActivityByUserId: req.auth.user._id,
        },
      ],
      { session, ordered: true },
    );
    await claimAttachments(input.attachmentIds, 'discussion', String(d._id), req.auth.user._id, session);
    await DiscussionEntry.create(
      [
        {
          discussionId: d._id,
          kind: 'opened',
          body: input.details,
          toState: 'new',
          attachmentIds: input.attachmentIds,
          participantUserIds: participants,
          authorUserId: req.auth.user._id,
          authorName: req.auth.user.displayNameAr,
          authorDepartmentId: req.auth.user.departmentId,
          at: now,
        },
      ],
      { session, ordered: true },
    );
    await recordAudit(
      actor,
      {
        action: 'create',
        resource: 'discussions',
        resourceId: String(d._id),
        after: {
          number,
          recordType: input.recordType,
          recordId: record.id,
          targetDepartmentId: input.targetDepartmentId,
          participants,
        },
      },
      session,
    );
    return d.toObject();
  });
  // «إشعار القسم المعني بوجود طلب متابعة» (SAL §10.3, notification 15 of SAL §14).
  const people = await departmentPeople(input.targetDepartmentId);
  await notify({
    userIds: [...people.managers, ...people.members, ...participants].filter((u) => u !== me),
    type: 'discussion.opened',
    bodyAr: `${doc.number} — ${input.title}${record.label ? ` (${record.label})` : ''} — من ${req.auth.user.displayNameAr}`,
    link: `/discussions/${doc._id}`,
    data: { recordType: input.recordType, recordId: record.id },
  });
  return doc;
}

// ------------------------------------------------------------------------------------------------
// Read
// ------------------------------------------------------------------------------------------------
export interface ListDiscussionsQuery {
  page: number;
  limit: number;
  view: 'mine' | 'department';
  state?: DiscussionState;
  open?: boolean;
  recordType?: string;
  recordId?: string;
}

export async function listDiscussions(req: AuthedRequest, q: ListDiscussionsQuery) {
  const eff = await perm(req, 'view');
  if (!eff) throw forbidden();
  const me = req.auth.user._id;
  const dept = myDept(req);
  const depts = [...new Set([...(dept ? [dept] : []), ...managedDepts(eff)])].map(
    (d) => new Types.ObjectId(d),
  );
  const filter: FilterQuery<unknown> = {};
  const and: FilterQuery<unknown>[] = [];
  const recordPanel = q.recordType && q.recordId;
  if (recordPanel) {
    filter.recordType = q.recordType;
    filter.recordId = q.recordId;
    // The panel on a record: whoever may open the record sees all its threads.
    if (eff.scope !== 'all' && !(await canAccessRecord(req, q.recordType!, q.recordId!)))
      and.push({
        $or: [
          { openedByUserId: me },
          { participantUserIds: me },
          { targetDepartmentId: { $in: depts } },
          { openedByDepartmentId: { $in: managedDepts(eff).map((d) => new Types.ObjectId(d)) } },
        ],
      });
  } else if (q.view === 'mine') {
    and.push({ $or: [{ openedByUserId: me }, { participantUserIds: me }] });
  } else if (eff.scope !== 'all') {
    const managed = managedDepts(eff).map((d) => new Types.ObjectId(d));
    // The department inbox: threads routed to my department, and for managers those opened by their department.
    and.push({
      $or: [
        { targetDepartmentId: { $in: depts } },
        ...(managed.length ? [{ openedByDepartmentId: { $in: managed } }] : []),
      ],
    });
  }
  if (q.state) filter.state = q.state;
  else if (q.open) filter.state = { $in: OPEN_STATES };
  if (and.length) filter.$and = and;
  const [rows, total] = await Promise.all([
    Discussion.find(filter)
      .sort({ lastActivityAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Discussion.countDocuments(filter),
  ]);
  const deptNames = await departmentNames(
    rows.flatMap((r) => [r.targetDepartmentId, r.openedByDepartmentId]),
  );
  return {
    items: rows.map((r) => ({
      ...r,
      targetDepartmentName: deptNames.get(String(r.targetDepartmentId)),
      openedByDepartmentName: r.openedByDepartmentId
        ? deptNames.get(String(r.openedByDepartmentId))
        : undefined,
    })),
    total,
    page: q.page,
    limit: q.limit,
  };
}

async function departmentNames(ids: unknown[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const rows = await Department.find({ _id: { $in: unique } })
    .select('nameAr')
    .lean();
  return new Map(rows.map((r) => [String(r._id), r.nameAr]));
}

/** Transitions each side may make; the rest answer 400 [SAL §10.3 «حالات المعالجة»]. */
function allowedNext(d: Lean, sides: Sides): DiscussionState[] {
  const s = d.state as DiscussionState;
  const out = new Set<DiscussionState>();
  if (s === 'closed') return [];
  if (sides.handler) {
    if (s === 'new')
      ['in_progress', 'awaiting_reply', 'resolved'].forEach((x) => out.add(x as DiscussionState));
    if (s === 'in_progress') ['awaiting_reply', 'resolved'].forEach((x) => out.add(x as DiscussionState));
    if (s === 'awaiting_reply') ['in_progress', 'resolved'].forEach((x) => out.add(x as DiscussionState));
  }
  if (sides.requester) {
    if (s === 'awaiting_reply') out.add('in_progress');
    // The requester confirms the solution, reopens it, or withdraws an open discussion (with a note).
    if (s === 'resolved') {
      out.add('closed');
      out.add('in_progress');
    }
    if (OPEN_STATES.includes(s)) out.add('closed');
  }
  return [...out];
}

export async function getDiscussion(req: AuthedRequest, id: string) {
  const { d, sides } = await load(req, id);
  const entries = await DiscussionEntry.find({ discussionId: d._id }).sort({ at: 1 }).lean();
  const deptNames = await departmentNames([
    d.targetDepartmentId,
    d.openedByDepartmentId,
    ...entries.map((e) => e.authorDepartmentId),
  ]);
  const people = await User.find({ _id: { $in: d.participantUserIds } })
    .select('displayNameAr departmentId')
    .lean();
  const canWrite = d.state !== 'closed' && (sides.requester || sides.handler);
  return {
    ...d,
    targetDepartmentName: deptNames.get(String(d.targetDepartmentId)),
    openedByDepartmentName: d.openedByDepartmentId
      ? deptNames.get(String(d.openedByDepartmentId))
      : undefined,
    participants: people.map((p) => ({
      userId: String(p._id),
      name: p.displayNameAr,
      departmentName: p.departmentId ? deptNames.get(String(p.departmentId)) : undefined,
    })),
    entries: entries.map((e) => ({
      ...e,
      authorDepartmentName: e.authorDepartmentId ? deptNames.get(String(e.authorDepartmentId)) : undefined,
    })),
    side:
      sides.handler && sides.requester
        ? 'both'
        : sides.handler
          ? 'handler'
          : sides.requester
            ? 'requester'
            : 'viewer',
    canReply: canWrite,
    canAddParticipants: canWrite,
    allowedStates: allowedNext(d, sides),
  };
}

// ------------------------------------------------------------------------------------------------
// Write
// ------------------------------------------------------------------------------------------------
async function recipients(d: Lean, exclude: string): Promise<string[]> {
  const [authors, people] = await Promise.all([
    DiscussionEntry.distinct('authorUserId', { discussionId: d._id }),
    departmentPeople(String(d.targetDepartmentId)),
  ]);
  return [
    ...new Set([
      String(d.openedByUserId),
      ...d.participantUserIds.map(String),
      ...authors.map(String),
      ...people.managers,
    ]),
  ].filter((u) => u !== exclude);
}

async function changeState(
  req: AuthedRequest,
  d: Lean,
  from: DiscussionState,
  to: DiscussionState,
  note: string | undefined,
  auto: boolean,
  session: Parameters<Parameters<typeof withTransaction>[0]>[0],
) {
  const now = new Date();
  const set: Record<string, unknown> = {
    state: to,
    lastActivityAt: now,
    lastActivityByUserId: req.auth.user._id,
  };
  if (to === 'resolved') set.resolvedAt = now;
  if (to === 'closed') set.closedAt = now;
  const r = await Discussion.updateOne({ _id: d._id, state: from }, { $set: set }, { session });
  if (!r.modifiedCount) throw conflict('تغيّرت حالة النقاش في الوقت نفسه، حدّث الصفحة');
  await DiscussionEntry.create(
    [
      {
        discussionId: d._id,
        kind: 'state',
        body: note,
        fromState: from,
        toState: to,
        auto,
        authorUserId: req.auth.user._id,
        authorName: req.auth.user.displayNameAr,
        authorDepartmentId: req.auth.user.departmentId,
        at: now,
      },
    ],
    { session, ordered: true },
  );
  await recordAudit(
    actorFrom(req),
    {
      action: 'update',
      resource: 'discussions',
      resourceId: String(d._id),
      before: { state: from },
      after: { state: to, note, auto },
    },
    session,
  );
}

/** «تسجيل ردود الأقسام والإجراءات المتخذة» [SAL §10.3]. */
export async function addMessage(req: AuthedRequest, id: string, body: string, attachmentIds: string[]) {
  const { d, sides } = await load(req, id);
  if (d.state === 'closed') throw conflict('النقاش مغلق؛ سجله محفوظ للاطلاع فقط');
  if (!sides.requester && !sides.handler) throw forbidden('الاطلاع فقط');
  const now = new Date();
  // The handling department's first answer moves a new discussion to «قيد المعالجة»; the requester's answer to a
  // question moves «بانتظار الرد» back to «قيد المعالجة». Both are recorded as automatic state entries.
  const auto: DiscussionState | null =
    sides.handler && d.state === 'new'
      ? 'in_progress'
      : sides.requester && !sides.handler && d.state === 'awaiting_reply'
        ? 'in_progress'
        : null;
  const entry = await withTransaction(async (session) => {
    const r = await Discussion.updateOne(
      { _id: d._id, state: { $ne: 'closed' } },
      { $set: { lastActivityAt: now, lastActivityByUserId: req.auth.user._id } },
      { session },
    );
    if (!r.matchedCount) throw conflict('أُغلق النقاش في الوقت نفسه');
    await claimAttachments(attachmentIds, 'discussion', String(d._id), req.auth.user._id, session);
    const [e] = await DiscussionEntry.create(
      [
        {
          discussionId: d._id,
          kind: 'message',
          body,
          attachmentIds,
          authorUserId: req.auth.user._id,
          authorName: req.auth.user.displayNameAr,
          authorDepartmentId: req.auth.user.departmentId,
          at: now,
        },
      ],
      { session, ordered: true },
    );
    await recordAudit(
      actorFrom(req),
      {
        action: 'create',
        resource: 'discussions.entries',
        resourceId: String(e._id),
        after: { discussionId: String(d._id), attachments: attachmentIds.length },
      },
      session,
    );
    if (auto) await changeState(req, d, d.state as DiscussionState, auto, undefined, true, session);
    return e.toObject();
  });
  await notify({
    userIds: await recipients(d, String(req.auth.user._id)),
    type: 'discussion.replied',
    bodyAr: `${d.number} — ${req.auth.user.displayNameAr}: ${body.slice(0, 120)}`,
    link: `/discussions/${d._id}`,
  });
  return entry;
}

export async function setState(req: AuthedRequest, id: string, to: DiscussionState, note?: string) {
  const { d, sides } = await load(req, id);
  const from = d.state as DiscussionState;
  if (!allowedNext(d, sides).includes(to))
    throw badRequest(`لا يمكن الانتقال من «${DISCUSSION_STATE_AR[from]}» إلى «${DISCUSSION_STATE_AR[to]}»`);
  // The action taken, a reopening and a withdrawal are written down [SAL §10.3 «الإجراءات المتخذة»].
  const needsNote =
    to === 'resolved' ||
    (from === 'resolved' && to === 'in_progress') ||
    (to === 'closed' && from !== 'resolved');
  if (needsNote && !note?.trim())
    throw badRequest(
      to === 'resolved'
        ? 'اذكر الإجراء الذي اتُّخذ'
        : to === 'closed'
          ? 'اذكر سبب الإغلاق'
          : 'اذكر سبب إعادة الفتح',
      [{ path: 'note', message: 'مطلوب' }],
    );
  await withTransaction((session) => changeState(req, d, from, to, note?.trim(), false, session));
  await notify({
    userIds: await recipients(d, String(req.auth.user._id)),
    type: 'discussion.state_changed',
    bodyAr: `${d.number} — ${DISCUSSION_STATE_AR[to]}${note ? `: ${note.slice(0, 120)}` : ''}`,
    link: `/discussions/${d._id}`,
  });
  return getDiscussion(req, id);
}

/** «إضافة الموظفين المعنيين» [SAL §10.3]: at opening and later, by either side while the discussion is open. */
export async function addParticipants(req: AuthedRequest, id: string, userIds: string[]) {
  const { d, sides } = await load(req, id);
  if (d.state === 'closed') throw conflict('النقاش مغلق');
  if (!sides.requester && !sides.handler) throw forbidden('الاطلاع فقط');
  const existing = new Set(d.participantUserIds.map(String));
  const added = [...new Set(userIds)].filter((u) => !existing.has(u) && u !== String(d.openedByUserId));
  if (!added.length) throw badRequest('الموظفون مضافون مسبقًا');
  await assertActiveUsers(added);
  await withTransaction(async (session) => {
    await Discussion.updateOne(
      { _id: d._id },
      { $addToSet: { participantUserIds: { $each: added.map((a) => new Types.ObjectId(a)) } } },
      { session },
    );
    await DiscussionEntry.create(
      [
        {
          discussionId: d._id,
          kind: 'participants',
          participantUserIds: added,
          authorUserId: req.auth.user._id,
          authorName: req.auth.user.displayNameAr,
          authorDepartmentId: req.auth.user.departmentId,
          at: new Date(),
        },
      ],
      { session, ordered: true },
    );
    await recordAudit(
      actorFrom(req),
      {
        action: 'update',
        resource: 'discussions',
        resourceId: String(d._id),
        after: { addedParticipants: added },
      },
      session,
    );
  });
  await notify({
    userIds: added,
    type: 'discussion.opened',
    bodyAr: `${d.number} — ${d.title} — أضافك ${req.auth.user.displayNameAr}`,
    link: `/discussions/${d._id}`,
  });
  return getDiscussion(req, id);
}
