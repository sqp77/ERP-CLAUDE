import type { FilterQuery } from 'mongoose';
import {
  OPEN_TICKET_STATES,
  TICKET_TARGET_CODES,
  type CreateTicketInput,
  type RoleAssignment,
  type TicketDepartmentConfig,
  type TicketTransitionInput,
} from '@eayni/shared';
import { badRequest, forbidden, notFound } from '../../core/http/errors';
import { actorFrom, type Actor, type Authz, type AuthedRequest } from '../../core/http/context';
import { recordAudit } from '../../core/audit/service';
import { nextNumber } from '../../core/numbering/service';
import { notify } from '../../core/notifications/service';
import { publish } from '../../core/outbox/service';
import { getSetting } from '../../core/settings/service';
import { applyTransition, availableTransitions, getWorkflow, initWorkflow } from '../../core/workflow/engine';
import { WorkflowDef } from '../../core/workflow/model';
import { effectivePermission } from '../../core/rbac/service';
import { claimAttachments } from '../../core/files/service';
import { withTransaction } from '../../db';
import { Department } from '../../core/org/model';
import type { UserDoc } from '../../core/auth/model';
import { departmentManagerUserIds } from '../../core/tasks/jobs';
import { assertAssignable } from '../../core/tasks/service';
import { Employee } from '../hr/model';
import { Ticket, TicketAction, type TicketDoc } from './model';

// ------------------------------------------------------------------------------------------------
// Targets and department config
// ------------------------------------------------------------------------------------------------
export interface TicketTarget {
  code: string;
  departmentId: string;
  nameAr: string;
  managersOnly: boolean;
  config: TicketDepartmentConfig;
}

/** Departments a user may address [EP §9.1]: hidden targets removed; managers-only ones need a department_manager role. */
export async function targetsFor(user: UserDoc): Promise<TicketTarget[]> {
  const [hidden, managersOnly, config] = await Promise.all([
    getSetting('tickets.hiddenTargets'),
    getSetting('tickets.managersOnlyTargets'),
    getSetting('tickets.departmentFields'),
  ]);
  const isManager = user.roles.some((r) => r.role === 'department_manager');
  const depts = await Department.find({ code: { $in: TICKET_TARGET_CODES }, active: { $ne: false } })
    .select('code nameAr')
    .lean();
  return depts
    .filter((d) => !hidden.includes(d.code) && (isManager || !managersOnly.includes(d.code)))
    .map((d) => ({
      code: d.code,
      departmentId: String(d._id),
      nameAr: d.nameAr,
      managersOnly: managersOnly.includes(d.code),
      config: normalizeConfig(config[d.code]),
    }))
    .sort((a, b) => TICKET_TARGET_CODES.indexOf(a.code as never) - TICKET_TARGET_CODES.indexOf(b.code as never));
}

function normalizeConfig(c?: { fields?: unknown[]; priorityLabelsAr?: Record<string, string> }): TicketDepartmentConfig {
  const fields = ((c?.fields ?? []) as TicketDepartmentConfig['fields']).map((f) => ({ ...f, required: !!f.required }));
  return { fields, priorityLabelsAr: c?.priorityLabelsAr as TicketDepartmentConfig['priorityLabelsAr'] };
}

function validateFields(config: TicketDepartmentConfig, values: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  const issues: { path: string; message: string }[] = [];
  for (const f of config.fields) {
    const v = values[f.key];
    const empty = v === undefined || v === null || v === '';
    if (f.required && empty) issues.push({ path: `fields.${f.key}`, message: `${f.labelAr} مطلوب` });
    if (!empty) {
      if (f.type === 'select' && !f.options?.some((o) => o.value === String(v)))
        issues.push({ path: `fields.${f.key}`, message: `قيمة غير صالحة لـ ${f.labelAr}` });
      out[f.key] = v;
    }
  }
  if (issues.length) throw badRequest('بيانات التذكرة غير مكتملة', issues);
  return out;
}

async function workflowTypeFor(departmentCode: string): Promise<string> {
  const candidate = `ticket_${departmentCode}`;
  return (await WorkflowDef.exists({ type: candidate })) ? candidate : 'ticket';
}

function pendingFor(state: string, ticket: { assigneeId?: unknown }): string | null {
  switch (state) {
    case 'new':
    case 'under_review':
    case 'reopened':
      return ticket.assigneeId ? 'assignee' : 'department';
    case 'in_progress':
    case 'stalled':
      return 'assignee';
    case 'waiting_requester':
    case 'resolved':
    case 'awaiting_confirmation':
      return 'requester';
    default:
      return null;
  }
}

