import { ensureCoreRoles } from './core/rbac/service';
import { ensureWorkflow } from './core/workflow/engine';
import { DEFAULT_WORKFLOWS } from './core/workflow/defaults';
import { registerJob } from './core/jobs/registry';
import { runTaskReminders } from './core/tasks/jobs';
import { runEventReminders } from './core/calendar/jobs';
import { runDocumentExpiryAlerts } from './core/documents/service';
import { registerExportResource } from './core/export/service';
import { User } from './core/auth/model';

let jobsRegistered = false;
/** Idempotent: jobs and export resources are registered once per process. */
export function registerCoreJobs(): void {
  if (jobsRegistered) return;
  jobsRegistered = true;
  registerJob('tasks.reminders', (now) => runTaskReminders(now));
  registerJob('calendar.reminders', (now) => runEventReminders(now));
  registerJob('documents.expiry', (now) => runDocumentExpiryAlerts(now));

  registerExportResource({
    resource: 'users',
    labelAr: 'المستخدمون',
    permissionResource: 'users',
    fields: [
      { key: 'displayNameAr', labelAr: 'الاسم' },
      { key: 'email', labelAr: 'البريد الإلكتروني' },
      { key: 'status', labelAr: 'الحالة' },
      { key: 'roles', labelAr: 'الأدوار', format: (v) => (Array.isArray(v) ? v.map((r: { role: string }) => r.role).join(', ') : '') },
      { key: 'lastLoginAt', labelAr: 'آخر دخول' },
    ],
    query: async ({ limit }) => User.find({ deletedAt: null }).limit(limit).lean() as unknown as Promise<Record<string, unknown>[]>,
  });
}

/** Make sure configuration data exists (roles, workflow defaults). Safe to run on every start. */
export async function ensureBaseline(): Promise<void> {
  await ensureCoreRoles();
  for (const def of DEFAULT_WORKFLOWS) await ensureWorkflow(def);
}
