import type { FilterQuery } from 'mongoose';
import {
  EMPLOYEE_SENSITIVE_FIELDS,
  EMPLOYEE_STATUS_AR,
  type CreateEmployeeInput,
  type RoleAssignment,
  type UpdateEmployeeInput,
} from '@eayni/shared';
import type { z } from 'zod';
import type {
  changeManagerSchema,
  changeStatusSchema,
  promoteEmployeeSchema,
  transferEmployeeSchema,
} from '@eayni/shared';
import { badRequest, conflict, notFound } from '../../core/http/errors';
import type { Actor, Authz } from '../../core/http/context';
import { recordAudit } from '../../core/audit/service';
import { nextNumber } from '../../core/numbering/service';
import { notify } from '../../core/notifications/service';
import { publish } from '../../core/outbox/service';
import { User, type UserDoc } from '../../core/auth/model';
import { blindIndex, decrypt, encrypt, hashPassword, randomToken } from '../../core/auth/crypto';
import { fieldRestrictions, redact } from '../../core/rbac/service';
import { Department, Position } from '../../core/org/model';
import { Employee, EmployeeEvent, type EmployeeDoc } from './model';

export const HR_ROLE_CODES = ['hr_officer', 'hr_manager'];

/** User ids of HR staff — recipients of HR alerts. */
export async function hrUserIds(): Promise<string[]> {
  const users = await User.find({ 'roles.role': { $in: HR_ROLE_CODES }, status: 'active' })
    .select('_id')
    .lean();
  return users.map((u) => String(u._id));
}

export async function employeeOfUser(userId: string): Promise<EmployeeDoc | null> {
  return Employee.findOne({ userId, deletedAt: null });
}

/** Employee statuses that may receive work (EP §16); on leave counts, suspended / left does not. */
export const ON_DUTY_STATUSES = ['active', 'field_work', 'seconded', 'on_leave'] as const;

/** Direct reports → user ids (team scope for RBAC). */
export async function teamUserIdsOf(userId: string): Promise<string[]> {
  const me = await employeeOfUser(userId);
  if (!me) return [];
  const reports = await Employee.find({ directManagerId: me._id, deletedAt: null, userId: { $ne: null } })
    .select('userId')
    .lean();
  return reports.map((r) => String(r.userId));
}

/** One-off backfill of the identity blind index for employees created before review D22. Idempotent. */
export async function backfillIdentityHashes(): Promise<number> {
  const missing = await Employee.find({ 'identity.hash': { $in: [null, ''] }, deletedAt: null }).select(
    'identity',
  );
  let n = 0;
  for (const e of missing) {
    if (!e.identity?.numberEnc) continue;
    await Employee.updateOne(
      { _id: e._id },
      { $set: { 'identity.hash': blindIndex(decrypt(e.identity.numberEnc)) } },
    );
    n++;
  }
  return n;
}

/** Scope → employee filter. 'team' is the direct-manager chain, one level (HR §6.2). */
export async function employeeScopeFilter(authz: Authz, user: UserDoc): Promise<FilterQuery<unknown>> {
  if (authz.scope === 'all') return {};
  const own = { userId: user._id };
  if (authz.scope === 'department') return { $or: [{ departmentId: { $in: authz.departmentIds } }, own] };
  if (authz.scope === 'team') {
    const me = await employeeOfUser(String(user._id));
    return me ? { $or: [{ directManagerId: me._id }, own] } : own;
  }
  return own;
}

/** True when `user` may see the record at all (used by documents/contracts/custody access). */
export async function canAccessEmployee(authz: Authz, user: UserDoc, employeeId: string): Promise<boolean> {
  const filter = await employeeScopeFilter(authz, user);
  return !!(await Employee.exists({ _id: employeeId, deletedAt: null, ...filter }));
}

export interface SerializeOptions {
  /** Viewer is the employee themself: all own fields are visible (EP §8.2). */
  self: boolean;
  hidden: Set<string>;
}