// ------------------------------------------------------------------------------------------------
// Create
// ------------------------------------------------------------------------------------------------
export async function createTicket(req: AuthedRequest, input: CreateTicketInput): Promise<TicketDoc> {
  const user = req.auth.user;
  const target = (await targetsFor(user)).find((t) => t.code === input.departmentCode);
  if (!target) throw badRequest('القسم المختار غير متاح لاستقبال التذاكر');
  const fields = validateFields(target.config, input.fields);
  const employee = await Employee.findOne({ userId: user._id, deletedAt: null })
    .select('fullNameAr employeeNumber departmentId')
    .lean();
  const workflowType = await workflowTypeFor(target.code);
  const def = await getWorkflow(workflowType);
  const wf = await initWorkflow(def);
  const ticket = await Ticket.create({
    number: await nextNumber('ticket'),
    requesterUserId: user._id,
    requesterEmployeeId: employee?._id,
    requester: {
      fullNameAr: employee?.fullNameAr ?? user.displayNameAr,
      employeeNumber: employee?.employeeNumber,
      departmentId: employee?.departmentId ?? user.departmentId,
    },
    departmentId: target.departmentId,
    departmentCode: target.code,
    workflowType,
    type: input.type,
    subject: input.subject,
    body: input.body,
    priority: input.priority,
    fields,
    attachmentIds: input.attachmentIds,
    ...wf,
    pendingWith: 'department',
    lastActivityAt: new Date(),
  });
  if (input.attachmentIds.length) await claimAttachments(input.attachmentIds, 'ticket', String(ticket._id), user._id);
  const actor = actorFrom(req);
  await TicketAction.create({ ticketId: ticket._id, action: 'created', toState: 'new', actorUserId: actor.userId, actorEmail: actor.email, actorRelation: 'requester' });
  await recordAudit(actor, { action: 'create', resource: 'tickets', resourceId: String(ticket._id), after: { number: ticket.number, departmentCode: target.code, type: ticket.type } });
  await publish({ type: 'ticket.created', aggregateType: 'ticket', aggregateId: String(ticket._id), payload: { number: ticket.number, departmentCode: target.code }, actorUserId: actor.userId });
  // Stage 2 [EP §9.4]: the receiving department's managers are told.
  const managers = await departmentManagerUserIds(target.departmentId);
  await notify({
    userIds: managers,
    type: 'ticket.created',
    bodyAr: `${ticket.number} — ${ticket.subject} (${ticket.requester?.fullNameAr ?? ''})`,
    link: `/tickets/${ticket._id}`,
    data: { ticketId: String(ticket._id) },
  });
  return ticket;
}

// ------------------------------------------------------------------------------------------------
// Relations, visibility, actions
// ------------------------------------------------------------------------------------------------
async function managesDepartment(user: UserDoc, departmentId: string): Promise<boolean> {
  const eff = await effectivePermission(
    user.roles as RoleAssignment[],
    user.departmentId ? String(user.departmentId) : undefined,
    'tickets',
    'edit',
    String(user._id),
  );
  if (!eff) return false;
  if (eff.scope === 'all') return true;
  return eff.scope === 'department' && eff.departmentIds.includes(departmentId);
}

/** The requester is only ever the requester (no self-handling); managers of the target department and the assignee act. */
export async function relationsFor(user: UserDoc, ticket: TicketDoc): Promise<string[]> {
  const uid = String(user._id);
  if (String(ticket.requesterUserId) === uid) return ['requester'];
  const rel = new Set<string>();
  if (ticket.assigneeId && String(ticket.assigneeId) === uid) rel.add('assignee');
  if (await managesDepartment(user, String(ticket.departmentId))) rel.add('department_manager');
  return [...rel];
}

export async function visibilityFilter(user: UserDoc, authz: Authz): Promise<FilterQuery<unknown>> {
  if (authz.scope === 'all') return {};
  const own = [{ requesterUserId: user._id }, { assigneeId: user._id }];
  if (authz.scope === 'department') return { $or: [...own, { departmentId: { $in: authz.departmentIds } }] };
  return { $or: own };
}

export async function availableActions(user: UserDoc, ticket: TicketDoc): Promise<string[]> {
  const def = await getWorkflow(ticket.workflowType);
  const rel = await relationsFor(user, ticket);
  const codes = availableTransitions(def, ticket.state, rel).map((t) => t.code).filter((c) => c !== 'ask_confirmation');
  if (codes.includes('reopen') && !(await mayReopen(ticket))) return codes.filter((c) => c !== 'reopen');
  return codes;
}

