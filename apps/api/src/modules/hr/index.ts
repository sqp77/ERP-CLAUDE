import { registerJob } from '../../core/jobs/registry';
import { registerTeamResolver } from '../../core/rbac/scope';
import { registerExpiryRecipients } from '../../core/documents/service';
import { registerDocumentAccess } from '../../core/documents/access';
import { registerExportResource } from '../../core/export/service';
import { Employee } from './model';
import { employeeScopeFilter, hrUserIds, teamUserIdsOf } from './service';
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

  // Employee documents: expiry recipients and who may read them [HR §3.9, EP §5.2].
  registerExpiryRecipients('employee', async (ownerId) => {
    const e = await Employee.findById(ownerId).select('userId directManagerId').lean();
    const ids = await hrUserIds();
    if (e?.userId) ids.push(String(e.userId));
    return ids;
  });
  registerDocumentAccess('employee', async (req, ownerId) => {
    if (req.authz?.scope === 'all') return true;
    const filter = await employeeScopeFilter(
      {
        resource: 'hr.employees',
        action: 'view',
        scope: req.authz?.scope ?? 'own',
        departmentIds: req.authz?.departmentIds ?? [],
      },
      req.auth.user,
    );
    return !!(await Employee.exists({ _id: ownerId, deletedAt: null, ...filter }));
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
