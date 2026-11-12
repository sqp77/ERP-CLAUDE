import { Schema, model, type InferSchemaType } from 'mongoose';
import { QUOTE_APPROVAL_LEVELS, QUOTE_STATES, SALES_ORDER_STATES } from '@eayni/shared';

/**
 * عرض السعر [SAL §3 م2–م3, §7.2, §7.3]: lines taken from the price list with the list price snapshotted, discounts and
 * the approval level computed by the server, the approver recorded. Internal fields (list price, discounts, approval,
 * events) are sensitive: only Sales management and Finance see them; the customer document carries net prices only.
 */
const quoteLineSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: 'PriceItem', required: true },
    descriptionAr: { type: String, required: true },
    unit: { type: String, required: true },
    quantity: { type: Number, required: true },
    listPriceHalalas: { type: Number, required: true },
    marketPriceHalalas: { type: Number },
    discountPercentBp: { type: Number, default: 0 },
    discountHalalas: { type: Number, default: 0 },
    netUnitPriceHalalas: { type: Number, required: true },
    lineTotalHalalas: { type: Number, required: true },
    vatRateBp: { type: Number, required: true },
    vatHalalas: { type: Number, required: true },
    taxCategory: { type: String, default: 'S' },
  },
  { _id: false },
);
const quoteSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    version: { type: Number, default: 1 },
    previousQuoteId: { type: Schema.Types.ObjectId, ref: 'Quote' },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact' },
    opportunityId: { type: Schema.Types.ObjectId, ref: 'Opportunity', index: true },
    requestId: { type: Schema.Types.ObjectId, ref: 'SalesRequest', index: true },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    createdByUserId: { type: Schema.Types.ObjectId },
    lines: { type: [quoteLineSchema], default: [] },
    subtotalHalalas: { type: Number, required: true },
    discountTotalHalalas: { type: Number, required: true },
    vatTotalHalalas: { type: Number, required: true },
    totalHalalas: { type: Number, required: true },
    /** Largest line discount in basis points of its list price — what the matrix compares against. */
    maxDiscountBp: { type: Number, default: 0 },
    state: { type: String, enum: QUOTE_STATES, default: 'draft', index: true },
    approval: {
      requiredLevel: { type: String, enum: QUOTE_APPROVAL_LEVELS, default: 'none' },
      limitsUnset: { type: Boolean, default: false },
      requestedAt: { type: Date },
      approvedByUserId: { type: Schema.Types.ObjectId },
      approvedByName: { type: String },
      approvedAt: { type: Date },
      note: { type: String },
    },
    validityDays: { type: Number, required: true },
    validUntil: { type: Date },
    sentAt: { type: Date },
    sentVia: { type: String },
    emailMessageId: { type: Schema.Types.ObjectId },
    documentAttachmentId: { type: Schema.Types.ObjectId },
    customerResponse: {
      state: { type: String },
      reason: { type: String },
      note: { type: String },
      at: { type: Date },
      byUserId: { type: Schema.Types.ObjectId },
    },
    salesOrderId: { type: Schema.Types.ObjectId, ref: 'SalesOrder' },
    notesForCustomer: { type: String },
    internalNotes: { type: String },
    attachmentIds: { type: [Schema.Types.ObjectId], default: [] },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
quoteSchema.index({ departmentId: 1, state: 1 });
export type QuoteDoc = InferSchemaType<typeof quoteSchema>;
export const Quote = model('Quote', quoteSchema);

/** Append-only audit trail of a quote (edits, approvals, sends, replies) [SAL §7.2 «حفظ سجل جميع الخصومات والاعتمادات», §7.3]. */
const quoteEventSchema = new Schema(
  {
    quoteId: { type: Schema.Types.ObjectId, ref: 'Quote', required: true, index: true },
    type: { type: String, required: true },
    fromState: { type: String },
    toState: { type: String },
    byUserId: { type: Schema.Types.ObjectId },
    byEmail: { type: String },
    note: { type: String },
    data: { type: Schema.Types.Mixed },
    at: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
quoteEventSchema.index({ quoteId: 1, at: 1 });
export const QuoteEvent = model('QuoteEvent', quoteEventSchema);

/** أمر البيع [SAL §3 م4]: the accepted quote's net lines snapshotted, plus the signed file; Finance invoices it [§7.3]. */
const salesOrderSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    quoteId: { type: Schema.Types.ObjectId, ref: 'Quote', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    requestId: { type: Schema.Types.ObjectId, ref: 'SalesRequest' },
    opportunityId: { type: Schema.Types.ObjectId, ref: 'Opportunity' },
    contractId: { type: Schema.Types.ObjectId, ref: 'SalesContract' },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
    lines: {
      type: [
        new Schema(
          {
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
    signedFileAttachmentId: { type: Schema.Types.ObjectId },
    state: { type: String, enum: SALES_ORDER_STATES, default: 'open', index: true },
    invoiceIds: { type: [Schema.Types.ObjectId], default: [] },
    createdByUserId: { type: Schema.Types.ObjectId },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
export type SalesOrderDoc = InferSchemaType<typeof salesOrderSchema>;
export const SalesOrder = model('SalesOrder', salesOrderSchema);
