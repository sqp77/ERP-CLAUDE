import { Types, type ClientSession } from 'mongoose';
import { SalesOrder } from './quotes.model';
import { SalesContract } from './contracts.model';
import { SalesRequest } from './requests.model';

/**
 * The Sales module owns sales orders; Finance invoices them through these functions (golden rules 2 and 6:
 * the order is referenced, never copied, and only Sales writes its collection).
 */
export async function orderForInvoicing(id: string) {
  return SalesOrder.findOne({ _id: id, deletedAt: null }).lean();
}

/**
 * Attach an invoice to the order (S3 fixes 1 and 2). Several invoices may be registered as long as their sum stays
 * within the order total; the write is conditional on the order still being invoiceable and on the remaining amount
 * covering this invoice, so two Finance users registering at the same moment cannot both succeed. Returns false when
 * the condition no longer holds (the caller answers 409).
 */
export async function attachInvoiceToOrder(
  id: string,
  invoiceId: string,
  amountHalalas: number,
  session?: ClientSession,
): Promise<boolean> {
  const r = await SalesOrder.updateOne(
    {
      _id: id,
      deletedAt: null,
      state: { $in: ['open', 'partially_invoiced'] },
      $expr: { $lte: [{ $add: [{ $ifNull: ['$invoicedHalalas', 0] }, amountHalalas] }, '$totalHalalas'] },
    },
    [
      {
        $set: {
          invoicedHalalas: { $add: [{ $ifNull: ['$invoicedHalalas', 0] }, amountHalalas] },
          invoiceIds: { $concatArrays: [{ $ifNull: ['$invoiceIds', []] }, [new Types.ObjectId(invoiceId)]] },
        },
      },
      {
        $set: {
          state: {
            $cond: [{ $gte: ['$invoicedHalalas', '$totalHalalas'] }, 'invoiced', 'partially_invoiced'],
          },
        },
      },
    ],
    { session },
  );
  return r.matchedCount > 0;
}

/** The order closes once fully invoiced and every invoice collected; Finance calls this after the last payment. */
export async function markOrderClosed(id: string, session?: ClientSession): Promise<void> {
  await SalesOrder.updateOne({ _id: id, state: 'invoiced' }, { $set: { state: 'closed' } }, { session });
}

/**
 * The Sales service behind an invoice source (S4, KPI and report filter «نوع الخدمة» [SAL §11.2, §12]): the request
 * the order's quote or the contract came from; undefined when the order or contract has no request.
 */
export async function serviceTypeOfSource(src: {
  salesOrderId?: string;
  contractId?: string;
}): Promise<string | undefined> {
  let requestId: unknown;
  if (src.salesOrderId)
    requestId = (await SalesOrder.findById(src.salesOrderId).select('requestId').lean())?.requestId;
  else if (src.contractId)
    requestId = (await SalesContract.findById(src.contractId).select('requestId').lean())?.requestId;
  if (!requestId) return undefined;
  return (await SalesRequest.findById(requestId).select('type').lean())?.type ?? undefined;
}
