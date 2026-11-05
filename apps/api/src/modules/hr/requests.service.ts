import type { FilterQuery } from 'mongoose';
import {
  DEFAULT_HR_REQUEST_ROUTES,
  HR_REQUEST_DETAIL_SCHEMAS,
  HR_REQUEST_TYPE_AR,
  type CreateHrRequestInput,
  type HrRequestType,
} from '@eayni/shared';
import { badRequest, forbidden, notFound } from '../../core/http/errors';
import type { Actor, Authz } from '../../core/http/context';
import { recordAudit } from '../../core/audit/service';
import { nextNumber } from '../../core/numbering/service';
import { notify } from '../../core/notifications/service';
import { publish } from '../../core/outbox/service';
import { getSetting } from '../../core/settings/service';
import { applyTransition, availableTransitions, getWorkflow, initWorkflow } from '../../core/workflow/engine';
import { StageLog } from '../../core/workflow/model';
import { User, type UserDoc } from '../../core/auth/model';
import { Employee, type EmployeeDoc } from './model';
import { HrRequest, HrRequestAction, type HrRequestDoc } from './requests.model';
import { employeeOfUser, hrUserIds, registerManagerChangeHandler } from './service';
import { issueCertificate } from './certificates';
import { claimAttachments } from '../../core/files/service';

const FINANCE_ROLES = ['finance_staff', 'finance_manager'];
const HR_ROLES = ['hr_officer', 'hr_manager'];
const FINAL_ROLES = ['finance_manager', 'executive', 'hr_manager'];

/**
 * One rule for who decides "awaiting_final" (security review A7), used by relationsFor (→ UI actions)
 * and enforced again inside transition(): an advance (hr_then_finance) is decided by the Finance
 * manager or the executive only — never Finance staff or HR [FIN §12, DECISIONS §13].
 */
export function finalDeciderRoles(request: { route?: { finalApprover?: string | null } | null }): string[] {
  return request.route?.finalApprover === 'hr_then_finance' ? ['finance_manager', 'executive'] : FINAL_ROLES;
}
const FINAL_TRANSITIONS = new Set(['final_approve', 'final_reject']);
const REQUESTER_TRANSITIONS = new Set(['submit_to_manager', 'submit_to_hr']);

