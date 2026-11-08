import { registerJob } from '../../core/jobs/registry';
import { registerTeamResolver } from '../../core/rbac/scope';
import { registerExpiryRecipients } from '../../core/documents/service';
import { registerRecordAccess, registerSensitiveOwnerType } from '../../core/access/registry';
import { effectivePermission } from '../../core/rbac/service';
import type { RoleAssignment } from '@eayni/shared';
import type { AuthedRequest } from '../../core/http/context';
import { ProfileChangeRequest } from './profileChanges.model';
import { HrRequest } from './requests.model';
import { EmployeeReport } from './reports.model';
import { visibilityFilter as reportsVisibility } from './reports.service';
import { registerExportResource } from '../../core/export/service';
import { Employee } from './model';
import { employeeScopeFilter, hrUserIds, teamUserIdsOf } from './service';
import { registerRequestHandlers, runRequestOverdueReminders, visibilityFilter } from './requests.service';
import { registerAssigneeDirectory, registerTaskSourceResolver } from '../../core/tasks/service';
import { registerPeopleSearch } from '../../core/records/resolvers';
import { registerCalendarSource } from '../../core/calendar/sources';
import { arabicSearchRegex } from '@eayni/shared';
import { ON_DUTY_STATUSES } from './service';
import {
  runAccountDeactivation,
  runBirthdayGreetings,
  runContractAlerts,
  runIdentityAlerts,
  runProbationAlerts,
  runSecondmentReportReminders,
} from './jobs';

