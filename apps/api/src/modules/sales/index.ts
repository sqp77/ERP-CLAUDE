import { registerRecordAccess } from '../../core/access/registry';
import { registerJob } from '../../core/jobs/registry';
import { registerRecordResolver } from '../../core/records/resolvers';
import { registerTagRenamer } from '../../core/tags/service';
import { registerTaskSourceResolver } from '../../core/tasks/service';
import {
  registerCustomerCreatedHook,
  registerLeadConvertedHook,
  registerOwnerChangeHook,
} from '../crm/service';
import { Opportunity } from './model';
import { SalesRequest } from './requests.model';
import { canAccessRequest, runAssetReturnReminders, runRequestOverdueAlerts } from './requests.service';
import { canAccessQuote } from './quotes.service';
import { Quote } from './quotes.model';
import { canAccessContract, runContractAlerts } from './contracts.service';
import { SalesContract } from './contracts.model';
import {
  canAccessOpportunity,
  createOpportunityIn,
  followCustomerTransfer,
  runOpportunityFollowUps,
} from './service';

let registered = false;
/** Wire the Sales module into the platform and the CRM hooks. Idempotent. */
export function registerSalesModule(): void {
  if (registered) return;
  registered = true;
  registerRecordAccess('opportunity', (req, id) => canAccessOpportunity(req, id));
  const resolve = async (idOrNumber: string) => {
    const o = await Opportunity.findOne({
      deletedAt: null,
      $or: [
        ...(/^[0-9a-f]{24}$/i.test(idOrNumber) ? [{ _id: idOrNumber }] : []),
        { number: idOrNumber.toUpperCase() },
      ],
    })
      .select('number title')
      .lean();
    return o ? { id: String(o._id), label: `${o.number} — ${o.title}` } : null;
  };
  registerRecordResolver('opportunity', resolve);
  registerTaskSourceResolver('opportunity', resolve);
  // «عميل جديد / فرصة بيعية جديدة»: the first opportunity is created with the customer, in the same transaction.
  registerCustomerCreatedHook(async ({ customer, input, req, session }) => {
    if (!input.opportunity) return;
    await createOpportunityIn(
      session,
      req,
      {
        customerId: String(customer._id),
        ...input.opportunity,
        serviceType: input.opportunity.serviceType as never,
        leadId: input.leadId,
      },
      { _id: customer.ownerUserId, departmentId: customer.departmentId },
    );
  });
  registerLeadConvertedHook(async ({ lead, customerId, input, req, session }) => {
    if (!input.createOpportunity) return;
    await createOpportunityIn(
      session,
      req,
      {
        customerId,
        title: input.opportunityTitle ?? lead.interest,
        expectedValueHalalas: input.expectedValueHalalas,
        leadId: String(lead._id),
      },
      { _id: lead.assigneeUserId ?? req.auth.user._id, departmentId: req.auth.user.departmentId },
    );
  });
  registerOwnerChangeHook((args) => followCustomerTransfer(args));
  registerTagRenamer(async (scope, from, to) => {
    if (scope !== 'sales') return;
    if (to)
      await Opportunity.updateMany(
        { tags: from },
        { $set: { 'tags.$[t]': to } },
        { arrayFilters: [{ t: from }] },
      );
    else await Opportunity.updateMany({ tags: from }, { $pull: { tags: from } });
  });
  registerJob('sales.followups', (now) => runOpportunityFollowUps(now), 'frequent');
  // Service requests [SAL §5, §6]: files and comments hang on the request; tasks and calendar events link to it.
  registerRecordAccess('sales_request', (req, id) => canAccessRequest(req, id));
  const resolveRequest = async (idOrNumber: string) => {
    const r = await SalesRequest.findOne({
      deletedAt: null,
      $or: [
        ...(/^[0-9a-f]{24}$/i.test(idOrNumber) ? [{ _id: idOrNumber }] : []),
        { number: idOrNumber.toUpperCase() },
      ],
    })
      .select('number title')
      .lean();
    return r ? { id: String(r._id), label: `${r.number} — ${r.title}` } : null;
  };
  registerRecordResolver('sales_request', resolveRequest);
  registerTaskSourceResolver('sales_request', resolveRequest);
  registerTagRenamer(async (scope, from, to) => {
    if (scope !== 'sales') return;
    if (to)
      await SalesRequest.updateMany(
        { tags: from },
        { $set: { 'tags.$[t]': to } },
        { arrayFilters: [{ t: from }] },
      );
    else await SalesRequest.updateMany({ tags: from }, { $pull: { tags: from } });
  });
  registerJob('sales.requests.overdue', (now) => runRequestOverdueAlerts(now), 'frequent');
  // Quotes and contracts [SAL §6.3, §7]: files hang on them; contract alerts run daily.
  registerRecordAccess('quote', (req, id) => canAccessQuote(req, id));
  registerRecordAccess('sales_contract', (req, id) => canAccessContract(req, id));
  registerRecordResolver('quote', async (idOrNumber) => {
    const q = await Quote.findOne({
      deletedAt: null,
      $or: [
        ...(/^[0-9a-f]{24}$/i.test(idOrNumber) ? [{ _id: idOrNumber }] : []),
        { number: idOrNumber.toUpperCase() },
      ],
    })
      .select('number')
      .lean();
    return q ? { id: String(q._id), label: q.number } : null;
  });
  registerRecordResolver('sales_contract', async (idOrNumber) => {
    const c = await SalesContract.findOne({
      deletedAt: null,
      $or: [
        ...(/^[0-9a-f]{24}$/i.test(idOrNumber) ? [{ _id: idOrNumber }] : []),
        { number: idOrNumber.toUpperCase() },
      ],
    })
      .select('number')
      .lean();
    return c ? { id: String(c._id), label: c.number } : null;
  });
  registerJob('sales.contracts.alerts', (now) => runContractAlerts(now), 'daily');
  registerJob('sales.assetreturn.reminders', (now) => runAssetReturnReminders(now), 'frequent');
}
