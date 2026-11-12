import { Schema, model, type InferSchemaType } from 'mongoose';
import { CONTRACT_STATES, PRICE_UNITS, SCHEDULE_KINDS, SCHEDULE_STATUSES } from '@eayni/shared';

/** العقود الدورية [SAL §7.4, §6.3]: materials or services, quantities, agreed prices, the delivery/pickup schedule (each date tracked), the signed file, alerts. */
const salesContractSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    contractType: { type: String },
    requestId: { type: Schema.Types.ObjectId, ref: 'SalesRequest' },
    salesOrderId: { type: Schema.Types.ObjectId, ref: 'SalesOrder' },
    quoteId: { type: Schema.Types.ObjectId, ref: 'Quote' },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true, index: true },
    durationMonths: { type: Number },
    items: {
      type: [
        new Schema(
          {
            itemId: Schema.Types.ObjectId,
            descriptionAr: String,
            quantity: Number,
            unit: { type: String, enum: PRICE_UNITS },
            agreedPriceHalalas: Number,
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    schedule: {
      type: [
        new Schema({
          plannedAt: { type: Date, required: true },
          kind: { type: String, enum: SCHEDULE_KINDS, required: true },
          status: { type: String, enum: SCHEDULE_STATUSES, default: 'planned' },
          doneAt: Date,
          note: String,
          byUserId: Schema.Types.ObjectId,
        }),
      ],
      default: [],
    },
    signedFileAttachmentId: { type: Schema.Types.ObjectId },
    notes: { type: String },
    renewalOf: { type: Schema.Types.ObjectId, ref: 'SalesContract' },
    renewedById: { type: Schema.Types.ObjectId, ref: 'SalesContract' },
    state: { type: String, enum: CONTRACT_STATES, default: 'active', index: true },
    alerts: { expiringSentAt: { type: Date }, renewalReminderSentAt: { type: Date } },
    createdByUserId: { type: Schema.Types.ObjectId },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
export type SalesContractDoc = InferSchemaType<typeof salesContractSchema>;
export const SalesContract = model('SalesContract', salesContractSchema);

/** سجل العمليات المرتبطة بالعقد — append-only [SAL §7.4]. */
const contractEventSchema = new Schema(
  {
    contractId: { type: Schema.Types.ObjectId, ref: 'SalesContract', required: true, index: true },
    type: { type: String, required: true },
    note: { type: String },
    data: { type: Schema.Types.Mixed },
    byUserId: { type: Schema.Types.ObjectId },
    byEmail: { type: String },
    at: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
contractEventSchema.index({ contractId: 1, at: 1 });
export const ContractEvent = model('ContractEvent', contractEventSchema);

/** شهادة التعاون [SAL §6.3]: numbered, from a template, with an issue and send log. */
const cooperationCertificateSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    contractId: { type: Schema.Types.ObjectId, ref: 'SalesContract', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    issuedAt: { type: Date, required: true },
    issuedByUserId: { type: Schema.Types.ObjectId, required: true },
    attachmentId: { type: Schema.Types.ObjectId, required: true },
    sendLog: {
      type: [
        new Schema(
          {
            at: Date,
            to: [String],
            byUserId: Schema.Types.ObjectId,
            emailMessageId: Schema.Types.ObjectId,
            note: String,
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
);
export const CooperationCertificate = model('CooperationCertificate', cooperationCertificateSchema);