/** Plain, redacted view of an employee: decrypts what the viewer may see, masks the rest. */
export function serializeEmployee(doc: EmployeeDoc, opts: SerializeOptions): Record<string, unknown> {
  const o = doc.toObject({ versionKey: false }) as Record<string, unknown>;
  const identity = o.identity as { numberEnc?: string; last4?: string } & Record<string, unknown>;
  const bank = o.bank as { ibanEnc?: string; ibanLast4?: string; bankName?: string } | undefined;
  const showAll = opts.self;
  const canSee = (f: string) => showAll || !opts.hidden.has(f);
  o.identity = {
    type: identity.type,
    expiryDate: identity.expiryDate,
    number: canSee('identity.number') && identity.numberEnc ? decrypt(identity.numberEnc) : undefined,
    numberMasked: identity.last4 ? `••••••${identity.last4}` : undefined,
  };
  if (bank) {
    o.bank = {
      bankName: bank.bankName,
      iban: canSee('bank') && bank.ibanEnc ? decrypt(bank.ibanEnc) : undefined,
      ibanMasked: bank.ibanLast4 ? `SA••••••••••••••••••${bank.ibanLast4}` : undefined,
    };
  }
  const out = showAll
    ? o
    : redact(o, new Set([...opts.hidden].filter((f) => f !== 'bank' && f !== 'identity.number')));
  if (!showAll && opts.hidden.has('bank') && out.bank)
    out.bank = { bankName: bank?.bankName, ibanMasked: (out.bank as { ibanMasked?: string }).ibanMasked };
  out.statusAr = EMPLOYEE_STATUS_AR[doc.status];
  return out;
}

export async function viewerRestrictions(user: UserDoc): Promise<Set<string>> {
  const { hidden } = await fieldRestrictions(user.roles as RoleAssignment[], 'hr.employees');
  return hidden;
}

/** Does this payload reveal any sensitive field? Then the view is audited (golden rule 4). */
export function revealsSensitive(serialized: Record<string, unknown>): boolean {
  const identity = serialized.identity as { number?: string } | undefined;
  const bank = serialized.bank as { iban?: string } | undefined;
  return !!(
    identity?.number ||
    bank?.iban ||
    serialized.basicSalaryHalalas !== undefined ||
    serialized.religion !== undefined
  );
}

async function logEvent(
  employeeId: unknown,
  type: string,
  actor: Actor,
  data: { from?: unknown; to?: unknown; changedFields?: string[]; effectiveDate?: Date; reason?: string },
) {
  await EmployeeEvent.create({
    employeeId,
    type,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    ...data,
  });
}

export async function createEmployee(
  input: CreateEmployeeInput,
  actor: Actor,
): Promise<{ employee: EmployeeDoc; temporaryPassword?: string }> {
  if (!(await Department.exists({ _id: input.departmentId, deletedAt: null })))
    throw badRequest('القسم غير موجود');
  if (input.positionId && !(await Position.exists({ _id: input.positionId, deletedAt: null })))
    throw badRequest('المسمى الوظيفي غير موجود');
  if (input.directManagerId && !(await Employee.exists({ _id: input.directManagerId, deletedAt: null })))
    throw badRequest('المدير المباشر غير موجود');
  if (await Employee.exists({ workEmail: input.workEmail }))
    throw conflict('البريد الوظيفي مستخدم لموظف آخر');
  if (await User.exists({ email: input.workEmail })) throw conflict('يوجد حساب مستخدم بهذا البريد');
  const employeeNumber = input.employeeNumber?.trim() || (await nextNumber('employee'));
  if (await Employee.exists({ employeeNumber })) throw conflict('الرقم الوظيفي مستخدم');

  const { identity, bank, createAccount, basicSalaryHalalas, ...rest } = input;
  const identityHash = blindIndex(identity.number);
  if (await Employee.exists({ 'identity.hash': identityHash, deletedAt: null }))
    throw conflict('رقم الهوية مسجّل لموظف آخر');
  const employee = await Employee.create({
    ...rest,
    employeeNumber,
    fullNameAr: input.fullNameAr ?? `${input.firstNameAr} ${input.lastNameAr}`,
    identity: {
      type: identity.type,
      numberEnc: encrypt(identity.number),
      hash: identityHash,
      last4: identity.number.slice(-4),
      expiryDate: identity.expiryDate,
    },
    bank: bank
      ? { bankName: bank.bankName, ibanEnc: encrypt(bank.iban.toUpperCase()), ibanLast4: bank.iban.slice(-4) }
      : undefined,
    basicSalaryHalalas,
  });

  let temporaryPassword: string | undefined;
  if (createAccount) {
    temporaryPassword = randomToken(9);
    const user = await User.create({
      email: input.workEmail,
      displayNameAr: employee.fullNameAr,
      passwordHash: await hashPassword(temporaryPassword),
      roles: [{ role: 'employee' }],
      departmentId: input.departmentId,
      employeeId: employee._id,
      mustChangePassword: true,
    });
    employee.userId = user._id;
    await employee.save();
  }
  await logEvent(employee._id, 'created', actor, {
    to: { departmentId: input.departmentId, positionId: input.positionId, status: employee.status },
    effectiveDate: input.hireDate,
  });
  await recordAudit(actor, {
    action: 'create',
    resource: 'hr.employees',
    resourceId: String(employee._id),
    after: { employeeNumber, fullNameAr: employee.fullNameAr, departmentId: input.departmentId },
    sensitive: true,
  });
  await publish({
    type: 'hr.employee.created',
    aggregateType: 'employee',
    aggregateId: String(employee._id),
    payload: { employeeNumber, departmentId: input.departmentId },
    actorUserId: actor.userId,
  });
  return { employee, temporaryPassword };
}