let registered = false;
/** Wire the HR module into the platform core (scopes, documents, jobs, exports). Idempotent. */
export function registerHrModule(): void {
  if (registered) return;
  registered = true;

  registerTeamResolver(teamUserIdsOf);
  registerRequestHandlers();
  // Tasks: who may be assigned work comes from the employee file (EP §16); requests can be a task's source.
  registerAssigneeDirectory({
    async lookup(userId) {
      const e = await Employee.findOne({ userId, deletedAt: null })
        .select('fullNameAr departmentId directManagerId status')
        .lean();
      if (!e) return null;
      const mgr = e.directManagerId
        ? await Employee.findById(e.directManagerId).select('userId').lean()
        : null;
      return {
        userId,
        employeeId: String(e._id),
        fullNameAr: e.fullNameAr,
        departmentId: String(e.departmentId),
        managerUserId: mgr?.userId ? String(mgr.userId) : undefined,
        active: (ON_DUTY_STATUSES as readonly string[]).includes(e.status),
      };
    },
  });
  registerTaskSourceResolver('hr_request', async (idOrNumber) => {
    const r = await HrRequest.findOne({
      deletedAt: null,
      $or: [
        /^[0-9a-f]{24}$/i.test(idOrNumber) ? { _id: idOrNumber } : { number: idOrNumber },
        { number: idOrNumber },
      ],
    })
      .select('number type')
      .lean();
    return r ? { id: String(r._id), label: r.number } : null;
  });
  registerJob('hr.requests.overdue', (now) => runRequestOverdueReminders(now));

  // Employee documents: expiry recipients and who may read them [HR §3.9, EP §5.2].
  registerExpiryRecipients('employee', async (ownerId) => {
    const e = await Employee.findById(ownerId).select('userId directManagerId').lean();
    const ids = await hrUserIds();
    if (e?.userId) ids.push(String(e.userId));
    return ids;
  });
  // Record access for files, documents and comments hanging on HR records (security review A3/A4).
  // Each checker evaluates the user's permission on the HR resource itself, not on the calling resource.
  const permissionOn = async (req: AuthedRequest, resource: string) =>
    effectivePermission(
      req.auth.user.roles as RoleAssignment[],
      req.auth.user.departmentId ? String(req.auth.user.departmentId) : undefined,
      resource,
      'view',
    );
  registerRecordAccess('employee', async (req, ownerId) => {
    const eff = await permissionOn(req, 'hr.employees');
    if (!eff) return false;
    if (eff.scope === 'all') return true;
    const filter = await employeeScopeFilter(
      { resource: 'hr.employees', action: 'view', ...eff },
      req.auth.user,
    );
    if (await Employee.exists({ _id: ownerId, deletedAt: null, ...filter })) return true;
    // The direct manager reads their reports' files (secondment reports) — the org chart, not a role [DECISIONS §4].
    const me = await Employee.findOne({ userId: req.auth.user._id, deletedAt: null }).select('_id').lean();
    return !!me && !!(await Employee.exists({ _id: ownerId, deletedAt: null, directManagerId: me._id }));
  });
  registerRecordAccess('hr_request', async (req, id) => {
    const eff = await permissionOn(req, 'hr.requests');
    if (!eff) return false;
    const filter = await visibilityFilter(req.auth.user, { resource: 'hr.requests', action: 'view', ...eff });
    return !!(await HrRequest.exists({ _id: id, deletedAt: null, ...filter }));
  });
  registerRecordAccess('profile_change', async (req, id) => {
    const eff = await permissionOn(req, 'hr.profile_changes');
    if (!eff) return false;
    const filter = eff.scope === 'own' ? { userId: req.auth.user._id } : {};
    return !!(await ProfileChangeRequest.exists({ _id: id, ...filter }));
  });
  for (const t of ['employee', 'hr_request', 'profile_change']) registerSensitiveOwnerType(t);
  registerRecordAccess('employee_report', async (req, id) => {
    const eff = await permissionOn(req, 'hr.reports');
    if (!eff) return false;
    const filter = await reportsVisibility(req.auth.user, { resource: 'hr.reports', action: 'view', ...eff });
    return !!(await EmployeeReport.exists({ _id: id, deletedAt: null, ...filter }));
  });
  // Field-picker export of employee reports [EP §14.3, HR §4].
  registerExportResource({
    resource: 'employee_reports',
    labelAr: 'تقارير الموظفين',
    permissionResource: 'hr.reports',
    fields: [
      { key: 'number', labelAr: 'رقم التقرير' },
      { key: 'employeeName', labelAr: 'الموظف' },
      { key: 'type', labelAr: 'النوع' },
      { key: 'title', labelAr: 'العنوان' },
      { key: 'submittedAt', labelAr: 'التاريخ' },
      { key: 'periodFrom', labelAr: 'من' },
      { key: 'periodTo', labelAr: 'إلى' },
      { key: 'state', labelAr: 'الحالة' },
      { key: 'notesCount', labelAr: 'عدد الملاحظات' },
    ],
    query: async ({ filters, authz, userId, limit }) => {
      const { User } = await import('../../core/auth/model');
      const user = await User.findById(userId);
      if (!user) return [];
      const f: Record<string, unknown> = { deletedAt: null, ...(await reportsVisibility(user, authz)) };
      if (typeof filters.type === 'string') f.type = filters.type;
      if (typeof filters.employeeId === 'string') f.employeeId = filters.employeeId;
      const rows = await EmployeeReport.find(f).sort({ submittedAt: -1 }).limit(limit).lean();
      const emps = await Employee.find({ _id: { $in: rows.map((r) => r.employeeId) } })
        .select('fullNameAr')
        .lean();
      const names = new Map(emps.map((e) => [String(e._id), e.fullNameAr]));
      return rows.map((r) => ({
        ...r,
        employeeName: names.get(String(r.employeeId)) ?? '',
        notesCount: r.notes.length,
      })) as unknown as Record<string, unknown>[];
    },
  });

  // People picker (participants, assignees) over the employee file; secondments on the calendar [EP §13.7].
  registerPeopleSearch(async (q, limit) => {
    const filter: Record<string, unknown> = {
      deletedAt: null,
      userId: { $ne: null },
      status: { $nin: ['resigned', 'terminated'] },
    };
    if (q) filter.fullNameAr = arabicSearchRegex(q);
    const rows = await Employee.find(filter)
      .select('userId fullNameAr departmentId positionId')
      .sort({ fullNameAr: 1 })
      .limit(limit)
      .lean();
    return rows.map((r) => ({
      userId: String(r.userId),
      fullNameAr: r.fullNameAr,
      departmentId: String(r.departmentId),
      positionId: r.positionId ? String(r.positionId) : undefined,
    }));
  });
  registerCalendarSource('secondments', async (req, from, to) => {
    const e = await Employee.findOne({ userId: req.auth.user._id, deletedAt: null })
      .select('secondment secondmentHistory')
      .lean();
    if (!e) return [];
    const all = [...(e.secondmentHistory ?? []), ...(e.secondment?.destination ? [e.secondment] : [])];
    return all
      .filter((s) => s.startDate && s.endDate && s.startDate < to && s.endDate >= from)
      .map((s, i) => ({
        _id: `secondment:${e._id}:${i}`,
        title: `انتداب — ${s.destination}`,
        type: 'secondment',
        status: s.endDate! < new Date() ? 'done' : 'scheduled',
        startAt: s.startDate!,
        endAt: s.endDate!,
        allDay: true,
        readOnly: true as const,
        link: { type: 'employee', id: String(e._id) },
      }));
  });

  registerJob('hr.contracts.alerts', (now) => runContractAlerts(now));
  registerJob('hr.probation.alerts', (now) => runProbationAlerts(now));
  registerJob('hr.identity.alerts', (now) => runIdentityAlerts(now));
  registerJob('hr.accounts.deactivate', (now) => runAccountDeactivation(now));
  registerJob('hr.birthdays', (now) => runBirthdayGreetings(now));
  registerJob('hr.secondments.reminders', (now) => runSecondmentReportReminders(now));

  // Field-picker export [HR §4]; sensitive columns need field-level permission.
  registerExportResource({
    resource: 'employees',
    labelAr: 'الموظفون',
    permissionResource: 'hr.employees',
    fields: [
      { key: 'employeeNumber', labelAr: 'الرقم الوظيفي' },
      { key: 'fullNameAr', labelAr: 'الاسم' },
      { key: 'nationality', labelAr: 'الجنسية' },
      { key: 'gender', labelAr: 'الجنس' },
      { key: 'employmentType', labelAr: 'نوع الدوام' },
      { key: 'medicalInsurance', labelAr: 'تأمين طبي', format: (v) => (v ? 'نعم' : 'لا') },
      { key: 'status', labelAr: 'حالة الموظف' },
      { key: 'hireDate', labelAr: 'تاريخ المباشرة' },
      { key: 'workEmail', labelAr: 'البريد الوظيفي' },
      { key: 'mobile', labelAr: 'الجوال' },
      { key: 'departmentId', labelAr: 'القسم (معرّف)' },
      { key: 'birthDate', labelAr: 'تاريخ الميلاد', sensitive: true },
      {
        key: 'basicSalaryHalalas',
        labelAr: 'الراتب الأساسي (ر.س)',
        sensitive: true,
        format: (v) => (typeof v === 'number' ? v / 100 : ''),
      },
    ],
    query: async ({ filters, authz, userId, limit }) => {
      const { User } = await import('../../core/auth/model');
      const user = await User.findById(userId);
      const scope = user ? await employeeScopeFilter(authz, user) : { _id: null };
      const f: Record<string, unknown> = { deletedAt: null, ...scope };
      if (typeof filters.departmentId === 'string') f.departmentId = filters.departmentId;
      if (typeof filters.status === 'string') f.status = filters.status;
      return Employee.find(f).limit(limit).lean() as unknown as Promise<Record<string, unknown>[]>;
    },
  });
}
