import type { ClientSession } from 'mongoose';
import { SalesOrder } from './quotes.model';

/**
 * The Sales module owns sales orders; Finance invoices them through these functions (golden rules 2 and 6:
 * the order is referenced, never copied, and only Sales writes its collection).
 */
export async function orderForInvoicing(id: string) {
  return SalesOrder.findOne({ _id: id, deletedAt: null }).lean();
}
export async function markOrderInvoiced(
  id: string,
  invoiceId: string,
  session?: ClientSession,
): Promise<void> {
  await SalesOrder.updateOne(
    { _id: id },
    { $set: { state: 'invoiced' }, $addToSet: { invoiceIds: invoiceId } },
    { session },
  );
}
export async function markOrderClosed(id: string, session?: ClientSession): Promise<void> {
  await SalesOrder.updateOne({ _id: id, state: 'invoiced' }, { $set: { state: 'closed' } }, { session });
}