async function mayReopen(ticket: TicketDoc): Promise<boolean> {
  if (ticket.state !== 'closed') return true;
  const days = await getSetting('tickets.reopenWithinDays');
  return !!ticket.closedAt && Date.now() - ticket.closedAt.getTime() <= days * 86_400_000;
}

// ------------------------------------------------------------------------------------------------
// Transition (conditional update + transaction, DECISIONS §14.B / §15 follow-up 4)
// ------------------------------------------------------------------------------------------------
export interface TransitionOpts {
  user?: UserDoc;
  actor: Actor;
  relations: string[];
  input: Omit<TicketTransitionInput, 'transition'>;
}

export async function transition(ticket: TicketDoc, code: string, opts: TransitionOpts): Promise<TicketDoc> {
  const def = await getWorkflow(ticket.workflowType);
  const fromState = ticket.state;
  const now = new Date();
  const { input } = opts;
  // Authorization first (who may fire this transition from this state), then input checks.
  const t = def.transitions.find((x) => x.code === code);
  if (!t || !t.from.includes(fromState)) throw badRequest('لا يمكن تنفيذ هذا الإجراء في حالة التذكرة الحالية');
  if (!(t.allow.includes('*') || t.allow.some((a) => opts.relations.includes(a))))
    throw forbidden(`ليست لديك صلاحية تنفيذ "${t.labelAr}"`);
  if (code === 'reopen' && !(await mayReopen(ticket))) throw badRequest('انتهت مهلة إعادة فتح التذكرة');
  if (code === 'assign') {
    if (!input.assigneeId) throw badRequest('حدّد الموظف المكلّف');
    if (ticket.assigneeId && String(ticket.assigneeId) === input.assigneeId) throw badRequest('التذكرة مسندة لهذا الموظف أصلًا');
  }
  if (code === 'resolve' && !input.resolution?.trim()) throw badRequest('اكتب ملخص الحل');
  if (code === 'close' && !opts.actor.system && !input.rating) throw badRequest('قيّم الخدمة قبل الإغلاق');
  const set: Record<string, unknown> = { lastActivityAt: now };
  const unset: Record<string, unknown> = {};
  if (code === 'assign') set.assigneeId = input.assigneeId;
  if (code === 'resolve') {
    set.resolution = input.resolution;
    set.resolvedAt = now;
    unset.confirmReminderSentAt = 1;
  }
  if (code === 'close' && input.rating) set.rating = { ...input.rating, at: now };
  if (code === 'close' && opts.actor.system) set.autoClosed = true;
  if (code === 'reopen') set.$incReopen = true;
  const payload = { assigneeId: set.assigneeId ?? ticket.assigneeId, resolution: set.resolution ?? ticket.resolution };

  const updated = await withTransaction(async (session) => {
    if (input.attachmentIds?.length && opts.user)
      await claimAttachments(input.attachmentIds, 'ticket', String(ticket._id), opts.user._id, session);
    let doc: TicketDoc | null = null;
    const result = await applyTransition({
      def,
      record: ticket.toObject() as never,
      recordType: 'ticket',
      transition: code,
      actor: opts.actor,
      actorRelations: opts.relations,
      payload,
      reason: input.reason,
      departmentId: String(ticket.departmentId),
      now,
      session,
      persist: async (fields) => {
        const $set: Record<string, unknown> = { ...fields, ...set };
        delete $set.$incReopen;
        $set.pendingWith = pendingFor(fields.state, { assigneeId: $set.assigneeId ?? ticket.assigneeId });
        if (fields.state === 'in_progress' && !ticket.processingStartedAt) $set.processingStartedAt = now; // IT §7.1
        if (input.attachmentIds?.length) $set.attachmentIds = [...new Set([...ticket.attachmentIds.map(String), ...input.attachmentIds])];
        const update: Record<string, unknown> = { $set };
        if (Object.keys(unset).length) update.$unset = unset;
        if (set.$incReopen) update.$inc = { reopenCount: 1 };
        doc = await Ticket.findOneAndUpdate({ _id: ticket._id, state: fromState, deletedAt: null }, update, { new: true, session });
        return !!doc;
      },
    });
    const d = doc! as TicketDoc;
    await TicketAction.create(
      [
        {
          ticketId: d._id,
          action: code,
          fromState,
          toState: result.to,
          actorUserId: opts.actor.userId,
          actorEmail: opts.actor.email,
          actorRelation: opts.relations[0],
          note: input.reason ?? input.note ?? input.resolution ?? input.rating?.comment,
          data: {
            assigneeId: set.assigneeId,
            rating: input.rating?.score,
            attachments: input.attachmentIds?.length,
          },
        },
      ],
      { session },
    );
    await recordAudit(
      opts.actor,
      { action: 'transition', resource: 'tickets', resourceId: String(d._id), before: { state: fromState }, after: { state: result.to }, meta: { transition: code } },
      session,
    );
    await publish(
      { type: `ticket.${result.to}`, aggregateType: 'ticket', aggregateId: String(d._id), payload: { number: d.number, from: fromState, transition: code }, actorUserId: opts.actor.userId },
      session,
    );
    return d;
  });
  await notifyAfter(updated, code, opts);
  return updated;
}

