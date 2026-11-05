import type { RoleAssignment } from '@eayni/shared';
import { registerJob } from '../../core/jobs/registry';
import { registerRecordAccess, registerSensitiveOwnerType } from '../../core/access/registry';
import { effectivePermission } from '../../core/rbac/service';
import { registerTaskSourceResolver } from '../../core/tasks/service';
import { Ticket } from './model';
import { visibilityFilter } from './service';
import { runTicketFollowUps } from './jobs';

let registered = false;
/** Wire the tickets module into the platform core (record access, task source, jobs). Idempotent. */
export function registerTicketsModule(): void {
  if (registered) return;
  registered = true;
  registerRecordAccess('ticket', async (req, id) => {
    const eff = await effectivePermission(
      req.auth.user.roles as RoleAssignment[],
      req.auth.user.departmentId ? String(req.auth.user.departmentId) : undefined,
      'tickets',
      'view',
      String(req.auth.user._id),
    );
    if (!eff) return false;
    const filter = await visibilityFilter(req.auth.user, { resource: 'tickets', action: 'view', ...eff });
    return !!(await Ticket.exists({ _id: id, deletedAt: null, ...filter }));
  });
  registerSensitiveOwnerType('ticket');
  registerTaskSourceResolver('ticket', async (idOrNumber) => {
    const t = await Ticket.findOne({
      deletedAt: null,
      $or: [...(/^[0-9a-f]{24}$/i.test(idOrNumber) ? [{ _id: idOrNumber }] : []), { number: idOrNumber }],
    })
      .select('number subject')
      .lean();
    return t ? { id: String(t._id), label: `${t.number} — ${t.subject}` } : null;
  });
  registerJob('tickets.followups', (now) => runTicketFollowUps(now));
}

/** Outbox subscribers of the tickets module: none in phase 1 (events are published for other modules). */
export function registerTicketSubscribers(): void {}
