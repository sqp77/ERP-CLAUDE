import { ensureCoreRoles } from './core/rbac/service';
import { ensureWorkflow } from './core/workflow/engine';
import { DEFAULT_WORKFLOWS } from './core/workflow/defaults';
import { registerJob } from './core/jobs/registry';
import { runTaskReminders, runUnassignedTaskReminders } from './core/tasks/jobs';
import { registerTaskAccess } from './core/tasks/service';
import { runEventReminders } from './core/calendar/jobs';
import { runDocumentExpiryAlerts } from './core/documents/service';
import { registerExportResource } from './core/export/service';
import { User } from './core/auth/model';
import { registerHrModule } from './modules/hr';
import { registerTicketsModule } from './modules/tickets';
import { registerNewsModule } from './modules/news';
import { backfillIdentityHashes } from './modules/hr/service';
import { registerSubscribers } from './subscribers';

let jobsRegistered = false;
/**
 * Idempotent: jobs, export resources, record-access checkers and outbox subscribers are registered
 * once per process. Every Lambda entry point (api, jobs, outbox) calls this.
 */
export function registerModules(): void {
  if (jobsRegistered) return;
  jobsRegistered = true;
  registerSubscribers();
  registerJob('tasks.reminders', (now) => runTaskReminders(now), 'frequent');
  registerJob('tasks.unassigned', (now) => runUnassignedTaskReminders(now), 'daily');
  registerTaskAccess();
  registerJob('calendar.reminders', (now) => runEventReminders(now), 'frequent');
  registerJob('documents.expiry', (now) => runDocumentExpiryAlerts(now), 'daily');
  registerHrModule();
  registerTicketsModule();
  registerNewsModule();

  registerExportResource({
    resource: 'users',
    labelAr: 'المستخدمون',
    permissionResource: 'users',
    fields: [
      { key: 'displayNameAr', labelAr: 'الاسم' },
      { key: 'email', labelAr: 'البريد الإلكتروني' },
      { key: 'status', labelAr: 'الحالة' },
      {
        key: 'roles',
        labelAr: 'الأدوار',
        format: (v) => (Array.isArray(v) ? v.map((r: { role: string }) => r.role).join(', ') : ''),
      },
      { key: 'lastLoginAt', labelAr: 'آخر دخول' },
    ],
    query: async ({ limit }) =>
      User.find({ deletedAt: null }).limit(limit).lean() as unknown as Promise<Record<string, unknown>[]>,
  });
}

/** @deprecated name kept for the existing call sites; same as registerModules(). */
export const registerCoreJobs = registerModules;

/** Make sure configuration data exists (roles, workflow defaults). Safe to run on every start. */
export async function ensureBaseline(): Promise<void> {
  await ensureCoreRoles();
  for (const def of DEFAULT_WORKFLOWS) await ensureWorkflow(def);
  await backfillIdentityHashes();
}

/**
 * Memoised per process; a failure is forgotten so the next request retries instead of answering 500
 * until the container is recycled (go-live review F4).
 */
export const ensureBaselineOnce = memoiseUntilSuccess(ensureBaseline);
export function memoiseUntilSuccess(fn: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | undefined;
  return () => {
    pending ??= fn().catch((err) => {
      pending = undefined;
      throw err;
    });
    return pending;
  };
}