export function validateDetails(type: HrRequestType, details: unknown) {
  const schema = HR_REQUEST_DETAIL_SCHEMAS[type];
  const r = schema.safeParse(details);
  if (!r.success)
    throw badRequest(
      'بيانات الطلب غير مكتملة',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  return r.data as Record<string, unknown>;
}

async function routeFor(type: HrRequestType) {
  const routes = await getSetting('hr.requestRoutes');
  return routes[type] ?? DEFAULT_HR_REQUEST_ROUTES[type];
}

async function financeUserIds(): Promise<string[]> {
  const users = await User.find({ 'roles.role': { $in: FINANCE_ROLES }, status: 'active' })
    .select('_id')
    .lean();
  return users.map((u) => String(u._id));
}

/** Who must act in a given state. */
function pendingFor(
  state: string,
  request: { route?: { finalApprover?: string | null } | null },
): string | null {
  switch (state) {
    case 'awaiting_manager':
      return 'manager';
    case 'awaiting_hr':
      return 'hr';
    case 'awaiting_final':
      return request.route?.finalApprover === 'hr_then_finance' ? 'finance' : 'final';
    case 'needs_completion':
    case 'new':
      return 'requester';
    default:
      return null;
  }
}

async function logAction(
  request: HrRequestDoc,
  action: string,
  actor: Actor,
  data: { fromState?: string; toState?: string; note?: string; changes?: unknown; role?: string } = {},
) {
  await HrRequestAction.create({
    requestId: request._id,
    action,
    fromState: data.fromState,
    toState: data.toState,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    actorRole: data.role,
    note: data.note,
    changes: data.changes,
  });
}

async function notifyPending(request: HrRequestDoc, employee: EmployeeDoc) {
  const label = `${HR_REQUEST_TYPE_AR[request.type as HrRequestType]} ${request.number} — ${employee.fullNameAr}`;
  const link = `/hr/requests/${request._id}`;
  if (request.pendingWith === 'manager' && request.directManagerUserId) {
    await notify({
      userIds: [String(request.directManagerUserId)],
      type: 'ticket.created',
      titleAr: 'طلب بانتظار موافقتك',
      bodyAr: label,
      link,
    });
  } else if (request.pendingWith === 'hr') {
    await notify({
      userIds: await hrUserIds(),
      type: 'ticket.created',
      titleAr: 'طلب موظف بانتظار الموارد البشرية',
      bodyAr: label,
      link,
    });
  } else if (request.pendingWith === 'finance') {
    await notify({
      userIds: await financeUserIds(),
      type: 'ticket.created',
      titleAr: 'طلب سلفة محوّل إلى المالية',
      bodyAr: label,
      link,
    });
  } else if (request.pendingWith === 'requester') {
    await notify({
      userIds: [String(request.requesterUserId)],
      type: 'request.decided',
      titleAr: 'طلبك يحتاج استكمال',
      bodyAr: `${request.number}: ${request.decision?.reason ?? ''}`,
      link: `/me/requests/${request._id}`,
    });
  }
}

/** Direct manager at submission time (user id). */
async function managerUserIdOf(employee: EmployeeDoc): Promise<string | undefined> {
  if (!employee.directManagerId) return undefined;
  const m = await Employee.findById(employee.directManagerId).select('userId').lean();
  return m?.userId ? String(m.userId) : undefined;
}

export async function createRequest(
  user: UserDoc,
  input: CreateHrRequestInput,
  actor: Actor,
): Promise<HrRequestDoc> {
  const employee = await employeeOfUser(String(user._id));
  if (!employee) throw badRequest('لا يوجد ملف موظف مرتبط بحسابك');
  const details = validateDetails(input.type, input.details);
  const route = await routeFor(input.type);
  const def = await getWorkflow('hr_request');
  const wf = await initWorkflow(def);
  const managerUserId = await managerUserIdOf(employee);
  const flags: string[] = [];
  if (input.type === 'advance') {
    const limit = await getSetting('hr.advanceLimitHalalas');
    if (limit === null)
      flags.push('advance_limit_unset'); // DECISIONS §5: flag for HR until the limit is decided
    else if ((details.amountHalalas as number) > limit) flags.push('over_limit');
  }
  const request = await HrRequest.create({
    number: await nextNumber('hrRequest'),
    type: input.type,
    employeeId: employee._id,
    requesterUserId: user._id,
    departmentId: employee.departmentId,
    directManagerUserId: managerUserId,
    details,
    attachmentIds: input.attachmentIds,
    notes: input.notes,
    route,
    ...wf,
    pendingWith: 'requester',
    flags,
  });
  await claimAttachments(input.attachmentIds, 'hr_request', String(request._id), user._id);
  await logAction(request, 'created', actor, { toState: 'new' });
  await recordAudit(actor, {
    action: 'create',
    resource: 'hr.requests',
    resourceId: String(request._id),
    after: { number: request.number, type: request.type },
  });
  // Submit immediately along the configured route (HR §3.5 stage 1; DECISIONS §5).
  const viaManager = route.viaManager && !!managerUserId;
  if (route.viaManager && !managerUserId) flags.push('no_direct_manager');
  await transition(request, viaManager ? 'submit_to_manager' : 'submit_to_hr', {
    user,
    actor,
    relations: ['requester'],
  });
  if (flags.length) await HrRequest.updateOne({ _id: request._id }, { $set: { flags } });
  return (await HrRequest.findById(request._id))!;
}

export interface TransitionOpts {
  user: UserDoc;
  actor: Actor;
  relations: string[];
  reason?: string;
  details?: Record<string, unknown>;
  attachmentIds?: string[];
}

/**
 * Relations of a user to a request, fed to the workflow engine. The requester is only ever the
 * requester: role relations are dropped so nobody decides their own request at any stage
 * (security review A6, DECISIONS §13, FIN §12).
 */
export async function relationsFor(user: UserDoc, request: HrRequestDoc): Promise<string[]> {
  const uid = String(user._id);
  if (String(request.requesterUserId) === uid) return ['requester'];
  const rel = new Set<string>();
  if (request.directManagerUserId && String(request.directManagerUserId) === uid) rel.add('direct_manager');
  for (const r of user.roles.map((x) => x.role)) rel.add(r);
  if (request.state === 'awaiting_final') {
    const deciders = finalDeciderRoles(request);
    if (user.roles.some((x) => deciders.includes(x.role))) rel.add('approver');
  }
  return [...rel];
}

export async function transition(
  request: HrRequestDoc,
  code: string,
  opts: TransitionOpts,
): Promise<HrRequestDoc> {
  const def = await getWorkflow('hr_request');
  const employee = await Employee.findById(request.employeeId);
  if (!employee) throw notFound();
  // Requester edits on resubmission [HR §3.5 stage 3: "إعادته لاستكمال البيانات"].
  if (opts.details || opts.attachmentIds) {
    if (!opts.relations.includes('requester') || request.state !== 'needs_completion')
      throw forbidden('التعديل متاح لمقدّم الطلب عندما يكون الطلب بحاجة إلى استكمال');
    if (opts.details) request.details = validateDetails(request.type as HrRequestType, opts.details);
    if (opts.attachmentIds) {
      await claimAttachments(opts.attachmentIds, 'hr_request', String(request._id), opts.user._id);
      request.attachmentIds = opts.attachmentIds as never;
    }
  }
  // Defence in depth for the two rules the UI also applies (security review A6/A7).
  const isRequester = String(request.requesterUserId) === String(opts.user._id);
  if (isRequester && !REQUESTER_TRANSITIONS.has(code) && code !== 'resubmit')
    throw forbidden('لا يمكنك البت في طلبك (فصل المهام)');
  // The route decides where HR approval leads: directly to approved, or to Finance with the same number.
  let effective = code;
  if (code === 'hr_approve' && request.route?.finalApprover === 'hr_then_finance')
    effective = 'hr_forward_final';
  // Requester-facing synonyms.
  if (code === 'resubmit')
    effective =
      request.route?.viaManager && request.directManagerUserId ? 'submit_to_manager' : 'submit_to_hr';
  if (code === 'approve' || code === 'reject') {
    const stateMap: Record<string, [string, string]> = {
      awaiting_manager: ['manager_approve', 'manager_reject'],
      awaiting_hr: ['hr_approve', 'hr_reject'],
      awaiting_final: ['final_approve', 'final_reject'],
    };
    const pair = stateMap[request.state];
    if (!pair) throw badRequest('لا يمكن البت في الطلب في حالته الحالية');
    effective = code === 'approve' ? pair[0] : pair[1];
    if (effective === 'hr_approve' && request.route?.finalApprover === 'hr_then_finance')
      effective = 'hr_forward_final';
  }
  if (code === 'return') effective = 'hr_return';
  if (FINAL_TRANSITIONS.has(effective) && !opts.relations.includes('approver'))
    throw forbidden('الاعتماد النهائي لهذا الطلب من صلاحية مدير المالية أو الإدارة التنفيذية فقط');
  const fromState = request.state;
  const result = await applyTransition({
    def,
    record: request.toObject() as never,
    recordType: 'hr_request',
    transition: effective,
    actor: opts.actor,
    actorRelations: opts.relations,
    reason: opts.reason,
    departmentId: request.departmentId ? String(request.departmentId) : undefined,
  });
  Object.assign(request, result.fields);
  request.pendingWith = pendingFor(result.to, request) ?? undefined;
  const decided = ['approved', 'rejected', 'needs_completion'].includes(result.to);
  if (decided)
    request.decision = {
      by: opts.user._id,
      at: new Date(),
      outcome: result.to,
      reason: opts.reason,
    } as never;
  if (result.to === 'awaiting_final' && request.route?.finalApprover === 'hr_then_finance') {
    request.handoff = { department: 'finance', since: new Date(), status: 'waiting' } as never; // FIN §11: same number, same attachments
  }
  if (result.to === 'approved' && request.handoff) request.handoff.status = 'done';
  // Certificates are generated on approval [HR §3.5.4–3.5.5].
  if (
    result.to === 'approved' &&
    (request.type === 'salary_certificate' || request.type === 'experience_certificate')
  ) {
    const cert = await issueCertificate(request, employee, String(opts.user._id));
    request.certificate = {
      number: cert.number,
      attachmentId: cert.attachmentId,
      issuedAt: new Date(),
      issuedBy: opts.user._id,
    } as never;
    await recordAudit(opts.actor, {
      action: 'create',
      resource: 'hr.certificates',
      resourceId: cert.number,
      meta: { requestId: String(request._id), employeeId: String(employee._id) },
      sensitive: true,
    });
  }
  await request.save();
  await logAction(request, effective, opts.actor, {
    fromState,
    toState: result.to,
    note: opts.reason,
    changes: opts.details ? { details: opts.details } : undefined,
    role: opts.relations.find((r) =>
      [
        'requester',
        'direct_manager',
        'hr_officer',
        'hr_manager',
        'finance_manager',
        'finance_staff',
        'executive',
      ].includes(r),
    ),
  });
  await recordAudit(opts.actor, {
    action: 'transition',
    resource: 'hr.requests',
    resourceId: String(request._id),
    before: { state: fromState },
    after: { state: result.to },
    meta: { transition: effective, reason: opts.reason },
  });
  await publish({
    type: `hr.request.${result.to}`,
    aggregateType: 'hr_request',
    aggregateId: String(request._id),
    payload: { number: request.number, type: request.type, from: fromState },
    actorUserId: opts.actor.userId,
  });
  if (request.handoff?.status === 'waiting' && result.to === 'awaiting_final') {
    await publish({
      type: 'hr.request.handoff.finance',
      aggregateType: 'hr_request',
      aggregateId: String(request._id),
      payload: {
        number: request.number,
        amountHalalas: (request.details as { amountHalalas?: number }).amountHalalas,
      },
      actorUserId: opts.actor.userId,
    });
  }
  // Notifications [HR §3.5 stage 4, EP §15.8].
  if (result.to === 'approved' || result.to === 'rejected') {
    const label = HR_REQUEST_TYPE_AR[request.type as HrRequestType];
    await notify({
      userIds: [String(request.requesterUserId)],
      type: 'request.decided',
      bodyAr:
        result.to === 'approved'
          ? `تم اعتماد ${label} (${request.number})`
          : `تم رفض ${label} (${request.number}): ${opts.reason ?? ''}`,
      link: `/me/requests/${request._id}`,
    });
  } else {
    await notifyPending(request, employee);
  }
  return request;
}

export async function availableActions(user: UserDoc, request: HrRequestDoc): Promise<string[]> {
  const def = await getWorkflow('hr_request');
  const rel = await relationsFor(user, request);
  const codes = availableTransitions(def, request.state, rel).map((t) => t.code);
  const out = new Set<string>();
  for (const c of codes) {
    if (c === 'submit_to_manager' || c === 'submit_to_hr') out.add('resubmit');
    else if (c.endsWith('_approve') || c === 'hr_forward_final') out.add('approve');
    else if (c.endsWith('_reject')) out.add('reject');
    else if (c === 'hr_return') out.add('return');
    else out.add(c);
  }
  // Same rule as transition(): the final step is for the 'approver' relation only.
  if (request.state === 'awaiting_final' && !rel.includes('approver')) {
    out.delete('approve');
    out.delete('reject');
  }
  return [...out];
}

/** Visibility: own requests, requests waiting for me as direct manager, or role scope (HR/Finance/executive see all). */
export async function visibilityFilter(user: UserDoc, authz: Authz): Promise<FilterQuery<unknown>> {
  if (authz.scope === 'all') return {};
  const own = [{ requesterUserId: user._id }, { directManagerUserId: user._id }];
  if (authz.scope === 'department') return { $or: [...own, { departmentId: { $in: authz.departmentIds } }] };
  return { $or: own };
}

export async function requestHistory(id: string) {
  const [actions, stages] = await Promise.all([
    HrRequestAction.find({ requestId: id }).sort({ at: 1 }).lean(),
    StageLog.find({ recordType: 'hr_request', recordId: id }).sort({ at: 1 }).lean(),
  ]);
  return { actions, stages };
}

/** Reassign requests waiting for the old manager (DECISIONS §11.4). Returns the count moved. */
async function reassignPending(args: {
  employee: EmployeeDoc;
  fromManagerUserId?: string;
  toManagerUserId?: string;
  actor: Actor;
  reason: string;
}): Promise<number> {
  const open = await HrRequest.find({ employeeId: args.employee._id, closedAt: null, deletedAt: null });
  let moved = 0;
  for (const r of open) {
    const wasPending = r.state === 'awaiting_manager';
    r.directManagerUserId = (args.toManagerUserId ?? undefined) as never;
    await r.save();
    if (wasPending) {
      moved++;
      await StageLog.create({
        recordType: 'hr_request',
        recordId: String(r._id),
        recordNumber: r.number,
        fromState: r.state,
        toState: r.state,
        transition: 'reassigned_manager',
        actorUserId: args.actor.userId,
        actorEmail: args.actor.email,
        reason: args.reason,
        departmentId: r.departmentId ? String(r.departmentId) : undefined,
        meta: { fromManagerUserId: args.fromManagerUserId, toManagerUserId: args.toManagerUserId },
      });
      await logAction(r, 'reassigned_manager', args.actor, {
        fromState: r.state,
        toState: r.state,
        note: args.reason,
        changes: { fromManagerUserId: args.fromManagerUserId, toManagerUserId: args.toManagerUserId },
      });
    }
  }
  return moved;
}

let registered = false;
export function registerRequestHandlers(): void {
  if (registered) return;
  registered = true;
  registerManagerChangeHandler(reassignPending);
}

/** Overdue stage reminders to whoever must act [HR §3.5 SLA per DECISIONS §5]. Once per stage. */
export async function runRequestOverdueReminders(now = new Date()): Promise<number> {
  const overdue = await HrRequest.find({
    closedAt: null,
    deletedAt: null,
    dueAt: { $ne: null, $lt: now },
    $or: [{ overdueNotifiedAt: null }, { $expr: { $lt: ['$overdueNotifiedAt', '$stateEnteredAt'] } }],
  });
  let sent = 0;
  for (const r of overdue) {
    const employee = await Employee.findById(r.employeeId).select('fullNameAr').lean();
    const label = `${HR_REQUEST_TYPE_AR[r.type as HrRequestType]} ${r.number} — ${employee?.fullNameAr ?? ''} تجاوز مهلة المرحلة`;
    let ids: string[] = [];
    if (r.pendingWith === 'manager' && r.directManagerUserId) ids = [String(r.directManagerUserId)];
    else if (r.pendingWith === 'hr') ids = await hrUserIds();
    else if (r.pendingWith === 'finance') ids = await financeUserIds();
    if (ids.length) {
      await notify({
        userIds: ids,
        type: 'task.overdue',
        titleAr: 'طلب متأخر عن مهلته',
        bodyAr: label,
        link: `/hr/requests/${r._id}`,
      });
      sent++;
    }
    r.overdueNotifiedAt = now;
    await r.save();
  }
  return sent;
}

export { HR_ROLES };
