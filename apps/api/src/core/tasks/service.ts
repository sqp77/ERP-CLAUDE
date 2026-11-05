import type { FilterQuery } from 'mongoose';
import { OPEN_TASK_STATUSES, type CreateTaskInput, type TaskStatus } from '@eayni/shared';
import { badRequest, forbidden, notFound } from '../http/errors';
import { actorFrom, type Actor, type AuthedRequest } from '../http/context';
import { recordAudit } from '../audit/service';
import { nextNumber } from '../numbering/service';
import { notify } from '../notifications/service';
import { publish } from '../outbox/service';
import { scopeFilter } from '../rbac/scope';
import { effectivePermission } from '../rbac/service';
import { registerRecordAccess } from '../access/registry';
import { claimAttachments } from '../files/service';
import type { RoleAssignment } from '@eayni/shared';
import { Task, TaskEvent, type TaskDoc } from './model';

export const TASK_SCOPE_FIELDS = {
  ownerFields: ['assigneeId', 'assignerId'],
  departmentField: 'departmentId',
};

// ------------------------------------------------------------------------------------------------
// Who can be assigned what. The employee record lives in the HR module; HR registers the directory.
// Default (before HR registers, e.g. core-only tests): the user account itself.
// ------------------------------------------------------------------------------------------------
export interface AssigneeInfo {
  userId: string;
  employeeId?: string;
  fullNameAr?: string;
  departmentId?: string;
  /** User id of the direct manager (org chart). */
  managerUserId?: string;
  /** On duty: may receive work. */
  active: boolean;
}
export interface AssigneeDirectory {
  lookup(userId: string): Promise<AssigneeInfo | null>;
}
let directory: AssigneeDirectory = {
  async lookup(userId) {
    const { User } = await import('../auth/model');
    const u = await User.findById(userId).select('departmentId status displayNameAr').lean();
    if (!u) return null;
    return {
      userId,
      fullNameAr: u.displayNameAr,
      departmentId: u.departmentId ? String(u.departmentId) : undefined,
      active: u.status === 'active',
    };
  },
};
export function registerAssigneeDirectory(d: AssigneeDirectory): void {
  directory = d;
}

/** Source records a task may link to; the owning module registers a resolver (number or id → id + label). */
export type SourceResolver = (idOrNumber: string) => Promise<{ id: string; label: string } | null>;
const sourceResolvers = new Map<string, SourceResolver>();
export function registerTaskSourceResolver(type: string, fn: SourceResolver): void {
  sourceResolvers.set(type, fn);
}

/**
 * The assignee must be an active employee in a department the actor manages, or one of the actor's
 * direct reports (EP §16). 'all' scope (HR, admin…) may assign anyone; self-assignment is always fine.
 */
export async function assertAssignable(req: AuthedRequest, assigneeUserId: string): Promise<AssigneeInfo> {
  const info = await directory.lookup(assigneeUserId);
  if (!info || !info.active) throw badRequest('المكلّف ليس موظفًا على رأس العمل');
  const actor = String(req.auth.user._id);
  if (assigneeUserId === actor) return info;
  const scope = req.authz?.scope ?? 'own';
  if (scope === 'all') return info;
  const isReport = info.managerUserId === actor;
  const inDept = !!info.departmentId && (req.authz?.departmentIds ?? []).includes(info.departmentId);
  if (scope === 'department' && (inDept || isReport)) return info;
  if (scope === 'team' && isReport) return info;
  throw forbidden('لا يمكنك إسناد مهام خارج قسمك أو فريقك', 'assignee_out_of_scope');
}

function assertDepartmentManaged(req: AuthedRequest, departmentId: string): void {
  const scope = req.authz?.scope ?? 'own';
  if (scope === 'all') return;
  if (scope === 'department' && (req.authz?.departmentIds ?? []).includes(departmentId)) return;
  throw forbidden('لا يمكنك وضع مهام في قائمة قسم لا تديره', 'department_out_of_scope');
}

async function logEvent(
  task: TaskDoc & { _id: unknown },
  type: string,
  actor: Actor,
  data: Partial<{
    fromStatus: string;
    toStatus: string;
    fromAssigneeId: unknown;
    toAssigneeId: unknown;
    note: string;
  }> = {},
) {
  await TaskEvent.create({
    taskId: task._id,
    type,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    ...data,
  });
}

const link = (task: { _id: unknown }) => `/tasks/${task._id}`;
const label = (task: { number: string; title: string }) => `${task.number}: ${task.title}`;