export async function getEmployeeOrThrow(id: string): Promise<EmployeeDoc> {
  const e = await Employee.findOne({ _id: id, deletedAt: null });
  if (!e) throw notFound('الموظف غير موجود');
  return e;
}

export async function updateEmployee(
  id: string,
  input: UpdateEmployeeInput,
  actor: Actor,
  notifyEmployee = true,
): Promise<EmployeeDoc> {
  const employee = await getEmployeeOrThrow(id);
  const before = employee.toObject();
  const { identity, bank, ...rest } = input;
  Object.assign(employee, rest);
  if (rest.firstNameAr || rest.lastNameAr)
    employee.fullNameAr = input.fullNameAr ?? `${employee.firstNameAr} ${employee.lastNameAr}`;
  if (identity) {
    const hash = blindIndex(identity.number);
    if (await Employee.exists({ 'identity.hash': hash, deletedAt: null, _id: { $ne: employee._id } }))
      throw conflict('رقم الهوية مسجّل لموظف آخر');
    employee.identity = {
      ...employee.identity,
      type: identity.type,
      numberEnc: encrypt(identity.number),
      hash,
      last4: identity.number.slice(-4),
      expiryDate: identity.expiryDate,
      alertsSent: [],
    } as typeof employee.identity;
  }
  if (bank)
    employee.bank = {
      bankName: bank.bankName,
      ibanEnc: encrypt(bank.iban.toUpperCase()),
      ibanLast4: bank.iban.slice(-4),
    };
  if (input.workEmail && input.workEmail !== before.workEmail && employee.userId) {
    await User.updateOne({ _id: employee.userId }, { $set: { email: input.workEmail } });
  }
  await employee.save();
  const changed = Object.keys(input);
  await logEvent(employee._id, 'updated', actor, { changedFields: changed });
  await recordAudit(actor, {
    action: 'update',
    resource: 'hr.employees',
    resourceId: String(employee._id),
    before: { changedFields: changed },
    after: { changedFields: changed },
    sensitive: changed.some((f) =>
      (EMPLOYEE_SENSITIVE_FIELDS as readonly string[]).some((s) => s.startsWith(f)),
    ),
  });
  if (notifyEmployee && employee.userId && actor.userId !== String(employee.userId)) {
    await notify({
      userIds: [String(employee.userId)],
      type: 'employee.data_updated',
      bodyAr: `تم تحديث: ${changed.join('، ')}`,
      link: '/me/profile',
    });
  }
  return employee;
}

async function notifyJobChange(
  employee: EmployeeDoc,
  type: 'employee.manager_or_department_changed' | 'employee.promotion',
  bodyAr: string,
) {
  const ids: string[] = [];
  if (employee.userId) ids.push(String(employee.userId));
  if (employee.directManagerId) {
    const m = await Employee.findById(employee.directManagerId).select('userId').lean();
    if (m?.userId) ids.push(String(m.userId));
  }
  await notify({ userIds: ids, type, bodyAr, link: `/hr/employees/${employee._id}` });
}

/**
 * When an employee's direct manager changes, items waiting for the old manager's action (HR requests,
 * approvals…) move to the new one. Modules register a handler; each returns how many items it moved
 * and writes its own stage-log entries. (slice 1 review, DECISIONS §11.4)
 */
export type ManagerChangeHandler = (args: {
  employee: EmployeeDoc;
  fromManagerUserId?: string;
  toManagerUserId?: string;
  actor: Actor;
  reason: string;
}) => Promise<number>;
const managerChangeHandlers: ManagerChangeHandler[] = [];
export function registerManagerChangeHandler(fn: ManagerChangeHandler): () => void {
  managerChangeHandlers.push(fn);
  return () => {
    const i = managerChangeHandlers.indexOf(fn);
    if (i >= 0) managerChangeHandlers.splice(i, 1);
  };
}

