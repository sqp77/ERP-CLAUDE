import { registerRecordAccess } from '../../core/access/registry';
import { registerJob } from '../../core/jobs/registry';
import { registerRecordResolver } from '../../core/records/resolvers';
import { registerTagRenamer } from '../../core/tags/service';
import { registerTaskSourceResolver } from '../../core/tasks/service';
import { Customer, Lead } from './model';
import { canAccessCustomer, canAccessLead } from './service';
import { runFollowUpReminders, runLeadOverdueAlerts } from './jobs';

let registered = false;
/** Wire the CRM core into the platform (record access for files/comments, resolvers, jobs). Idempotent. */
export function registerCrmModule(): void {
  if (registered) return;
  registered = true;
  registerRecordAccess('customer', (req, id) => canAccessCustomer(req, id));
  registerRecordAccess('lead', (req, id) => canAccessLead(req, id));
  const resolveCustomer = async (idOrNumber: string) => {
    const c = await Customer.findOne({
      deletedAt: null,
      $or: [
        ...(/^[0-9a-f]{24}$/i.test(idOrNumber) ? [{ _id: idOrNumber }] : []),
        { number: idOrNumber.toUpperCase() },
      ],
    })
      .select('number nameAr')
      .lean();
    return c ? { id: String(c._id), label: `${c.number} — ${c.nameAr}` } : null;
  };
  registerRecordResolver('customer', resolveCustomer);
  registerTaskSourceResolver('customer', resolveCustomer);
  registerRecordResolver('lead', async (idOrNumber) => {
    const l = await Lead.findOne({
      deletedAt: null,
      $or: [
        ...(/^[0-9a-f]{24}$/i.test(idOrNumber) ? [{ _id: idOrNumber }] : []),
        { number: idOrNumber.toUpperCase() },
      ],
    })
      .select('number customerName')
      .lean();
    return l ? { id: String(l._id), label: `${l.number} — ${l.customerName}` } : null;
  });
  registerTagRenamer(async (scope, from, to) => {
    if (scope !== 'sales') return;
    if (to)
      await Customer.updateMany(
        { tags: from },
        { $set: { 'tags.$[t]': to } },
        { arrayFilters: [{ t: from }] },
      );
    else await Customer.updateMany({ tags: from }, { $pull: { tags: from } });
  });
  registerJob('crm.followups', (now) => runFollowUpReminders(now), 'frequent');
  registerJob('crm.leads.overdue', (now) => runLeadOverdueAlerts(now), 'frequent');
}