export async function createTask(req: AuthedRequest, body: CreateTaskInput) {
  const actor = actorFrom(req);
  let departmentId: string | undefined;
  if (body.assigneeId) {
    const info = await assertAssignable(req, body.assigneeId);
    departmentId =
      info.departmentId ?? (req.auth.user.departmentId ? String(req.auth.user.departmentId) : undefined);
  } else {
    departmentId =
      body.departmentId ?? (req.auth.user.departmentId ? String(req.auth.user.departmentId) : undefined);
    if (!departmentId) throw badRequest('حدّد القسم الذي تُوضع المهمة في قائمته');
    assertDepartmentManaged(req, departmentId);
  }
  if (!departmentId) throw badRequest('تعذر تحديد قسم المهمة');
  let source: { type: string; id: string; label?: string } | undefined;
  if (body.source) {
    const resolve = sourceResolvers.get(body.source.type);
    const found = resolve ? await resolve(body.source.id) : null;
    if (!found) throw badRequest('السجل المرتبط غير موجود');
    source = { type: body.source.type, ...found };
  }
  const task = await Task.create({
    title: body.title,
    description: body.description,
    priority: body.priority,
    startAt: body.startAt,
    dueAt: body.dueAt,
    attachmentIds: body.attachmentIds,
    source,
    number: await nextNumber('task'),
    assignerId: req.auth.user._id,
    assigneeId: body.assigneeId,
    departmentId, // never from the client when an assignee exists (EP §16)
  });
  if (body.attachmentIds.length)
    await claimAttachments(body.attachmentIds, 'task', String(task._id), req.auth.user._id);
  await logEvent(task, 'created', actor, { toStatus: 'new', toAssigneeId: task.assigneeId });
  await recordAudit(actor, {
    action: 'create',
    resource: 'tasks',
    resourceId: String(task._id),
    after: task,
  });
  await publish({
    type: 'core.task.created',
    aggregateType: 'task',
    aggregateId: String(task._id),
    payload: { assigneeId: body.assigneeId ?? null, departmentId },
    actorUserId: actor.userId,
  });
  if (body.assigneeId && body.assigneeId !== actor.userId)
    await notify({
      userIds: [body.assigneeId],
      type: 'task.assigned',
      bodyAr: label(task),
      link: link(task),
      data: { taskId: String(task._id) },
    });
  return task;
}

/** Assign a queued task, or move it to another employee with a reason; both sides are told [EP §16]. */
export async function assignTask(
  req: AuthedRequest,
  task: InstanceType<typeof Task>,
  assigneeId: string,
  reason?: string,
) {
  const actor = actorFrom(req);
  if (!(OPEN_TASK_STATUSES as readonly string[]).includes(task.status))
    throw badRequest('لا يمكن إسناد مهمة مغلقة');
  const previous = task.assigneeId ? String(task.assigneeId) : undefined;
  if (previous === assigneeId) throw badRequest('المهمة مسندة لهذا الموظف أصلًا');
  if (previous && !reason?.trim()) throw badRequest('سبب إعادة الإسناد مطلوب');
  await assertAssignable(req, assigneeId);
  const before = task.toObject();
  task.assigneeId = assigneeId as never;
  if (task.status === 'waiting_review') task.status = 'in_progress';
  await task.save();
  await logEvent(task, previous ? 'reassigned' : 'assigned', actor, {
    fromAssigneeId: previous,
    toAssigneeId: assigneeId,
    note: reason,
  });
  await recordAudit(actor, {
    action: 'update',
    resource: 'tasks',
    resourceId: String(task._id),
    before,
    after: task,
    meta: { reassign: !!previous, reason },
  });
  if (assigneeId !== actor.userId)
    await notify({ userIds: [assigneeId], type: 'task.assigned', bodyAr: label(task), link: link(task) });
  if (previous && previous !== actor.userId)
    await notify({
      userIds: [previous],
      type: 'task.reassigned',
      bodyAr: `${label(task)} — ${reason ?? ''}`,
      link: link(task),
    });
  return task;
}

/**
 * Status moves. The assignee's "done" becomes waiting_review when someone else assigned the task;
 * the assigner approves (done) or returns it (in_progress) through reviewTask [EP §16].
 */
export async function changeStatus(
  req: AuthedRequest,
  task: InstanceType<typeof Task>,
  next: TaskStatus,
  progress?: number,
) {
  const actor = actorFrom(req);
  const me = String(req.auth.user._id);
  const isAssignee = !!task.assigneeId && String(task.assigneeId) === me;
  const isAssigner = String(task.assignerId) === me;
  const from = task.status as TaskStatus;
  if (from === next && progress === undefined) return task;
  if (next === 'cancelled' && !isAssigner && req.authz?.scope === 'own')
    throw forbidden('إلغاء المهمة من صلاحية من أسندها');
  if (next === 'waiting_review' || next === 'late') throw badRequest('هذه الحالة يحددها النظام');
  if (!(OPEN_TASK_STATUSES as readonly string[]).includes(from) && next !== 'in_progress')
    throw badRequest('المهمة مغلقة');
  let to: TaskStatus = next;
  let event = 'status_changed';
  if (next === 'done' && isAssignee && !isAssigner) {
    to = 'waiting_review';
    event = 'review_requested';
  }
  const before = task.toObject();
  task.status = to;
  if (progress !== undefined) task.progressPercent = progress;
  if (to === 'done') {
    task.completedAt = new Date();
    task.progressPercent = 100;
  }
  if (to === 'in_progress' && !task.startAt) task.startAt = new Date();
  await task.save();
  await logEvent(task, next === 'cancelled' ? 'cancelled' : event, actor, { fromStatus: from, toStatus: to });
  await recordAudit(actor, {
    action: 'update',
    resource: 'tasks',
    resourceId: String(task._id),
    before,
    after: task,
  });
  if (to === 'waiting_review')
    await notify({
      userIds: [String(task.assignerId)],
      type: 'task.review_requested',
      bodyAr: label(task),
      link: link(task),
    });
  else if (task.assigneeId && String(task.assigneeId) !== me && (to === 'done' || to === 'cancelled'))
    await notify({
      userIds: [String(task.assigneeId)],
      type: 'task.approved',
      bodyAr: label(task),
      link: link(task),
    });
  return task;
}