async function managerUserId(employeeId: unknown): Promise<string | undefined> {
  if (!employeeId) return undefined;
  const m = await Employee.findById(employeeId).select('userId').lean();
  return m?.userId ? String(m.userId) : undefined;
}

/** Run the reassignment handlers and notify both managers. Returns the number of moved items. */
async function onManagerChanged(
  employee: EmployeeDoc,
  fromManagerId: unknown,
  toManagerId: unknown,
  actor: Actor,
  reason: string,
): Promise<number> {
  if (String(fromManagerId ?? '') === String(toManagerId ?? '')) return 0;
  const fromUser = await managerUserId(fromManagerId);
  const toUser = await managerUserId(toManagerId);
  let moved = 0;
  for (const h of managerChangeHandlers)
    moved += await h({ employee, fromManagerUserId: fromUser, toManagerUserId: toUser, actor, reason });
  const body = moved
    ? `${employee.fullNameAr}: تم نقل ${moved} طلبًا معلّقًا إلى المدير الجديد`
    : `${employee.fullNameAr}: تغيّر المدير المباشر`;
  const ids = [fromUser, toUser].filter((x): x is string => !!x);
  if (ids.length)
    await notify({
      userIds: ids,
      type: 'employee.manager_or_department_changed',
      bodyAr: body,
      link: `/hr/employees/${employee._id}`,
    });
  await publish({
    type: 'hr.employee.manager_changed',
    aggregateType: 'employee',
    aggregateId: String(employee._id),
    payload: { fromManagerId, toManagerId, moved },
    actorUserId: actor.userId,
  });
  return moved;
}

export async function transferEmployee(
  id: string,
  input: z.infer<typeof transferEmployeeSchema>,
  actor: Actor,
): Promise<EmployeeDoc> {
  const employee = await getEmployeeOrThrow(id);
  if (!(await Department.exists({ _id: input.departmentId, deletedAt: null })))
    throw badRequest('القسم غير موجود');
  if (input.directManagerId === String(employee._id)) throw badRequest('لا يمكن أن يكون الموظف مديرًا لنفسه');
  const from = {
    departmentId: employee.departmentId,
    unitId: employee.unitId,
    branchId: employee.branchId,
    siteId: employee.siteId,
    directManagerId: employee.directManagerId,
  };
  employee.departmentId = input.departmentId as never;
  if (input.unitId !== undefined) employee.unitId = (input.unitId ?? undefined) as never;
  if (input.branchId !== undefined) employee.branchId = (input.branchId ?? undefined) as never;
  if (input.siteId !== undefined) employee.siteId = (input.siteId ?? undefined) as never;
  if (!(await Employee.exists({ _id: input.directManagerId, deletedAt: null })))
    throw badRequest('المدير المباشر غير موجود');
  employee.directManagerId = input.directManagerId as never;
  await employee.save();
  if (employee.userId)
    await User.updateOne({ _id: employee.userId }, { $set: { departmentId: input.departmentId } });
  const to = {
    departmentId: employee.departmentId,
    unitId: employee.unitId,
    branchId: employee.branchId,
    siteId: employee.siteId,
    directManagerId: employee.directManagerId,
  };
  await logEvent(employee._id, 'transfer', actor, {
    from,
    to,
    effectiveDate: input.effectiveDate,
    reason: input.reason,
  });
  await recordAudit(actor, {
    action: 'update',
    resource: 'hr.employees',
    resourceId: String(employee._id),
    before: from,
    after: to,
    meta: { transfer: true, reason: input.reason },
  });
  await publish({
    type: 'hr.employee.transferred',
    aggregateType: 'employee',
    aggregateId: String(employee._id),
    payload: { from, to },
    actorUserId: actor.userId,
  });
  if (employee.userId)
    await notify({
      userIds: [String(employee.userId)],
      type: 'employee.manager_or_department_changed',
      bodyAr: `تم نقلك اعتبارًا من ${input.effectiveDate.toISOString().slice(0, 10)}`,
      link: '/me/profile',
    });
  await onManagerChanged(employee, from.directManagerId, employee.directManagerId, actor, input.reason);
  return employee;
}

