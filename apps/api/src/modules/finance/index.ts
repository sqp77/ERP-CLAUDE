import type { RoleDefinition } from '@eayni/shared';
import { registerRecordAccess, registerSensitiveOwnerType } from '../../core/access/registry';
import { registerJob } from '../../core/jobs/registry';
import { registerRecordResolver } from '../../core/records/resolvers';
import { Invoice } from './invoices.model';
import { canAccessInvoice, runInvoiceOverdueAlerts } from './invoices.service';

/**
 * Finance phase 0 (DECISIONS §20 Q14): the invoice register only. Finance phases 1–3 grow from here on the same
 * collections; nothing else of FIN is built in the Sales phase.
 */
let registered = false;
export function registerFinanceModule(): void {
  if (registered) return;
  registered = true;
  registerRecordAccess('invoice', (req, id) => canAccessInvoice(req, id));
  registerSensitiveOwnerType('invoice');
  registerRecordResolver('invoice', async (idOrNumber) => {
    const i = await Invoice.findOne({
      deletedAt: null,
      $or: [
        ...(/^[0-9a-f]{24}$/i.test(idOrNumber) ? [{ _id: idOrNumber }] : []),
        { number: idOrNumber.toUpperCase() },
        { externalNumber: idOrNumber },
      ],
    })
      .select('number externalNumber')
      .lean();
    return i ? { id: String(i._id), label: `${i.number} (${i.externalNumber})` } : null;
  });
  registerJob('finance.invoices.overdue', (now) => runInvoiceOverdueAlerts(now), 'daily');
}

/** Grants the Finance roles need for the register; merged into the core Finance role definitions by the baseline. */
export const FINANCE_INVOICE_GRANTS: RoleDefinition['grants'] = [
  { resource: 'finance.invoices', actions: ['view', 'create', 'edit', 'export'], scope: 'all' },
  { resource: 'sales.quotes', actions: ['view'], scope: 'all' },
  { resource: 'sales.contracts', actions: ['view'], scope: 'all' },
  { resource: 'sales.pricelist', actions: ['view'], scope: 'all' },
];
