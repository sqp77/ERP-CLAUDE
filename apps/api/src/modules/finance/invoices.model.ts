import { Schema, model, type InferSchemaType } from 'mongoose';
import { COLLECTION_STATES, INVOICE_KINDS, PAYMENT_METHODS, ZATCA_STATES } from '@eayni/shared';

/**
 * Invoice register — owned by Finance from day one (DECISIONS §20 Q14) [SAL §7.3, FIN §7, §10].
 * Q4 option A: Finance records the invoice issued in the current accounting system against an approved sales order
 * (several invoices per order, their sum ≤ the order total) or a periodic contract (per period / per completed schedule
 * entries); lines, customer and totals are prefilled from the source (no re-entry, FIN §7) and Finance records the
 * issued invoice's actual figures — a difference from the prefilled ones carries a reason that Sales sees (S3 fix 1).
 * Every ZATCA field is stored (golden rule 8); no signing or XML until the route is decided. Payments are append-only;
 * the collection state is derived.
 */
const invoiceSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    kind: { type: String, enum: INVOICE_KINDS, default: 'tax' },
    externalNumber: { type: String, required: true },
    source: { type: String, enum: ['order', 'contract'], required: true },
    /** Number of the order / contract the invoice was registered against (display only; the id is the link). */
    sourceNumber: { type: String },
    salesOrderId: { type: Schema.Types.ObjectId, ref: 'SalesOrder', index: true },
    contractId: { type: Schema.Types.ObjectId, ref: 'SalesContract', index: true },
    /** Contract invoices: the invoiced period and the schedule entries it covers (each entry is invoiced once). */
    periodFrom: { type: Date },
    periodTo: { type: Date },
    scheduleEntryIds: { type: [Schema.Types.ObjectId], default: [] },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    partyId: { type: Schema.Types.ObjectId, ref: 'Party' },
    salesOwnerUserId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    /** The Sales service the invoice belongs to, snapshot at registration (KPI filter «نوع الخدمة», SAL §11.2). */
    serviceType: { type: String, index: true },
    salesDepartmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
    issueDateTime: { type: Date, required: true, index: true },
    dueDate: { type: Date, required: true, index: true },
    /** Snapshot of the customer's legal data at issue time (FIN §7 content). */
    customer: {
      nameAr: String,
      legalNameAr: String,
      vatNumber: String,
      crNumber: String,
      nationalAddress: String,
    },
    lines: {
      type: [
        new Schema(
          {
            /** Price-list item, kept so KPIs group tons and price per material (SAL §11, DECISIONS §20 change 6). */
            itemId: Schema.Types.ObjectId,
            descriptionAr: String,
            unit: String,
            quantity: Number,
            unitPriceHalalas: Number,
            lineTotalHalalas: Number,
            vatRateBp: Number,
            vatHalalas: Number,
            taxCategory: String,
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    subtotalHalalas: { type: Number, required: true },
    vatTotalHalalas: { type: Number, required: true },
    totalHalalas: { type: Number, required: true },
    /** What the order / contract said before Finance entered the issued invoice's actual figures. */
    prefilled: {
      subtotalHalalas: Number,
      vatTotalHalalas: Number,
      totalHalalas: Number,
    },
    /** Set when the actual total differs from the prefilled one; the reason is audited and shown to Sales. */
    difference: {
      halalas: Number,
      reason: String,
      byUserId: Schema.Types.ObjectId,
    },
    collectedHalalas: { type: Number, default: 0 },
    remainingHalalas: { type: Number, required: true },
    collectionState: { type: String, enum: COLLECTION_STATES, default: 'due', index: true },
    payments: {
      type: [
        new Schema({
          amountHalalas: { type: Number, required: true },
          paidAt: { type: Date, required: true },
          method: { type: String, enum: PAYMENT_METHODS, required: true },
          reference: String,
          proofAttachmentId: Schema.Types.ObjectId,
          byUserId: Schema.Types.ObjectId,
          at: { type: Date, default: () => new Date() },
        }),
      ],
      default: [],
    },
    /** ZATCA readiness [FIN §10]: stored from day one; the integration fills them in Finance phase 3. */
    zatca: {
      uuid: { type: String, required: true },
      sequence: { type: Number, required: true },
      state: { type: String, enum: ZATCA_STATES, default: 'pending' },
      qr: String,
      xml: String,
      response: Schema.Types.Mixed,
      error: String,
      submittedAt: Date,
    },
    pdfAttachmentId: { type: Schema.Types.ObjectId },
    notes: { type: String },
    overdueNotifiedAt: { type: Date },
    issuedByUserId: { type: Schema.Types.ObjectId, required: true },
    sendLog: {
      type: [
        new Schema(
          { at: Date, to: [String], byUserId: Schema.Types.ObjectId, emailMessageId: Schema.Types.ObjectId },
          { _id: false },
        ),
      ],
      default: [],
    },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
invoiceSchema.index({ externalNumber: 1 }, { unique: true });
export type InvoiceDoc = InferSchemaType<typeof invoiceSchema>;
export const Invoice = model('Invoice', invoiceSchema);