async function notifyAfter(t: TicketDoc, code: string, opts: TransitionOpts) {
  const link = `/tickets/${t._id}`;
  const label = `${t.number} — ${t.subject}`;
  const requester = String(t.requesterUserId);
  const assignee = t.assigneeId ? String(t.assigneeId) : undefined;
  const actor = opts.actor.userId;
  const others = (ids: (string | undefined)[]) => [...new Set(ids.filter((x): x is string => !!x && x !== actor))];
  switch (code) {
    case 'assign':
      await notify({ userIds: others([assignee]), type: 'ticket.assigned', bodyAr: label, link });
      await notify({ userIds: others([requester]), type: 'ticket.updated', bodyAr: `${label}: قيد المعالجة`, link });
      break;
    case 'request_info':
      await notify({ userIds: others([requester]), type: 'ticket.info_requested', bodyAr: `${label}: ${opts.input.reason ?? ''}`, link });
      break;
    case 'provide_info':
      await notify({ userIds: others([assignee]), type: 'ticket.updated', bodyAr: `${label}: زوّد مقدم الطلب المعلومات`, link });
      break;
    case 'resolve':
      await notify({ userIds: others([requester]), type: 'ticket.resolved', bodyAr: `${label}: ${t.resolution ?? ''}`, link });
      break;
    case 'close':
      await notify({
        userIds: opts.actor.system ? [requester] : others([assignee]),
        type: opts.actor.system ? 'ticket.auto_closed' : 'ticket.closed',
        bodyAr: label,
        link,
      });
      if (opts.actor.system && assignee) await notify({ userIds: [assignee], type: 'ticket.closed', bodyAr: label, link });
      break;
    case 'reopen': {
      const managers = await departmentManagerUserIds(String(t.departmentId));
      await notify({ userIds: others([assignee, ...managers]), type: 'ticket.reopened', bodyAr: `${label}: ${opts.input.reason ?? ''}`, link });
      break;
    }
    case 'stall':
    case 'resume':
    case 'review':
    case 'start':
      await notify({ userIds: others([requester]), type: 'ticket.updated', bodyAr: label, link });
      break;
  }
}

/** The department manager assigns a member of their department / team (same rule as tasks, EP §16). */
export async function assignByManager(req: AuthedRequest, ticket: TicketDoc, assigneeId: string, note?: string) {
  await assertAssignable(req, assigneeId);
  return transition(ticket, 'assign', {
    user: req.auth.user,
    actor: actorFrom(req),
    relations: await relationsFor(req.auth.user, ticket),
    input: { assigneeId, note },
  });
}

export async function history(ticketId: string) {
  return TicketAction.find({ ticketId }).sort({ at: 1 }).lean();
}

export async function findVisible(req: AuthedRequest, id: string): Promise<TicketDoc> {
  const filter = await visibilityFilter(req.auth.user, req.authz!);
  const t = await Ticket.findOne({ _id: id, deletedAt: null, ...filter });
  if (!t) throw notFound('التذكرة غير موجودة');
  return t;
}

/** Open tickets per assignee (team page). */
export async function openTicketCounts(userIds: unknown[]): Promise<Map<string, number>> {
  const docs = await Ticket.find({ assigneeId: { $in: userIds }, deletedAt: null, state: { $in: [...OPEN_TICKET_STATES] } })
    .select('assigneeId')
    .lean();
  const m = new Map<string, number>();
  for (const d of docs) m.set(String(d.assigneeId), (m.get(String(d.assigneeId)) ?? 0) + 1);
  return m;
}