export async function reviewTask(
  req: AuthedRequest,
  task: InstanceType<typeof Task>,
  approve: boolean,
  note?: string,
) {
  const actor = actorFrom(req);
  const me = String(req.auth.user._id);
  const isAssigner = String(task.assignerId) === me;
  if (!isAssigner && req.authz?.scope !== 'all' && req.authz?.scope !== 'department')
    throw forbidden('مراجعة المهمة من صلاحية من أسندها أو مدير القسم');
  if (task.status !== 'waiting_review') throw badRequest('المهمة ليست بانتظار المراجعة');
  if (!approve && !note?.trim()) throw badRequest('ملاحظة الإعادة مطلوبة');
  const before = task.toObject();
  task.status = approve ? 'done' : 'in_progress';
  if (approve) {
    task.completedAt = new Date();
    task.progressPercent = 100;
  } else task.reviewNote = note;
  await task.save();
  await logEvent(task, approve ? 'approved' : 'returned', actor, {
    fromStatus: 'waiting_review',
    toStatus: task.status,
    note,
  });
  await recordAudit(actor, {
    action: approve ? 'approve' : 'update',
    resource: 'tasks',
    resourceId: String(task._id),
    before,
    after: task,
    meta: { note },
  });
  if (task.assigneeId)
    await notify({
      userIds: [String(task.assigneeId)],
      type: approve ? 'task.approved' : 'task.returned',
      bodyAr: approve ? label(task) : `${label(task)} — ${note ?? ''}`,
      link: link(task),
    });
  return task;
}

/** Open / late counts per assignee inside the caller's scope (workload view, EP §16). */
export async function workload(req: AuthedRequest, departmentId?: string, now = new Date()) {
  const scope = await scopeFilter(req.authz!, String(req.auth.user._id), TASK_SCOPE_FIELDS);
  const match: FilterQuery<unknown> = { deletedAt: null, status: { $in: [...OPEN_TASK_STATUSES] }, ...scope };
  if (departmentId) match.departmentId = departmentId;
  const tasks = await Task.find(match).select('assigneeId status dueAt').lean();
  return summarizeWorkload(tasks, now);
}

/** Open / late per assignee; null assignee = the department queue. Late = status late or due date passed. */
export function summarizeWorkload(
  tasks: { assigneeId?: unknown; status: string; dueAt?: Date | null }[],
  now = new Date(),
) {
  const by = new Map<string, { open: number; late: number }>();
  const unassigned = { open: 0, late: 0 };
  for (const t of tasks) {
    const late = t.status === 'late' || (!!t.dueAt && new Date(t.dueAt) < now);
    const bucket = t.assigneeId ? (by.get(String(t.assigneeId)) ?? { open: 0, late: 0 }) : unassigned;
    bucket.open++;
    if (late) bucket.late++;
    if (t.assigneeId) by.set(String(t.assigneeId), bucket);
  }
  return { items: [...by.entries()].map(([userId, c]) => ({ userId, ...c })), unassigned };
}

export async function taskHistory(taskId: string) {
  return TaskEvent.find({ taskId }).sort({ at: 1 }).lean();
}

export async function findVisibleTask(req: AuthedRequest, id: string) {
  const scope = await scopeFilter(req.authz!, String(req.auth.user._id), TASK_SCOPE_FIELDS);
  const task = await Task.findOne({ _id: id, deletedAt: null, ...scope });
  if (!task) throw notFound();
  return task;
}

let registered = false;
/** Attachments on tasks follow the task's visibility. */
export function registerTaskAccess(): void {
  if (registered) return;
  registered = true;
  registerRecordAccess('task', async (req, id) => {
    const eff = await effectivePermission(
      req.auth.user.roles as RoleAssignment[],
      req.auth.user.departmentId ? String(req.auth.user.departmentId) : undefined,
      'tasks',
      'view',
      String(req.auth.user._id),
    );
    if (!eff) return false;
    const scope = await scopeFilter(
      { resource: 'tasks', action: 'view', ...eff },
      String(req.auth.user._id),
      TASK_SCOPE_FIELDS,
    );
    return !!(await Task.exists({ _id: id, deletedAt: null, ...scope }));
  });
}