export async function promoteEmployee(
  id: string,
  input: z.infer<typeof promoteEmployeeSchema>,
  actor: Actor,
): Promise<EmployeeDoc> {
  const employee = await getEmployeeOrThrow(id);
  if (!(await Position.exists({ _id: input.positionId, deletedAt: null })))
    throw badRequest('المسمى الوظيفي غير موجود');
  const from = {
    positionId: employee.positionId,
    grade: employee.grade,
    basicSalaryHalalas: employee.basicSalaryHalalas,
  };
  employee.positionId = input.positionId as never;
  if (input.grade !== undefined) employee.grade = input.grade;
  if (input.basicSalaryHalalas !== undefined) employee.basicSalaryHalalas = input.basicSalaryHalalas;
  await employee.save();
  const to = {
    positionId: employee.positionId,
    grade: employee.grade,
    basicSalaryHalalas: employee.basicSalaryHalalas,
  };
  await logEvent(employee._id, 'promotion', actor, {
    from,
    to,
    effectiveDate: input.effectiveDate,
    reason: input.reason,
  });
  await recordAudit(actor, {
    action: 'update',
    resource: 'hr.employees',
    resourceId: String(employee._id),
    before: from,
    after: to,
    sensitive: input.basicSalaryHalalas !== undefined,
    meta: { promotion: true },
  });
  await notifyJobChange(employee, 'employee.promotion', 'تم اعتماد تغيير وظيفي في ملفك');
  return employee;
}

export async function changeManager(
  id: string,
  input: z.infer<typeof changeManagerSchema>,
  actor: Actor,
): Promise<EmployeeDoc> {
  const employee = await getEmployeeOrThrow(id);
  if (input.directManagerId === String(employee._id)) throw badRequest('لا يمكن أن يكون الموظف مديرًا لنفسه');
  if (input.directManagerId && !(await Employee.exists({ _id: input.directManagerId, deletedAt: null })))
    throw badRequest('المدير غير موجود');
  const from = { directManagerId: employee.directManagerId };
  employee.directManagerId = (input.directManagerId ?? undefined) as never;
  await employee.save();
  await logEvent(employee._id, 'manager_change', actor, {
    from,
    to: { directManagerId: employee.directManagerId },
    effectiveDate: input.effectiveDate,
    reason: input.reason,
  });
  await recordAudit(actor, {
    action: 'update',
    resource: 'hr.employees',
    resourceId: String(employee._id),
    before: from,
    after: { directManagerId: employee.directManagerId },
  });
  if (employee.userId)
    await notify({
      userIds: [String(employee.userId)],
      type: 'employee.manager_or_department_changed',
      bodyAr: 'تم تغيير مديرك المباشر',
      link: '/me/profile',
    });
  await onManagerChanged(employee, from.directManagerId, employee.directManagerId, actor, input.reason);
  return employee;
}

export async function changeStatus(
  id: string,
  input: z.infer<typeof changeStatusSchema>,
  actor: Actor,
): Promise<EmployeeDoc> {
  const employee = await getEmployeeOrThrow(id);
  if (input.status === 'seconded' && !input.secondment) throw badRequest('بيانات الانتداب مطلوبة');
  const from = { status: employee.status };
  employee.status = input.status;
  if (input.status === 'seconded' && input.secondment) {
    if (employee.secondment?.destination)
      employee.secondmentHistory.push({ ...employee.secondment } as never);
    employee.secondment = { ...input.secondment, remindersSent: [] } as typeof employee.secondment;
  }
  if (input.status === 'terminated' || input.status === 'resigned') {
    // The effective date is the last working day; the daily job disables the portal account at the end of
    // that day (DECISIONS §11.3). Until then the employee keeps normal access.
    employee.endDate = input.effectiveDate;
  } else if (from.status === 'terminated' || from.status === 'resigned') {
    employee.endDate = undefined;
    employee.accountDisabledAt = undefined;
    if (employee.userId)
      await User.updateOne(
        { _id: employee.userId, disabledReason: 'end_of_service' },
        { $set: { status: 'active' }, $unset: { disabledAt: 1, disabledReason: 1 } },
      );
  }
  await employee.save();
  await logEvent(employee._id, 'status_change', actor, {
    from,
    to: { status: input.status, secondment: input.secondment },
    effectiveDate: input.effectiveDate,
    reason: input.reason,
  });
  await recordAudit(actor, {
    action: 'update',
    resource: 'hr.employees',
    resourceId: String(employee._id),
    before: from,
    after: { status: input.status },
  });
  await publish({
    type: 'hr.employee.status_changed',
    aggregateType: 'employee',
    aggregateId: String(employee._id),
    payload: { from: from.status, to: input.status },
    actorUserId: actor.userId,
  });
  return employee;
}

export async function employeeHistory(id: string) {
  return EmployeeEvent.find({ employeeId: id }).sort({ at: -1 }).lean();
}
